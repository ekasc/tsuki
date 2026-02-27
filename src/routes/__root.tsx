import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router'
import { ThemeProvider } from 'next-themes'
import appCss from '../styles.css?url'

import { AppShell } from '#/components/AppShell'
import { ErrorBoundary } from '#/components/ErrorBoundary'
import type { AppRouterContext } from '#/lib/router-context'

export const Route = createRootRouteWithContext<AppRouterContext>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
      { title: 'Tsuki Reader' },
      { name: 'description', content: 'A clean, distraction-free manga reader. Read online or from your files.' },
      { name: 'mobile-web-app-capable', content: 'yes' },
      { name: 'theme-color', content: '#1d140d' },
      { name: 'apple-mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon.ico', sizes: 'any' },
      { rel: 'icon', href: '/tsuki_favicon.png', type: 'image/png' },
      { rel: 'manifest', href: '/manifest.json' },
      { rel: 'apple-touch-icon', href: '/tsuki_favicon.png' },
    ],
  }),
  shellComponent: RootDocument,
  component: RootLayout,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}

function RootLayout() {
  return (
    <ThemeProvider
      attribute="data-theme"
      defaultTheme="system"
      enableSystem
      storageKey="tsuki-theme-mode.v1"
      themes={['light', 'dark', 'paper']}
      disableTransitionOnChange
    >
      <AppShell>
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </AppShell>
    </ThemeProvider>
  )
}
