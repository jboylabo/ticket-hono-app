import { createMiddleware } from 'hono/factory'
import { auth, type AuthUser } from '../auth.js'
import { AppError } from '../errors.js'

export type AppEnv = { Variables: { user: AuthUser | null } }

export const sessionMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  c.set('user', session && !session.user.deletedAt ? session.user : null)
  await next()
})

export const requireAuth = createMiddleware<{ Variables: { user: AuthUser } }>(async (c, next) => {
  if (!c.get('user')) throw new AppError(401, 'UNAUTHORIZED', 'ログインしてください')
  await next()
})
