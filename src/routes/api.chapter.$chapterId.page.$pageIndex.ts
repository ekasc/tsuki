import { createFileRoute } from '@tanstack/react-router'

const createAnyFileRoute = createFileRoute as any

export const Route = createAnyFileRoute(
  '/api/chapter/$chapterId/page/$pageIndex',
)({
  server: {
    handlers: {
      PATCH: async ({
        request,
        params,
      }: {
        request: Request
        params: { chapterId: string; pageIndex: string }
      }) => {
        const { jsonResponse, toApiErrorResponse } = await import(
          '#/server/api/http'
        )

        try {
          const { assertLocalLibraryEnabled } = await import('#/server/runtime')
          assertLocalLibraryEnabled()

          const { ensureServerReady } = await import('#/server/bootstrap')
          const { pageOverridePayloadSchema } = await import(
            '#/server/api/validators'
          )
          const { updatePageOverrides } = await import('#/server/db/repository')
          const { HttpError } = await import('#/server/errors')

          await ensureServerReady()
          const payload = pageOverridePayloadSchema.parse(await request.json())
          const pageIndex = Number.parseInt(params.pageIndex, 10)

          if (Number.isNaN(pageIndex) || pageIndex < 0) {
            throw new HttpError(400, 'Invalid page index')
          }

          const updated = updatePageOverrides(
            params.chapterId,
            pageIndex,
            payload,
          )

          if (!updated) {
            throw new HttpError(404, 'Page not found')
          }

          return jsonResponse({ success: true })
        } catch (error) {
          return toApiErrorResponse(error)
        }
      },
    },
  },
})
