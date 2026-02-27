import { createFileRoute } from '@tanstack/react-router'

const createAnyFileRoute = createFileRoute as any

export const Route = createAnyFileRoute('/v1/weebcentral/series')({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const { jsonResponse, toApiErrorResponse } = await import(
          '#/server/api/http'
        )

        try {
          const { getSeriesDtoForRequest } = await import(
            '#/server/proxy/routes/weebcentral'
          )

          const payload = await getSeriesDtoForRequest(request)
          return jsonResponse(payload, {
            headers: {
              'Cache-Control':
                'public, max-age=30, s-maxage=300, stale-while-revalidate=300',
            },
          })
        } catch (error) {
          return toApiErrorResponse(error)
        }
      },
    },
  },
})
