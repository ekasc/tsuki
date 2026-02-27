import { createFileRoute } from '@tanstack/react-router'

const createAnyFileRoute = createFileRoute as any

export const Route = createAnyFileRoute('/api/series')({
  server: {
    handlers: {
      GET: async () => {
        const { jsonResponse, toApiErrorResponse } = await import(
          '#/server/api/http'
        )

        try {
          const { assertLocalLibraryEnabled } = await import('#/server/runtime')
          assertLocalLibraryEnabled()

          const { ensureServerReady } = await import('#/server/bootstrap')
          const { listLibrarySeries } = await import('#/server/db/repository')

          await ensureServerReady()
          const payload = listLibrarySeries()
          return jsonResponse(payload)
        } catch (error) {
          return toApiErrorResponse(error)
        }
      },
    },
  },
})
