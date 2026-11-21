import type { LockMode, Outcome } from '~/queries/types'

export const MODE_INFO: Record<
  LockMode,
  { label: string; summary: string; drizzle: string; sql: string; expectation: string }
> = {
  'no-lock': {
    label: 'ロックなし',
    summary:
      '普通の SELECT で残席を読み、アプリ側で「残席 − 枚数」を計算して書き戻します。全員が同じ残席を読むため、後から書いた人が前の人の更新を上書きします（ロストアップデート）。',
    drizzle: `const [inv] = await tx.select().from(ticketInventories)
  .where(eq(ticketInventories.id, id))

await tx.update(ticketInventories)
  .set({ availableSeats: inv.availableSeats - qty }) // ← 読んだ値で上書き`,
    sql: `SELECT id, available_seats FROM ticket_inventories WHERE id = $1;
-- (全員が同じ値 10 を読む)
UPDATE ticket_inventories SET available_seats = 9 WHERE id = $1;`,
    expectation: '5人が予約できたのに残席は1つしか減らない → 整合性 NG',
  },
  'for-update': {
    label: 'FOR UPDATE',
    summary:
      'SELECT ... FOR UPDATE で在庫行に排他ロックをかけます。先着の1人がCOMMITするまで他の人は SELECT の時点で待たされ、1人ずつ順番に処理されます。待ちが lock_timeout(3秒) を超えると 55P03 で失敗します。',
    drizzle: `const [inv] = await tx.select().from(ticketInventories)
  .where(eq(ticketInventories.id, id))
  .for('update')

await tx.update(ticketInventories)
  .set({ availableSeats: sql\`available_seats - \${qty}\` })`,
    sql: `SET LOCAL lock_timeout = '3000ms';
SELECT id, available_seats FROM ticket_inventories
 WHERE id = $1 AND deleted_at IS NULL
 FOR UPDATE;           -- ← ここで待つ
UPDATE ticket_inventories SET available_seats = available_seats - $2 ...;
INSERT INTO reservations ...;
COMMIT;                -- ← ロック解放、次の人が進む`,
    expectation: 'タイムラインが階段状になり、予約数と残席の減少が一致する → 整合性 OK',
  },
  'for-update-nowait': {
    label: 'NOWAIT',
    summary:
      'FOR UPDATE NOWAIT はロックが取れなければ待たずに即エラー(55P03)を返します。「混雑中です、もう一度お試しください」を即座に返したい場面向け。',
    drizzle: `await tx.select().from(ticketInventories)
  .where(eq(ticketInventories.id, id))
  .for('update', { noWait: true })`,
    sql: `SELECT ... FROM ticket_inventories WHERE id = $1
 FOR UPDATE NOWAIT;    -- ロック中なら即 ERROR 55P03`,
    expectation: '先着1人だけ成功し、残りは待たずに即失敗する',
  },
  'for-update-skip-locked': {
    label: 'SKIP LOCKED',
    summary:
      'FOR UPDATE SKIP LOCKED はロック中の行を結果から除外します。1行しかない在庫行だと「行が見つからない」扱いになります。本来はジョブキューや期限切れバッチのように「空いている行から処理する」用途で使います。',
    drizzle: `await tx.select().from(ticketInventories)
  .where(eq(ticketInventories.id, id))
  .for('update', { skipLocked: true })`,
    sql: `SELECT ... FROM ticket_inventories WHERE id = $1
 FOR UPDATE SKIP LOCKED; -- ロック中の行は 0 件として返る`,
    expectation: '先着1人だけ成功し、残りは在庫行が「見えない」のでスキップされる',
  },
}

export const OUTCOME_INFO: Record<Outcome, { label: string; color: string }> = {
  reserved: { label: '予約成功', color: 'teal' },
  sold_out: { label: '売り切れ', color: 'orange' },
  skipped: { label: 'スキップ', color: 'grape' },
  lock_timeout: { label: 'ロック待ちタイムアウト', color: 'red' },
  lock_not_available: { label: 'NOWAIT 失敗', color: 'pink' },
  check_violation: { label: 'CHECK違反', color: 'red' },
  error: { label: 'エラー', color: 'red' },
}
