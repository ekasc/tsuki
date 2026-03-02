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
        const { toApiErrorResponse } = await import('#/server/api/http')
        const { attachRequestIdHeader, resolveRequestId } = await import(
          '#/server/proxy/utils/observability'
        )
        const requestId = resolveRequestId(request)

        try {
          const { proxyImageByEncodedUrl } = await import(
            '#/server/proxy/routes/imageProxy'
          )

          const requestUrl = new URL(request.url)
          const cropRaw = requestUrl.searchParams.get('crop')
          const crop = cropRaw === 'left' || cropRaw === 'right' ? cropRaw : null

          const response = await proxyImageByEncodedUrl(request, params.b64, { crop })
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
