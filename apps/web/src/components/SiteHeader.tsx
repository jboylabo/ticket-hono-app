import { Button } from '@mantine/core'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { authClient } from '~/lib/auth-client'

export function SiteHeader() {
  const { data: session, isPending } = authClient.useSession()
  const qc = useQueryClient()
  const navigate = useNavigate()

  const signOut = async () => {
    await authClient.signOut()
    qc.clear()
    navigate({ to: '/' })
  }

  return (
    <header className="site-header">
      <Link to="/" className="site-logo">
        🎫 TicketLock
      </Link>
      <nav className="site-nav">
        <Link to="/" className="site-nav-link" activeOptions={{ exact: true }}>
          イベント
        </Link>
        <Link to="/lab" className="site-nav-link">
          🔒 ロック実験室
        </Link>
        {session && (
          <Link to="/me" className="site-nav-link">
            マイページ
          </Link>
        )}
      </nav>
      <div className="site-auth">
        {isPending ? null : session ? (
          <>
            <span className="site-user-name">{session.user.name} さん</span>
            <Button variant="subtle" size="xs" onClick={signOut}>
              ログアウト
            </Button>
          </>
        ) : (
          <>
            <Button component={Link} to="/login" variant="subtle" size="xs">
              ログイン
            </Button>
            <Button component={Link} to="/signup" size="xs">
              新規登録
            </Button>
          </>
        )}
      </div>
    </header>
  )
}
