import { createFileRoute } from '@tanstack/react-router'

const createAnyFileRoute = createFileRoute as any

export const Route = createAnyFileRoute('/api/series/$seriesId')({
  server: {
    handlers: {
      GET: async ({ params }: { params: { seriesId: string } }) => {
        const { jsonResponse, toApiErrorResponse } = await import(
          '#/server/api/http'
        )

        try {
          const { getLocalLibraryProvider } = await import(
            '#/server/local-library'
          )
          const { HttpError } = await import('#/server/errors')

          const provider = await getLocalLibraryProvider()
          const series = await provider.getSeries(params.seriesId)

          if (!series) {
            throw new HttpError(404, 'Series not found')
          }

          return jsonResponse(series)
        } catch (error) {
          return toApiErrorResponse(error)
        }
      },
      DELETE: async ({ params }: { params: { seriesId: string } }) => {
        const { noContentResponse, toApiErrorResponse } = await import(
          '#/server/api/http'
        )

        try {
          const { getLocalLibraryProvider } = await import(
            '#/server/local-library'
          )
          const { HttpError } = await import('#/server/errors')

          const provider = await getLocalLibraryProvider()
          const deleted = await provider.deleteSeries(params.seriesId)
          if (!deleted) {
            throw new HttpError(404, 'Series not found')
          }

          return noContentResponse()
        } catch (error) {
          return toApiErrorResponse(error)
        }
      },
    },
  },
})
