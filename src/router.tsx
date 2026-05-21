import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'

import { getQueryClient } from '#/lib/query-client'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  const queryClient = getQueryClient()
  const router = createTanStackRouter({
    routeTree,
    context: {
      queryClient,
    },
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultStaleTime: 30_000,
    defaultPreloadStaleTime: 60_000,
    defaultGcTime: 15 * 60_000,
  })

  setupRouterSsrQueryIntegration({ router, queryClient })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
