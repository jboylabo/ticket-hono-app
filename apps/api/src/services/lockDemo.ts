/**
 * ロック実験室: N 人が「同時に」予約ボタンを押した状況をサーバー内で再現する。
 *
 * N 個のトランザクションを Promise.all で一斉に開始し、各トランザクションの
 *   started（BEGIN）→ acquired（SELECT が返った = ロック取得）→ written（UPDATE が返った）→ finished（COMMIT/ROLLBACK）
 * の時刻を記録してフロントでタイムラインとして描画する。
 */
import { and, eq, inArray, isNull, like, sql, sum } from 'drizzle-orm'
import { db, type Tx } from '../db/client.js'
import { reservations, ticketInventories } from '../db/schema.js'
import { AppError, pgCode } from '../errors.js'
import { setLockTimeout } from './reservation.js'

export const LOCK_MODES = ['no-lock', 'for-update', 'for-update-nowait', 'for-update-skip-locked'] as const
export type LockMode = (typeof LOCK_MODES)[number]

export const DEMO_USER_COUNT = 10
export const demoUserId = (i: number) => `demo-user-${i + 1}`

export type SimulationInput = {
  inventoryId: string
  users: number
  quantity: number
  mode: LockMode
  holdMs: number
  initialSeats: number
}

type Outcome = 'reserved' | 'sold_out' | 'skipped' | 'lock_timeout' | 'lock_not_available' | 'check_violation' | 'error'

export type TxTrace = {
  user: string
  pid: number | null
  outcome: Outcome
  message: string
  seenSeats: number | null
  startedAt: number
  acquiredAt: number | null
  writtenAt: number | null
  finishedAt: number
}

/** モードごとに「在庫行を読む」SELECT を組み立てる。ここが学習の主役 */
function selectInventory(tx: Tx, inventoryId: string, mode: LockMode) {
  const q = tx
    .select({ id: ticketInventories.id, availableSeats: ticketInventories.availableSeats })
    .from(ticketInventories)
    .where(and(eq(ticketInventories.id, inventoryId), isNull(ticketInventories.deletedAt)))

  switch (mode) {
    case 'no-lock':
      return q // SELECT ...                          （ロックなし。全員が同じ値を読めてしまう）
    case 'for-update':
      return q.for('update') // SELECT ... FOR UPDATE （先着1人以外は待つ）
    case 'for-update-nowait':
      return q.for('update', { noWait: true }) // FOR UPDATE NOWAIT （待たずに即エラー 55P03）
    case 'for-update-skip-locked':
      return q.for('update', { skipLocked: true }) // FOR UPDATE SKIP LOCKED （ロック中の行は結果から消える）
  }
}

class Abort extends Error {
  constructor(
    public outcome: Outcome,
    message: string,
  ) {
    super(message)
  }
}

async function runOne(input: SimulationInput, index: number, t0: number): Promise<TxTrace> {
  const now = () => Math.round(performance.now() - t0)
  const user = demoUserId(index)
  const trace: TxTrace = {
    user,
    pid: null,
    outcome: 'error',
    message: '',
    seenSeats: null,
    startedAt: now(),
    acquiredAt: null,
    writtenAt: null,
    finishedAt: 0,
  }

  try {
    await db.transaction(async (tx) => {
      const pidRes = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
      trace.pid = pidRes.rows[0]?.pid ?? null
      await setLockTimeout(tx)

      const [inv] = await selectInventory(tx, input.inventoryId, input.mode)
      trace.acquiredAt = now()

      if (!inv) {
        // SKIP LOCKED だと、他人がロック中の行は「存在しない」ように見える
        throw new Abort('skipped', 'ロック中の行がスキップされ、在庫行を取得できませんでした')
      }
      trace.seenSeats = inv.availableSeats
      if (inv.availableSeats < input.quantity) {
        throw new Abort('sold_out', `残席${inv.availableSeats}席 < ${input.quantity}枚 のため売り切れ`)
      }

      // ロックを握ったまま「決済処理などの重い処理」をしている想定
      if (input.holdMs > 0) {
        await tx.execute(sql`SELECT pg_sleep(${input.holdMs / 1000})`)
      }

      if (input.mode === 'no-lock') {
        // アンチパターン: アプリ側で計算した値をそのまま書き戻す（Read-Modify-Write）
        // 全員が同じ残席を読んでいるので、後勝ちで上書きされ「ロストアップデート」になる
        await tx
          .update(ticketInventories)
          .set({ availableSeats: inv.availableSeats - input.quantity, updatedAt: sql`now()` })
          .where(eq(ticketInventories.id, input.inventoryId))
      } else {
        await tx
          .update(ticketInventories)
          .set({
            availableSeats: sql`${ticketInventories.availableSeats} - ${input.quantity}`,
            updatedAt: sql`now()`,
          })
          .where(eq(ticketInventories.id, input.inventoryId))
      }
      trace.writtenAt = now()

      await tx.insert(reservations).values({
        userId: user,
        inventoryId: input.inventoryId,
        quantity: input.quantity,
        status: 'confirmed',
      })
    })
    trace.outcome = 'reserved'
    trace.message = `予約成功（読んだ残席: ${trace.seenSeats}）`
  } catch (err) {
    if (err instanceof Abort) {
      trace.outcome = err.outcome
      trace.message = err.message
    } else {
      const code = pgCode(err)
      const detail = (err as { cause?: { message?: string } }).cause?.message ?? (err as Error).message
      if (code === '55P03') {
        const nowait = input.mode === 'for-update-nowait' && trace.acquiredAt === null
        trace.outcome = nowait ? 'lock_not_available' : 'lock_timeout'
        trace.message = nowait ? 'NOWAIT: ロック中のため即座に失敗 (55P03)' : 'lock_timeout(3秒) を超えて失敗 (55P03)'
      } else if (code === '23514') {
        trace.outcome = 'check_violation'
        trace.message = 'CHECK 制約 available_seats >= 0 違反で失敗 (23514)'
      } else {
        trace.outcome = 'error'
        trace.message = `${code ?? ''} ${detail}`.trim()
      }
    }
  }
  trace.finishedAt = now()
  return trace
}

/** デモユーザーの予約を消して残席を初期値に戻す */
export async function resetLab(inventoryId: string, initialSeats: number) {
  await db.transaction(async (tx) => {
    const [inv] = await tx
      .select({ totalCapacity: ticketInventories.totalCapacity })
      .from(ticketInventories)
      .where(eq(ticketInventories.id, inventoryId))
      .for('update')
    if (!inv) throw new AppError(404, 'INVENTORY_NOT_FOUND', 'チケットが見つかりません')
    if (initialSeats < 0 || initialSeats > inv.totalCapacity) {
      throw new AppError(400, 'INVALID_SEATS', `初期残席は 0〜${inv.totalCapacity} で指定してください`)
    }
    await tx
      .delete(reservations)
      .where(and(eq(reservations.inventoryId, inventoryId), like(reservations.userId, 'demo-user-%')))
    await tx
      .update(ticketInventories)
      .set({ availableSeats: initialSeats, updatedAt: sql`now()` })
      .where(eq(ticketInventories.id, inventoryId))
  })
}

export async function simulate(input: SimulationInput) {
  if (!LOCK_MODES.includes(input.mode)) throw new AppError(400, 'INVALID_MODE', '不明なモードです')
  if (input.users < 1 || input.users > DEMO_USER_COUNT) {
    throw new AppError(400, 'INVALID_USERS', `人数は1〜${DEMO_USER_COUNT}人で指定してください`)
  }
  if (input.quantity < 1 || input.quantity > 10) throw new AppError(400, 'INVALID_QUANTITY', '枚数は1〜10枚')
  if (input.holdMs < 0 || input.holdMs > 5000) throw new AppError(400, 'INVALID_HOLD', '保持時間は0〜5000ms')

  await resetLab(input.inventoryId, input.initialSeats)

  const t0 = performance.now()
  // ここで N 個のトランザクションが「同時に」走る
  const traces = await Promise.all(Array.from({ length: input.users }, (_, i) => runOne(input, i, t0)))

  const [after] = await db
    .select({ availableSeats: ticketInventories.availableSeats })
    .from(ticketInventories)
    .where(eq(ticketInventories.id, input.inventoryId))

  const [reserved] = await db
    .select({ total: sum(reservations.quantity).mapWith(Number) })
    .from(reservations)
    .where(
      and(
        eq(reservations.inventoryId, input.inventoryId),
        inArray(
          reservations.userId,
          traces.map((t) => t.user),
        ),
        eq(reservations.status, 'confirmed'),
      ),
    )

  const reservedSeats = reserved?.total ?? 0
  const finalSeats = after?.availableSeats ?? 0
  const expectedSeats = input.initialSeats - reservedSeats

  return {
    input,
    traces,
    summary: {
      initialSeats: input.initialSeats,
      finalSeats,
      reservedSeats,
      expectedSeats,
      consistent: finalSeats === expectedSeats,
      totalMs: Math.max(...traces.map((t) => t.finishedAt)),
    },
  }
}

/** 実行中のトランザクションと「誰が誰を待っているか」を pg_stat_activity から取得 */
export async function currentLocks() {
  const res = await db.execute<{
    pid: number
    state: string
    wait_event_type: string | null
    wait_event: string | null
    blocked_by: number[]
    xact_ms: number | null
    query: string
  }>(sql`
    SELECT a.pid,
           a.state,
           a.wait_event_type,
           a.wait_event,
           pg_blocking_pids(a.pid) AS blocked_by,
           (EXTRACT(EPOCH FROM now() - a.xact_start) * 1000)::int AS xact_ms,
           left(a.query, 200) AS query
    FROM pg_stat_activity a
    WHERE a.datname = current_database()
      AND a.pid <> pg_backend_pid()
      AND a.backend_type = 'client backend'
      AND a.xact_start IS NOT NULL
    ORDER BY a.xact_start
  `)
  return res.rows
}
