/**
 * ④ 仮押さえ（pending）期限切れの自動解放バッチ
 *
 * FOR UPDATE SKIP LOCKED: 他トランザクションがロック中の予約行は飛ばして処理する。
 * バッチがユーザーの予約処理を待たせない／待たされないための定石。
 */
import { and, asc, eq, inArray, isNull, lt, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { reservations, ticketInventories } from '../db/schema.js'
import { setLockTimeout } from './reservation.js'

export async function releaseExpiredPending(limit = 100) {
  return db.transaction(async (tx) => {
    await setLockTimeout(tx)

    const expired = await tx
      .select({ id: reservations.id, inventoryId: reservations.inventoryId, quantity: reservations.quantity })
      .from(reservations)
      .where(
        and(
          eq(reservations.status, 'pending'),
          lt(reservations.expiresAt, sql`now()`),
          isNull(reservations.deletedAt),
        ),
      )
      .orderBy(asc(reservations.inventoryId), asc(reservations.id))
      .limit(limit)
      .for('update', { skipLocked: true })

    if (expired.length === 0) return { released: 0, restored: {} as Record<string, number> }

    // inventory ごとに返却枚数を集計
    const restored: Record<string, number> = {}
    for (const r of expired) restored[r.inventoryId] = (restored[r.inventoryId] ?? 0) + r.quantity
    const inventoryIds = Object.keys(restored).sort() // デッドロック防止: id 昇順でロック

    await tx
      .select({ id: ticketInventories.id })
      .from(ticketInventories)
      .where(inArray(ticketInventories.id, inventoryIds))
      .orderBy(asc(ticketInventories.id))
      .for('update')

    await tx
      .update(reservations)
      .set({ status: 'cancelled', updatedAt: sql`now()` })
      .where(
        inArray(
          reservations.id,
          expired.map((r) => r.id),
        ),
      )

    for (const id of inventoryIds) {
      await tx
        .update(ticketInventories)
        .set({ availableSeats: sql`${ticketInventories.availableSeats} + ${restored[id]!}`, updatedAt: sql`now()` })
        .where(eq(ticketInventories.id, id))
    }

    return { released: expired.length, restored }
  })
}

/** 実験用: デモユーザーで「期限切れの仮押さえ」を作る（在庫も減らす） */
export async function createExpiredPending(inventoryId: string, count: number) {
  return db.transaction(async (tx) => {
    await setLockTimeout(tx)
    const [inv] = await tx
      .select({ availableSeats: ticketInventories.availableSeats })
      .from(ticketInventories)
      .where(eq(ticketInventories.id, inventoryId))
      .for('update')
    if (!inv) return { created: 0 }
    // 既に有効な予約を持つデモユーザーは部分ユニークに引っかかるので除外
    const busy = await tx
      .select({ userId: reservations.userId })
      .from(reservations)
      .where(
        and(
          eq(reservations.inventoryId, inventoryId),
          sql`${reservations.status} != 'cancelled'`,
          isNull(reservations.deletedAt),
        ),
      )
    const busyIds = new Set(busy.map((b) => b.userId))
    const candidates = Array.from({ length: 10 }, (_, i) => `demo-user-${i + 1}`).filter((id) => !busyIds.has(id))
    const n = Math.min(count, candidates.length, inv.availableSeats)
    if (n === 0) return { created: 0 }

    await tx.insert(reservations).values(
      candidates.slice(0, n).map((userId) => ({
        userId,
        inventoryId,
        quantity: 1,
        status: 'pending' as const,
        expiresAt: sql`now() - interval '1 minute'`,
      })),
    )
    await tx
      .update(ticketInventories)
      .set({ availableSeats: sql`${ticketInventories.availableSeats} - ${n}`, updatedAt: sql`now()` })
      .where(eq(ticketInventories.id, inventoryId))
    return { created: n }
  })
}
