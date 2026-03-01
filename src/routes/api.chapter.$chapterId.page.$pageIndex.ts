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
          const { getLocalLibraryProvider } = await import(
            '#/server/local-library'
          )
          const { pageOverridePayloadSchema } = await import(
            '#/server/api/validators'
          )
          const { HttpError } = await import('#/server/errors')

          const payload = pageOverridePayloadSchema.parse(await request.json())
          const pageIndex = Number.parseInt(params.pageIndex, 10)

          if (Number.isNaN(pageIndex) || pageIndex < 0) {
            throw new HttpError(400, 'Invalid page index')
          }

          const provider = await getLocalLibraryProvider()
          const updated = await provider.updatePageOverrides(
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
