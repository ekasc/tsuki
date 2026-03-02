import { createFileRoute } from '@tanstack/react-router'

const createAnyFileRoute = createFileRoute as any

export const Route = createAnyFileRoute('/v1/weebcentral/chapter')({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const { jsonResponse, toApiErrorResponse } = await import('#/server/api/http')
        const { attachRequestIdHeader, resolveRequestId } = await import(
          '#/server/proxy/utils/observability'
        )
        const requestId = resolveRequestId(request)

        try {
          const { getChapterDtoForRequest } = await import(
            '#/server/proxy/routes/weebcentral'
          )

          const payload = await getChapterDtoForRequest(request)
          const response = jsonResponse(payload, {
            headers: {
              'Cache-Control':
                'public, max-age=30, s-maxage=120, stale-while-revalidate=300',
            },
          })
          attachRequestIdHeader(response, requestId)
          return response
        } catch (error) {
          const response = toApiErrorResponse(error)
          attachRequestIdHeader(response, requestId)
          return response
        }
      },
    },
  },
})
