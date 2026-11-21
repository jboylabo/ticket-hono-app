/// <reference types="vite/client" />
import { ColorSchemeScript, MantineProvider, createTheme, mantineHtmlProps } from '@mantine/core'
import mantineCss from '@mantine/core/styles.css?url'
import { Notifications } from '@mantine/notifications'
import notificationsCss from '@mantine/notifications/styles.css?url'
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { SiteHeader } from '~/components/SiteHeader'
import layoutCss from '~/styles/layout.css?url'

const theme = createTheme({
  primaryColor: 'indigo',
  fontFamily: '"Hiragino Sans", "Noto Sans JP", system-ui, sans-serif',
  defaultRadius: 'md',
})

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'チケット予約 × 行ロック実験室' },
    ],
    links: [
      { rel: 'stylesheet', href: mantineCss },
      { rel: 'stylesheet', href: notificationsCss },
      { rel: 'stylesheet', href: layoutCss },
    ],
  }),
  shellComponent: RootDocument,
  component: RootComponent,
  notFoundComponent: () => <p className="empty-state">ページが見つかりません</p>,
})

function RootComponent() {
  const { queryClient } = Route.useRouteContext()
  return (
    <QueryClientProvider client={queryClient}>
      <MantineProvider theme={theme}>
        <Notifications position="top-right" />
        <div className="page-shell">
          <SiteHeader />
          <main className="page-main">
            <Outlet />
          </main>
          <footer className="site-footer">ローカル学習用アプリ — Hono / Drizzle / PostgreSQL 17 / TanStack Start</footer>
        </div>
      </MantineProvider>
    </QueryClientProvider>
  )
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="ja" {...mantineHtmlProps}>
      <head>
        <ColorSchemeScript />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
