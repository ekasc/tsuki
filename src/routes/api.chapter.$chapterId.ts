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
          const { assertLocalLibraryEnabled } = await import('#/server/runtime')
          assertLocalLibraryEnabled()

          const { ensureServerReady } = await import('#/server/bootstrap')
          const { getChapterPayload } = await import('#/server/db/repository')
          const { HttpError } = await import('#/server/errors')

          await ensureServerReady()
          const payload = getChapterPayload(params.chapterId)

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
