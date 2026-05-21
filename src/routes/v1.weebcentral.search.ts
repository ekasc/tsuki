import { createFileRoute } from '@tanstack/react-router'

const createAnyFileRoute = createFileRoute as any

export const Route = createAnyFileRoute('/v1/weebcentral/search')({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const { jsonResponse, toApiErrorResponse } = await import(
          '#/server/api/http'
        )
        const { attachRequestIdHeader, resolveRequestId } = await import(
          '#/server/proxy/utils/observability'
        )
        const requestId = resolveRequestId(request)

        try {
          const { searchSeriesDtoForRequest } = await import(
            '#/server/proxy/routes/weebcentral'
          )

          const payload = await searchSeriesDtoForRequest(request)
          const response = jsonResponse(payload, {
            headers: {
              'Cache-Control':
                'public, max-age=30, s-maxage=60, stale-while-revalidate=120',
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
