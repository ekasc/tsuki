import { createFileRoute } from '@tanstack/react-router'

const createAnyFileRoute = createFileRoute as any

export const Route = createAnyFileRoute('/v1/upload/chapter')({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const { ensureServerReady } = await import('#/server/bootstrap')
        const { jsonResponse, toApiErrorResponse } = await import(
          '#/server/api/http'
        )

        try {
          const { uploadChapterFromRequest } = await import(
            '#/server/proxy/routes/uploads'
          )

          await ensureServerReady()
          const payload = await uploadChapterFromRequest(request)
          return jsonResponse(payload, { status: 201 })
        } catch (error) {
          return toApiErrorResponse(error)
        }
      },
    },
  },
})
