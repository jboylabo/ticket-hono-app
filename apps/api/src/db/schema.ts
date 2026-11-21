/**
 * docs/sql.md の DDL を Drizzle で表現したスキーマ。
 * - CHECK 制約: 在庫割れ（available_seats < 0）を DB レベルで防ぐ最終防衛線
 * - 部分ユニークインデックス: 論理削除・キャンセル済みを除外して二重予約を防ぐ
 */
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

export const userRole = pgEnum('user_role', ['user', 'admin'])
export const reservationStatus = pgEnum('reservation_status', ['pending', 'confirmed', 'cancelled'])

// ---------------------------------------------------------------------------
// 1. ユーザー管理（Better Auth 拡張 ＋ 論理削除）
// ---------------------------------------------------------------------------
export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    role: userRole('role').notNull().default('user'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    deletedAt: timestamp('deleted_at'),
  },
  (t) => [
    // 退会後の再登録を許可するため、論理削除済みを除外したユニーク
    uniqueIndex('users_email_active_idx').on(t.email).where(sql`deleted_at IS NULL`),
  ],
)

// ---------------------------------------------------------------------------
// 2. Better Auth 認証関連テーブル
// ---------------------------------------------------------------------------
export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const accounts = pgTable('accounts', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  // Better Auth が要求するカラム（sql.md の expires_at を access/refresh に分割）
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const verifications = pgTable('verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
})

// ---------------------------------------------------------------------------
// 3. イベント本体
// ---------------------------------------------------------------------------
export const events = pgTable('events', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  description: text('description'),
  startsAt: timestamp('starts_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
})

// ---------------------------------------------------------------------------
// 4. チケット在庫（行ロック専用テーブル）
//    SELECT ... FOR UPDATE の対象はこの行。予約・キャンセルは必ずここを先にロックする。
// ---------------------------------------------------------------------------
export const ticketInventories = pgTable(
  'ticket_inventories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    ticketTypeName: text('ticket_type_name').notNull().default('一般'),
    totalCapacity: integer('total_capacity').notNull(),
    availableSeats: integer('available_seats').notNull(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    deletedAt: timestamp('deleted_at'),
  },
  (t) => [
    check('available_seats_non_negative', sql`${t.availableSeats} >= 0`),
    check('available_seats_within_capacity', sql`${t.availableSeats} <= ${t.totalCapacity}`),
    index('ticket_inventories_event_idx').on(t.eventId),
  ],
)

// ---------------------------------------------------------------------------
// 5. 予約明細（論理削除 ＋ 二重予約防止）
// ---------------------------------------------------------------------------
export const reservations = pgTable(
  'reservations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    inventoryId: uuid('inventory_id')
      .notNull()
      .references(() => ticketInventories.id),
    quantity: integer('quantity').notNull(),
    status: reservationStatus('status').notNull().default('confirmed'),
    expiresAt: timestamp('expires_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    deletedAt: timestamp('deleted_at'),
  },
  (t) => [
    check('quantity_positive', sql`${t.quantity} > 0`),
    uniqueIndex('reservations_user_inventory_active_idx')
      .on(t.userId, t.inventoryId)
      .where(sql`status != 'cancelled' AND deleted_at IS NULL`),
  ],
)
