import { createFileRoute } from '@tanstack/react-router'

const createAnyFileRoute = createFileRoute as any

export const Route = createAnyFileRoute('/v1/image/$b64')({
  server: {
    handlers: {
      GET: async ({
        request,
        params,
      }: {
        request: Request
        params: { b64: string }
      }) => {
        const { ensureServerReady } = await import('#/server/bootstrap')
        const { toApiErrorResponse } = await import('#/server/api/http')

        try {
          const { proxyImageByEncodedUrl } = await import(
            '#/server/proxy/routes/imageProxy'
          )

          await ensureServerReady()
          const requestUrl = new URL(request.url)
          const cropRaw = requestUrl.searchParams.get('crop')
          const crop = cropRaw === 'left' || cropRaw === 'right' ? cropRaw : null

          return await proxyImageByEncodedUrl(params.b64, { crop })
        } catch (error) {
          return toApiErrorResponse(error)
        }
      },
    },
  },
})
