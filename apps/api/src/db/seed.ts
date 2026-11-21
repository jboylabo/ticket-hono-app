import { sql } from 'drizzle-orm'
import { db, pool } from './client.js'
import { events, ticketInventories, users } from './schema.js'

async function main() {
  await db.execute(sql`TRUNCATE reservations, ticket_inventories, events RESTART IDENTITY CASCADE`)

  // 同時予約シミュレーション用のデモユーザー（ログイン不可・予約主体としてのみ使用）
  await db
    .insert(users)
    .values(
      Array.from({ length: 10 }, (_, i) => ({
        id: `demo-user-${i + 1}`,
        name: `デモ利用者${i + 1}`,
        email: `demo${i + 1}@example.invalid`,
      })),
    )
    .onConflictDoNothing()

  const day = 24 * 60 * 60 * 1000
  const created = await db
    .insert(events)
    .values([
      { title: '🔒 ロック実験室 専用公演', description: '同時予約シミュレーション用のイベントです', startsAt: new Date(Date.now() + 30 * day) },
      { title: '冬のジャズナイト', description: '小さなホールで聴く冬のジャズ', startsAt: new Date(Date.now() + 14 * day) },
      { title: 'インディーズ音楽フェス 2027', description: '1日限りの屋外フェス', startsAt: new Date(Date.now() + 60 * day) },
      { title: '朗読劇「夜行列車」', description: '残りわずか！', startsAt: new Date(Date.now() + 7 * day) },
    ])
    .returning({ id: events.id, title: events.title })

  const [lab, jazz, fes, drama] = created as [(typeof created)[0], (typeof created)[0], (typeof created)[0], (typeof created)[0]]
  await db.insert(ticketInventories).values([
    { eventId: lab.id, ticketTypeName: '実験用', totalCapacity: 100, availableSeats: 10 },
    { eventId: jazz.id, ticketTypeName: '一般', totalCapacity: 80, availableSeats: 80 },
    { eventId: jazz.id, ticketTypeName: 'S席', totalCapacity: 20, availableSeats: 20 },
    { eventId: fes.id, ticketTypeName: '一般', totalCapacity: 500, availableSeats: 500 },
    { eventId: drama.id, ticketTypeName: '一般', totalCapacity: 30, availableSeats: 3 },
  ])

  console.log('seed done:', created.map((e) => e.title).join(', '))
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => pool.end())
