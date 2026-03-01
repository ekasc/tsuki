import { createFileRoute } from '@tanstack/react-router'

const createAnyFileRoute = createFileRoute as any

export const Route = createAnyFileRoute('/api/chapter/$chapterId')({
  server: {
    handlers: {
      GET: async ({ params }: { params: { chapterId: string } }) => {
        const { jsonResponse, toApiErrorResponse } = await import(
          '#/server/api/http'
        )

        try {
          const { getLocalLibraryProvider } = await import(
            '#/server/local-library'
          )
          const { HttpError } = await import('#/server/errors')

          const provider = await getLocalLibraryProvider()
          const payload = await provider.getChapter(params.chapterId)

          if (!payload) {
            throw new HttpError(404, 'Chapter not found')
          }

          return jsonResponse(payload)
        } catch (error) {
          return toApiErrorResponse(error)
        }
      },
    },
  },
})
