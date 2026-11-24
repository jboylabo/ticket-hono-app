# ER 図

DB スキーマ（`docs/sql.md` / `apps/api/src/db/schema.ts`）の ER 図です。

```mermaid
erDiagram
    users ||--o{ sessions : "1:N"
    users ||--o{ accounts : "1:N"
    users ||--o{ reservations : "1:N"
    events ||--o{ ticket_inventories : "1:N"
    ticket_inventories ||--o{ reservations : "1:N"
    verifications ||--|| users : "email verification"

    users {
        text id PK
        text name
        text email "部分ユニーク: deleted_at IS NULL"
        boolean email_verified
        text image
        user_role role "user | admin"
        timestamp created_at
        timestamp updated_at
        timestamp deleted_at "論理削除"
    }

    sessions {
        text id PK
        timestamp expires_at
        text token UK
        text ip_address
        text user_agent
        text user_id FK "users.id ON DELETE CASCADE"
        timestamp created_at
        timestamp updated_at
    }

    accounts {
        text id PK
        text account_id
        text provider_id
        text user_id FK "users.id ON DELETE CASCADE"
        text access_token
        text refresh_token
        text id_token
        timestamp access_token_expires_at
        timestamp refresh_token_expires_at
        text scope
        text password
        timestamp created_at
        timestamp updated_at
    }

    verifications {
        text id PK
        text identifier
        text value
        timestamp expires_at
        timestamp created_at
        timestamp updated_at
    }

    events {
        uuid id PK
        text title
        text description
        timestamp starts_at
        timestamp created_at
        timestamp updated_at
        timestamp deleted_at "論理削除"
    }

    ticket_inventories {
        uuid id PK
        uuid event_id FK "events.id"
        text ticket_type_name "default '一般'"
        integer total_capacity
        integer available_seats "CHECK: 0 <= seats <= capacity"
        timestamp updated_at
        timestamp deleted_at "論理削除"
    }

    reservations {
        uuid id PK
        text user_id FK "users.id"
        uuid inventory_id FK "ticket_inventories.id"
        integer quantity "CHECK: quantity > 0"
        reservation_status status "pending | confirmed | cancelled"
        timestamp expires_at
        timestamp created_at
        timestamp updated_at
        timestamp deleted_at "論理削除"
    }
```

## 主な制約

| 対象 | 制約 | 目的 |
|---|---|---|
| `users.email` | 部分ユニーク（`deleted_at IS NULL`） | 退会後の再登録を許可 |
| `ticket_inventories.available_seats` | CHECK `>= 0` / `<= total_capacity` | 在庫割れ・過剰返却の最終防衛線 |
| `reservations.quantity` | CHECK `> 0` | 不正な予約数の防止 |
| `reservations (user_id, inventory_id)` | 部分ユニーク（`status != 'cancelled' AND deleted_at IS NULL`） | 二重予約の防止 |

`reservations` への書き込みは必ず `ticket_inventories` の行を先に `FOR UPDATE` でロックしてから行います（デッドロック防止のロック順序統一）。詳細は `docs/sql.md` を参照。
