import { createFileRoute } from '@tanstack/react-router'

const createAnyFileRoute = createFileRoute as any

export const Route = createAnyFileRoute('/v1/weebcentral/chapter')({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const { ensureServerReady } = await import('#/server/bootstrap')
        const { jsonResponse, toApiErrorResponse } = await import(
          '#/server/api/http'
        )

        try {
          const { getChapterDtoForRequest } = await import(
            '#/server/proxy/routes/weebcentral'
          )

          await ensureServerReady()
          const payload = await getChapterDtoForRequest(request)
          return jsonResponse(payload)
        } catch (error) {
          return toApiErrorResponse(error)
        }
      },
    },
  },
})
