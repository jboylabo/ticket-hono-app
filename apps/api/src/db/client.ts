import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from './schema.js'

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  // 同時予約シミュレーション（最大10トランザクション）＋ロック監視クエリ分の余裕を持たせる
  max: 30,
})

export const db = drizzle(pool, { schema, logger: process.env.SQL_LOG === '1' })
export type DB = typeof db
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0]
