# TicketLock — チケット予約 × 行ロック学習アプリ

Hono + Drizzle + PostgreSQL 17 / TanStack Start + Mantine で作った、ローカル専用のチケット予約アプリ。
DB設計は `docs/sql.md` を参照してください。

## 起動
```bash
docker compose up -d          # PostgreSQL 17 (localhost:5432)
pnpm install
pnpm db:migrate               # drizzle-kit migrate
pnpm db:seed                  # イベント・在庫・デモ利用者10人
pnpm dev                      # API http://localhost:3000 / Web http://localhost:5173
```
`SQL_LOG=1 pnpm dev` で Drizzle が発行する SQL をコンソールに出力します。

## 見どころ
| 場所 | 内容 |
|---|---|
| `apps/api/src/db/schema.ts` | CHECK 制約・部分ユニークインデックスを Drizzle で定義 |
| `apps/api/src/services/reservation.ts` | 予約/キャンセル/退会。`.for('update')` と `SET LOCAL lock_timeout`、ロック順序の統一 |
| `apps/api/src/services/lockDemo.ts` | N 人同時予約シミュレータ（no-lock / FOR UPDATE / NOWAIT / SKIP LOCKED） |
| `apps/api/src/services/expireBatch.ts` | 期限切れ仮押さえを `FOR UPDATE SKIP LOCKED` で解放するバッチ |
| `/lab`（Web） | ロック実験室。タイムライン・pg_stat_activity のライブ監視 |

## ロック実験室で試すこと
1. **ロックなし × 5人** → 5人予約できたのに残席は1しか減らない（ロストアップデート）
2. **FOR UPDATE × 5人** → タイムラインが階段状になり整合性 OK
3. **NOWAIT** → 先着1人以外は即 55P03
4. **SKIP LOCKED** → 先着1人以外は在庫行が「見えない」
5. **FOR UPDATE × 2人 × 保持4000ms** → 2人目が lock_timeout(3秒) で失敗
6. **初期残席2 × 5人** → 2人成功・3人売り切れ（在庫割れしない）

## エラーコード対応
| PostgreSQL | 意味 | API レスポンス |
|---|---|---|
| 55P03 | lock_timeout 超過 / NOWAIT | 409 `LOCK_TIMEOUT` |
| 23514 | CHECK 違反（残席 < 0） | 409 `SOLD_OUT` |
| 23505 | 部分ユニーク違反（二重予約） | 409 `ALREADY_RESERVED` |
| 40P01 | デッドロック検出 | 409 `DEADLOCK` |
