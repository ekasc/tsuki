import { createFileRoute } from '@tanstack/react-router'

const createAnyFileRoute = createFileRoute as any

export const Route = createAnyFileRoute('/v1/image/$b64')({
  server: {
    handlers: {
      GET: async ({ params }: { params: { b64: string } }) => {
        const { ensureServerReady } = await import('#/server/bootstrap')
        const { toApiErrorResponse } = await import('#/server/api/http')

        try {
          const { proxyImageByEncodedUrl } = await import(
            '#/server/proxy/routes/imageProxy'
          )

          await ensureServerReady()
          return await proxyImageByEncodedUrl(params.b64)
        } catch (error) {
          return toApiErrorResponse(error)
        }
      },
    },
  },
})
