import { createFileRoute } from '@tanstack/react-router'

const createAnyFileRoute = createFileRoute as any

function parsePositiveInt(value: string | null): number | undefined {
  if (!value) {
    return undefined
  }

  const parsed = Number.parseInt(value, 10)

  if (Number.isNaN(parsed) || parsed <= 0) {
    return undefined
  }

  return parsed
}

export const Route = createAnyFileRoute('/api/image/$chapterId/$pageIndex')({
  server: {
    handlers: {
      GET: async ({
        request,
        params,
      }: {
        request: Request
        params: { chapterId: string; pageIndex: string }
      }) => {
        const { toApiErrorResponse } = await import('#/server/api/http')

        try {
          const { getLocalLibraryProvider } = await import(
            '#/server/local-library'
          )
          const { HttpError } = await import('#/server/errors')

          const pageIndex = Number.parseInt(params.pageIndex, 10)
          if (Number.isNaN(pageIndex) || pageIndex < 0) {
            throw new HttpError(400, 'Invalid page index')
          }

          const requestUrl = new URL(request.url)

          const thumb = requestUrl.searchParams.get('thumb') === '1'
          const width = parsePositiveInt(requestUrl.searchParams.get('w'))
          const height = parsePositiveInt(requestUrl.searchParams.get('h'))
          const cropRaw = requestUrl.searchParams.get('crop')
          const crop = cropRaw === 'left' || cropRaw === 'right' ? cropRaw : null

          const provider = await getLocalLibraryProvider()
          return await provider.getImageResponse(request, params.chapterId, pageIndex, {
            thumbnail: thumb,
            width,
            height,
            crop,
          })
        } catch (error) {
          return toApiErrorResponse(error)
        }
      },
    },
  },
})
