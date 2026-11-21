import { and, desc, eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '../db/client.js'
import { events, reservations, ticketInventories } from '../db/schema.js'
import { AppError } from '../errors.js'
import { requireAuth, type AppEnv } from '../middleware/session.js'
import { cancelReservation, reserveTicket, withdrawUser } from '../services/reservation.js'

export const reservationsRoute = new Hono<AppEnv>()
  .use(requireAuth)
  .get('/', async (c) => {
    const user = c.get('user')!
    const rows = await db
      .select({
        id: reservations.id,
        quantity: reservations.quantity,
        status: reservations.status,
        createdAt: reservations.createdAt,
        inventoryId: ticketInventories.id,
        ticketTypeName: ticketInventories.ticketTypeName,
        eventId: events.id,
        eventTitle: events.title,
        startsAt: events.startsAt,
      })
      .from(reservations)
      .innerJoin(ticketInventories, eq(reservations.inventoryId, ticketInventories.id))
      .innerJoin(events, eq(ticketInventories.eventId, events.id))
      .where(and(eq(reservations.userId, user.id), isNull(reservations.deletedAt)))
      .orderBy(desc(reservations.createdAt))
    return c.json(rows)
  })
  .post('/', async (c) => {
    const body = await c.req.json<{ inventoryId?: string; quantity?: number }>()
    if (!body.inventoryId) throw new AppError(400, 'INVALID_INPUT', 'inventoryId は必須です')
    const reservation = await reserveTicket({
      userId: c.get('user')!.id,
      inventoryId: body.inventoryId,
      quantity: Number(body.quantity ?? 1),
    })
    return c.json(reservation, 201)
  })
  .post('/:id/cancel', async (c) => {
    const result = await cancelReservation({ userId: c.get('user')!.id, reservationId: c.req.param('id') })
    return c.json(result)
  })

export const meRoute = new Hono<AppEnv>()
  .get('/', (c) => c.json({ user: c.get('user') }))
  .delete('/', requireAuth, async (c) => {
    await withdrawUser(c.get('user')!.id)
    return c.json({ ok: true })
  })
