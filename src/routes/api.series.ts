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
          const { getLocalLibraryProvider } = await import(
            '#/server/local-library'
          )
          const provider = await getLocalLibraryProvider()
          const payload = await provider.listSeries()
          return jsonResponse(payload)
        } catch (error) {
          return toApiErrorResponse(error)
        }
      },
    },
  },
})
