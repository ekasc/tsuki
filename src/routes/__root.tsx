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
import { absoluteUrl, DEFAULT_OG_IMAGE_PATH, SITE_URL } from '#/lib/seo'
import type { AppRouterContext } from '#/lib/router-context'

const TSUKI_DEFAULT_TITLE = 'Tsuki Reader'
const TSUKI_DEFAULT_DESCRIPTION =
  'Read manga online in a fast, old-school reader with right-to-left paging, smooth navigation, and no clutter.'
const TSUKI_JSON_LD = [
  {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: TSUKI_DEFAULT_TITLE,
    url: SITE_URL,
    description: TSUKI_DEFAULT_DESCRIPTION,
  },
  {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: TSUKI_DEFAULT_TITLE,
    url: SITE_URL,
    applicationCategory: 'EntertainmentApplication',
    operatingSystem: 'iOS, Android, macOS, Windows, Linux',
    isAccessibleForFree: true,
    description: TSUKI_DEFAULT_DESCRIPTION,
  },
]

export const Route = createRootRouteWithContext<AppRouterContext>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1, viewport-fit=cover',
      },
      { title: TSUKI_DEFAULT_TITLE },
      { name: 'description', content: TSUKI_DEFAULT_DESCRIPTION },
      { name: 'robots', content: 'index,follow,max-image-preview:large' },
      {
        name: 'googlebot',
        content: 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1',
      },
      { name: 'referrer', content: 'strict-origin-when-cross-origin' },
      { name: 'application-name', content: TSUKI_DEFAULT_TITLE },
      { name: 'apple-mobile-web-app-title', content: TSUKI_DEFAULT_TITLE },
      { name: 'mobile-web-app-capable', content: 'yes' },
      { name: 'theme-color', content: '#1d140d' },
      { name: 'apple-mobile-web-app-capable', content: 'yes' },
      {
        name: 'apple-mobile-web-app-status-bar-style',
        content: 'black-translucent',
      },
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: TSUKI_DEFAULT_TITLE },
      { property: 'og:title', content: TSUKI_DEFAULT_TITLE },
      { property: 'og:description', content: TSUKI_DEFAULT_DESCRIPTION },
      { property: 'og:url', content: SITE_URL },
      { property: 'og:locale', content: 'en_US' },
      { property: 'og:image', content: absoluteUrl(DEFAULT_OG_IMAGE_PATH) },
      { property: 'og:image:alt', content: 'Tsuki Reader icon' },
      { property: 'og:image:width', content: '512' },
      { property: 'og:image:height', content: '512' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: TSUKI_DEFAULT_TITLE },
      { name: 'twitter:description', content: TSUKI_DEFAULT_DESCRIPTION },
      { name: 'twitter:image', content: absoluteUrl(DEFAULT_OG_IMAGE_PATH) },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon.png', type: 'image/png' },
      {
        rel: 'icon',
        href: '/favicon-32x32.png',
        type: 'image/png',
        sizes: '32x32',
      },
      {
        rel: 'icon',
        href: '/favicon-16x16.png',
        type: 'image/png',
        sizes: '16x16',
      },
      { rel: 'manifest', href: '/manifest.json' },
      {
        rel: 'apple-touch-icon',
        href: '/apple-touch-icon.png',
        sizes: '180x180',
      },
      { rel: 'sitemap', href: '/sitemap.xml', type: 'application/xml' },
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
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(TSUKI_JSON_LD) }}
        />
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
