import { Hono } from 'hono'
import { AppError } from '../errors.js'
import { createExpiredPending, releaseExpiredPending } from '../services/expireBatch.js'
import { currentLocks, resetLab, simulate, type SimulationInput } from '../services/lockDemo.js'

// ローカル学習用のエンドポイント（本番では公開しない想定）
export const labRoute = new Hono()
  .post('/simulate', async (c) => {
    const b = await c.req.json<Partial<SimulationInput>>()
    if (!b.inventoryId || !b.mode) throw new AppError(400, 'INVALID_INPUT', 'inventoryId と mode は必須です')
    const result = await simulate({
      inventoryId: b.inventoryId,
      mode: b.mode,
      users: Number(b.users ?? 5),
      quantity: Number(b.quantity ?? 1),
      holdMs: Number(b.holdMs ?? 500),
      initialSeats: Number(b.initialSeats ?? 10),
    })
    return c.json(result)
  })
  .post('/reset', async (c) => {
    const b = await c.req.json<{ inventoryId?: string; initialSeats?: number }>()
    if (!b.inventoryId) throw new AppError(400, 'INVALID_INPUT', 'inventoryId は必須です')
    await resetLab(b.inventoryId, Number(b.initialSeats ?? 10))
    return c.json({ ok: true })
  })
  .get('/locks', async (c) => c.json(await currentLocks()))
  .post('/pending', async (c) => {
    const b = await c.req.json<{ inventoryId?: string; count?: number }>()
    if (!b.inventoryId) throw new AppError(400, 'INVALID_INPUT', 'inventoryId は必須です')
    return c.json(await createExpiredPending(b.inventoryId, Number(b.count ?? 3)))
  })
  .post('/expire-batch', async (c) => c.json(await releaseExpiredPending()))
