import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { auth } from './auth.js'
import { AppError, translatePgError } from './errors.js'
import { sessionMiddleware, type AppEnv } from './middleware/session.js'
import { eventsRoute } from './routes/events.js'
import { labRoute } from './routes/lab.js'
import { meRoute, reservationsRoute } from './routes/reservations.js'

const app = new Hono<AppEnv>()

app.use('*', logger())
app.use(
  '/api/*',
  cors({
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
    credentials: true,
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  }),
)

app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw))

app.use('/api/*', sessionMiddleware)
app.route('/api/events', eventsRoute)
app.route('/api/reservations', reservationsRoute)
app.route('/api/me', meRoute)
app.route('/api/lab', labRoute)

app.onError((err, c) => {
  const appErr = err instanceof AppError ? err : translatePgError(err)
  if (appErr) return c.json({ code: appErr.code, message: appErr.message }, appErr.status)
  console.error(err)
  return c.json({ code: 'INTERNAL', message: 'サーバーエラーが発生しました' }, 500)
})

const port = Number(process.env.PORT ?? 3000)
serve({ fetch: app.fetch, port }, () => console.log(`API listening on http://localhost:${port}`))
