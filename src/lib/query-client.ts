import { QueryClient } from '@tanstack/react-query'

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 15 * 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        retry: 1,
      },
    },
  })
}

let browserQueryClient: QueryClient | undefined

export function getQueryClient() {
  if (typeof window === 'undefined') {
    return createQueryClient()
  }

  if (!browserQueryClient) {
    browserQueryClient = createQueryClient()
  }

  return browserQueryClient
}
