import { Alert, Button, Card, PasswordInput, TextInput } from '@mantine/core'
import { useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useActionState } from 'react'
import { authClient } from '~/lib/auth-client'

export const Route = createFileRoute('/signup')({ component: SignupPage })

function SignupPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [error, submit, isPending] = useActionState(async (_prev: string | null, form: FormData) => {
    const { error } = await authClient.signUp.email({
      name: String(form.get('name')),
      email: String(form.get('email')),
      password: String(form.get('password')),
    })
    if (error) return error.message ?? '登録に失敗しました'
    await qc.invalidateQueries()
    navigate({ to: '/' })
    return null
  }, null)

  return (
    <section className="auth-panel">
      <Card withBorder padding="xl">
        <h1 className="page-title">新規登録</h1>
        <form action={submit} className="auth-form">
          {error && <Alert color="red">{error}</Alert>}
          <TextInput name="name" label="お名前" required autoComplete="name" />
          <TextInput name="email" type="email" label="メールアドレス" required autoComplete="email" />
          <PasswordInput name="password" label="パスワード（8文字以上）" required minLength={8} autoComplete="new-password" />
          <Button type="submit" loading={isPending} fullWidth>
            登録する
          </Button>
        </form>
        <p className="auth-switch">
          登録済みの方は <Link to="/login">ログイン</Link>
        </p>
      </Card>
    </section>
  )
}
