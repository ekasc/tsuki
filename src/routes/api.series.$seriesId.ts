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
          const { assertLocalLibraryEnabled } = await import('#/server/runtime')
          assertLocalLibraryEnabled()

          const { ensureServerReady } = await import('#/server/bootstrap')
          const { getSeriesDetail } = await import('#/server/db/repository')
          const { HttpError } = await import('#/server/errors')

          await ensureServerReady()
          const series = getSeriesDetail(params.seriesId)

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
          const { assertLocalLibraryEnabled } = await import('#/server/runtime')
          assertLocalLibraryEnabled()

          const { ensureServerReady } = await import('#/server/bootstrap')
          const { deleteSeriesById, getSeriesDetail } = await import(
            '#/server/db/repository'
          )
          const { removeDirectory, safeResolveDataPath } = await import(
            '#/server/fs'
          )
          const { HttpError } = await import('#/server/errors')

          await ensureServerReady()

          const series = getSeriesDetail(params.seriesId)
          if (!series) {
            throw new HttpError(404, 'Series not found')
          }

          deleteSeriesById(params.seriesId)
          await removeDirectory(
            safeResolveDataPath(`library/${params.seriesId}`),
          )

          return noContentResponse()
        } catch (error) {
          return toApiErrorResponse(error)
        }
      },
    },
  },
})
