import { and, asc, eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '../db/client.js'
import { events, ticketInventories } from '../db/schema.js'
import { AppError } from '../errors.js'

const inventoryColumns = {
  id: ticketInventories.id,
  ticketTypeName: ticketInventories.ticketTypeName,
  totalCapacity: ticketInventories.totalCapacity,
  availableSeats: ticketInventories.availableSeats,
}

export const eventsRoute = new Hono()
  .get('/', async (c) => {
    const rows = await db.select().from(events).where(isNull(events.deletedAt)).orderBy(asc(events.startsAt))
    const inventories = await db
      .select({ ...inventoryColumns, eventId: ticketInventories.eventId })
      .from(ticketInventories)
      .where(isNull(ticketInventories.deletedAt))
    return c.json(
      rows.map((e) => ({ ...e, inventories: inventories.filter((i) => i.eventId === e.id) })),
    )
  })
  .get('/:id', async (c) => {
    const id = c.req.param('id')
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError(404, 'EVENT_NOT_FOUND', 'イベントが見つかりません')
    const [event] = await db
      .select()
      .from(events)
      .where(and(eq(events.id, id), isNull(events.deletedAt)))
    if (!event) throw new AppError(404, 'EVENT_NOT_FOUND', 'イベントが見つかりません')
    const inventories = await db
      .select(inventoryColumns)
      .from(ticketInventories)
      .where(and(eq(ticketInventories.eventId, id), isNull(ticketInventories.deletedAt)))
      .orderBy(asc(ticketInventories.ticketTypeName))
    return c.json({ ...event, inventories })
  })
