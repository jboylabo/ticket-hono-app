/**
 * 予約・キャンセル・退会（docs/sql.md ①②③）
 *
 * ロックの原則:
 *   1. 在庫行（ticket_inventories）を SELECT ... FOR UPDATE で先にロックする
 *   2. その後に reservations を触る
 * 予約・キャンセルのどちらも「在庫 → 予約」の順でロックを取るため、
 * 2つのトランザクションが互いの行を待ち合うデッドロックが起きない。
 */
import { and, eq, gte, isNull, ne, sql } from 'drizzle-orm'
import { db, type Tx } from '../db/client.js'
import { reservations, sessions, ticketInventories } from '../db/schema.js'
import { AppError, translatePgError } from '../errors.js'

/** トランザクション内のロック待ち上限。接続プール枯渇を防ぐ */
export const LOCK_TIMEOUT_MS = 3000

export async function setLockTimeout(tx: Tx, ms = LOCK_TIMEOUT_MS) {
  // SET LOCAL はパラメータバインドできないので数値を検証してから埋め込む
  await tx.execute(sql.raw(`SET LOCAL lock_timeout = '${Math.trunc(ms)}ms'`))
}

async function withPgErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    throw translatePgError(err) ?? err
  }
}

// ---------------------------------------------------------------------------
// ① チケット予約（行ロック ＋ lock_timeout）
// ---------------------------------------------------------------------------
export async function reserveTicket(input: { userId: string; inventoryId: string; quantity: number }) {
  const { userId, inventoryId, quantity } = input
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
    throw new AppError(400, 'INVALID_QUANTITY', '枚数は1〜10枚で指定してください')
  }

  return withPgErrors(() =>
    db.transaction(async (tx) => {
      await setLockTimeout(tx)

      // SELECT id, available_seats FROM ticket_inventories
      //  WHERE id = $1 AND deleted_at IS NULL FOR UPDATE
      // → 他のトランザクションは commit / rollback までこの行で待たされる
      const [inventory] = await tx
        .select({ id: ticketInventories.id, availableSeats: ticketInventories.availableSeats })
        .from(ticketInventories)
        .where(and(eq(ticketInventories.id, inventoryId), isNull(ticketInventories.deletedAt)))
        .for('update')

      if (!inventory) throw new AppError(404, 'INVENTORY_NOT_FOUND', 'チケットが見つかりません')
      if (inventory.availableSeats < quantity) {
        throw new AppError(409, 'SOLD_OUT', `残席が不足しています（残り${inventory.availableSeats}席）`)
      }

      // ロックを持っているので安全に減算できる。WHERE の available_seats >= qty は二重の保険
      await tx
        .update(ticketInventories)
        .set({
          availableSeats: sql`${ticketInventories.availableSeats} - ${quantity}`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(ticketInventories.id, inventoryId),
            isNull(ticketInventories.deletedAt),
            gte(ticketInventories.availableSeats, quantity),
          ),
        )

      const [reservation] = await tx
        .insert(reservations)
        .values({ userId, inventoryId, quantity, status: 'confirmed' })
        .returning()

      return reservation!
    }),
  )
}

// ---------------------------------------------------------------------------
// ② 予約キャンセル（ロック順序を予約処理と統一）
// ---------------------------------------------------------------------------
export async function cancelReservation(input: { userId: string; reservationId: string }) {
  const { userId, reservationId } = input

  return withPgErrors(() =>
    db.transaction(async (tx) => {
      await setLockTimeout(tx)

      // どの在庫行をロックすべきか知るために、ロックなしで予約を参照する
      const [target] = await tx
        .select({ inventoryId: reservations.inventoryId })
        .from(reservations)
        .where(and(eq(reservations.id, reservationId), eq(reservations.userId, userId)))
      if (!target) throw new AppError(404, 'RESERVATION_NOT_FOUND', '予約が見つかりません')

      // 1. 先に在庫行をロック（予約トランザクションと同じ順序）
      await tx
        .select({ id: ticketInventories.id })
        .from(ticketInventories)
        .where(eq(ticketInventories.id, target.inventoryId))
        .for('update')

      // 2. 有効な予約だけをキャンセル（status != 'cancelled' で二重キャンセル防止）
      const [cancelled] = await tx
        .update(reservations)
        .set({ status: 'cancelled', updatedAt: sql`now()` })
        .where(
          and(
            eq(reservations.id, reservationId),
            eq(reservations.userId, userId),
            eq(reservations.inventoryId, target.inventoryId),
            ne(reservations.status, 'cancelled'),
            isNull(reservations.deletedAt),
          ),
        )
        .returning({ quantity: reservations.quantity })
      if (!cancelled) throw new AppError(409, 'ALREADY_CANCELLED', 'この予約は既にキャンセルされています')

      // 3. キャンセルした枚数分だけ在庫を返却
      await tx
        .update(ticketInventories)
        .set({
          availableSeats: sql`${ticketInventories.availableSeats} + ${cancelled.quantity}`,
          updatedAt: sql`now()`,
        })
        .where(eq(ticketInventories.id, target.inventoryId))

      return { reservationId, restoredSeats: cancelled.quantity }
    }),
  )
}

// ---------------------------------------------------------------------------
// ③ 退会（論理削除 ＋ 未来の予約キャンセル ＋ 強制ログアウト）
// ---------------------------------------------------------------------------
export async function withdrawUser(userId: string) {
  return withPgErrors(() =>
    db.transaction(async (tx) => {
      await setLockTimeout(tx)

      // デッドロック防止: 返却対象の在庫行を id 昇順でまとめてロックしておく
      await tx.execute(sql`
        SELECT ti.id
        FROM ticket_inventories ti
        WHERE ti.id IN (
          SELECT r.inventory_id FROM reservations r
          WHERE r.user_id = ${userId} AND r.status != 'cancelled' AND r.deleted_at IS NULL
        )
        ORDER BY ti.id ASC
        FOR UPDATE
      `)

      // 1〜2. 未来の有効な予約をキャンセル → inventory ごとに集計して在庫返却
      await tx.execute(sql`
        WITH cancelled_res AS (
          UPDATE reservations r
          SET status = 'cancelled', deleted_at = NOW(), updated_at = NOW()
          FROM ticket_inventories ti
          JOIN events e ON ti.event_id = e.id
          WHERE r.inventory_id = ti.id
            AND r.user_id = ${userId}
            AND r.status != 'cancelled'
            AND r.deleted_at IS NULL
            AND e.starts_at > NOW()
          RETURNING r.inventory_id, r.quantity
        ),
        restored_counts AS (
          SELECT inventory_id, SUM(quantity) AS total_qty
          FROM cancelled_res
          GROUP BY inventory_id
        )
        UPDATE ticket_inventories ti
        SET available_seats = ti.available_seats + rc.total_qty,
            updated_at = NOW()
        FROM restored_counts rc
        WHERE ti.id = rc.inventory_id
      `)

      // 3. ユーザーを論理削除（メールアドレスを退避して再登録を可能にする）
      await tx.execute(sql`
        UPDATE users
        SET deleted_at = NOW(),
            email = 'deleted_' || id || '_' || email,
            updated_at = NOW()
        WHERE id = ${userId} AND deleted_at IS NULL
      `)

      // 4. セッションを物理削除して強制ログアウト
      await tx.delete(sessions).where(eq(sessions.userId, userId))
    }),
  )
}
