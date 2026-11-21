import { Alert, Button, Card, PasswordInput, TextInput } from '@mantine/core'
import { useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useActionState } from 'react'
import { authClient } from '~/lib/auth-client'

export const Route = createFileRoute('/login')({
  validateSearch: (s: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof s.redirect === 'string' && s.redirect.startsWith('/') ? s.redirect : undefined,
  }),
  component: LoginPage,
})

function LoginPage() {
  const { redirect } = Route.useSearch()
  const navigate = useNavigate()
  const qc = useQueryClient()

  // React 19 の useActionState でフォーム送信の pending / エラーを管理
  const [error, submit, isPending] = useActionState(async (_prev: string | null, form: FormData) => {
    const { error } = await authClient.signIn.email({
      email: String(form.get('email')),
      password: String(form.get('password')),
    })
    if (error) return error.message ?? 'ログインに失敗しました'
    await qc.invalidateQueries()
    navigate({ to: redirect ?? '/' })
    return null
  }, null)

  return (
    <section className="auth-panel">
      <Card withBorder padding="xl">
        <h1 className="page-title">ログイン</h1>
        <form action={submit} className="auth-form">
          {error && <Alert color="red">{error}</Alert>}
          <TextInput name="email" type="email" label="メールアドレス" required autoComplete="email" />
          <PasswordInput name="password" label="パスワード" required autoComplete="current-password" />
          <Button type="submit" loading={isPending} fullWidth>
            ログイン
          </Button>
        </form>
        <p className="auth-switch">
          アカウントがない方は <Link to="/signup">新規登録</Link>
        </p>
      </Card>
    </section>
  )
}
