# SQL
実運用で必須となる行ロック・デッドロック対策・論理削除を含むトランザクションSQLです。PostgreSQL 15以降を想定しています。
1. テーブル定義・制約・インデックス（DDL）
```sql
-- ENUM型の定義
CREATE TYPE user_role AS ENUM ('user', 'admin');
CREATE TYPE reservation_status AS ENUM ('pending', 'confirmed', 'cancelled');

-- 1. ユーザー管理（Better Auth拡張 ＋ 論理削除）
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  image TEXT,
  role user_role NOT NULL DEFAULT 'user',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP
);

-- 論理削除済みユーザーを除外した部分ユニークインデックス（退会後の再登録を許可）
CREATE UNIQUE INDEX users_email_active_idx
  ON users (email)
  WHERE deleted_at IS NULL;

-- 2. Better Auth 認証関連テーブル
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  expires_at TIMESTAMP NOT NULL,
  token TEXT NOT NULL UNIQUE,
  ip_address TEXT,
  user_agent TEXT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  expires_at TIMESTAMP,
  password TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE verifications (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 3. イベント本体
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  starts_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP
);

-- 4. チケット在庫（行ロック専用テーブル）
CREATE TABLE ticket_inventories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id),
  ticket_type_name TEXT NOT NULL DEFAULT '一般',
  total_capacity INTEGER NOT NULL,
  available_seats INTEGER NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP,
  -- DBレベルの最終防衛線（在庫割れ・過剰返却の防止）
  CONSTRAINT available_seats_non_negative CHECK (available_seats >= 0),
  CONSTRAINT available_seats_within_capacity CHECK (available_seats <= total_capacity)
);

-- 5. 予約明細（論理削除 ＋ 二重予約防止）
CREATE TABLE reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id),
  inventory_id UUID NOT NULL REFERENCES ticket_inventories(id),
  quantity INTEGER NOT NULL,
  status reservation_status NOT NULL DEFAULT 'confirmed',
  expires_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP,
  CONSTRAINT quantity_positive CHECK (quantity > 0)
);

-- 有効な予約（キャンセル・論理削除以外）に対する重複予約防止インデックス
CREATE UNIQUE INDEX reservations_user_inventory_active_idx
  ON reservations (user_id, inventory_id)
  WHERE status != 'cancelled' AND deleted_at IS NULL;
```


2. 実践トランザクションSQL（行ロック・デッドロック・論理削除）


① チケット予約処理（行ロック ＋ タイムアウト設定）

ticket_inventories の対象行だけをロックし、ロック待ちが3秒を超えたら自動中断してデッドロックや接続枯渇を防ぎます。

```sql
BEGIN;

-- ロック待ちの上限を3秒に設定（接続プール枯渇防止）
SET LOCAL lock_timeout = '3000ms';

-- 1. 対象在庫の行ロック取得（有効な在庫のみ）
-- ※複数券種を同時予約する場合は ORDER BY id ASC を必ず付けてロック順序を統一する
SELECT id, available_seats
FROM ticket_inventories
WHERE id = $1
  AND deleted_at IS NULL
FOR UPDATE;

-- アプリケーション側で available_seats >= $quantity を確認後、在庫を減算
UPDATE ticket_inventories
SET available_seats = available_seats - $2,
    updated_at = NOW()
WHERE id = $1
  AND deleted_at IS NULL
  AND available_seats >= $2;

-- 2. 予約レコードの作成
INSERT INTO reservations (user_id, inventory_id, quantity, status)
VALUES ($3, $1, $2, 'confirmed')
RETURNING id;

COMMIT;
```


② 予約キャンセル処理（デッドロック防止のロック順序）

キャンセル時は「予約行」と「在庫行」の2つを更新するため、必ず先に ticket_inventories（親側）をロックしてから reservations を更新し、予約処理とロック順序を揃えます。

```sql
BEGIN;
SET LOCAL lock_timeout = '3000ms';

-- 1. 先に在庫行をロック（予約トランザクションとロック順序を統一）
SELECT id
FROM ticket_inventories
WHERE id = $2
FOR UPDATE;

-- 2. 有効な予約をキャンセル状態に更新（二重キャンセル防止のため status != 'cancelled' を条件に含める）
UPDATE reservations
SET status = 'cancelled',
    updated_at = NOW()
WHERE id = $1
  AND user_id = $3
  AND inventory_id = $2
  AND status != 'cancelled'
  AND deleted_at IS NULL
RETURNING quantity;

-- 3. 取得した quantity 分だけ在庫を返却
UPDATE ticket_inventories
SET available_seats = available_seats + $4,
    updated_at = NOW()
WHERE id = $2;

COMMIT;
```


③ ユーザーの論理削除（退会処理 ＋ 強制ログアウト）

Better Authのセッションを即時無効化しつつ、未来の予約をキャンセルして在庫を戻す一括トランザクションです。

```sql
BEGIN;

-- 1. 未来の有効な予約をキャンセルし、返却すべき在庫数を集計
WITH cancelled_res AS (
  UPDATE reservations r
  SET status = 'cancelled',
      deleted_at = NOW(),
      updated_at = NOW()
  FROM ticket_inventories ti
  JOIN events e ON ti.event_id = e.id
  WHERE r.inventory_id = ti.id
    AND r.user_id = $1
    AND r.status != 'cancelled'
    AND r.deleted_at IS NULL
    AND e.starts_at > NOW()
  RETURNING r.inventory_id, r.quantity
),
-- デッドロック防止のため inventory_id 昇順で集計
restored_counts AS (
  SELECT inventory_id, SUM(quantity) AS total_qty
  FROM cancelled_res
  GROUP BY inventory_id
  ORDER BY inventory_id ASC
)
-- 2. 在庫の返却
UPDATE ticket_inventories ti
SET available_seats = ti.available_seats + rc.total_qty,
    updated_at = NOW()
FROM restored_counts rc
WHERE ti.id = rc.inventory_id;

-- 3. ユーザーを論理削除（OAuth再連携時の衝突防止のためメールアドレスも退避）
UPDATE users
SET deleted_at = NOW(),
    email = 'deleted_' || id || '_' || email,
    updated_at = NOW()
WHERE id = $1
  AND deleted_at IS NULL;

-- 4. アクティブなセッションを物理削除して強制ログアウト
DELETE FROM sessions
WHERE user_id = $1;

COMMIT;
```


④ 仮押さえ（pending）期限切れの自動解放バッチ

バッチ処理と通常の予約処理がぶつかってロック待ちにならないよう、FOR UPDATE SKIP LOCKED（ロック中の行はスキップ）を使います。

```sql
BEGIN;

WITH expired_reservations AS (
  SELECT r.id, r.inventory_id, r.quantity
  FROM reservations r
  WHERE r.status = 'pending'
    AND r.expires_at < NOW()
    AND r.deleted_at IS NULL
  ORDER BY r.inventory_id ASC, r.id ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 100
),
updated_res AS (
  UPDATE reservations r
  SET status = 'cancelled',
      updated_at = NOW()
  FROM expired_reservations er
  WHERE r.id = er.id
  RETURNING er.inventory_id, er.quantity
),
aggregated AS (
  SELECT inventory_id, SUM(quantity) AS total_qty
  FROM updated_res
  GROUP BY inventory_id
  ORDER BY inventory_id ASC
)
UPDATE ticket_inventories ti
SET available_seats = ti.available_seats + a.total_qty,
    updated_at = NOW()
FROM aggregated a
WHERE ti.id = a.inventory_id;

COMMIT;
```