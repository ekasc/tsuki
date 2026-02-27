import { createFileRoute } from '@tanstack/react-router'

const createAnyFileRoute = createFileRoute as any

export const Route = createAnyFileRoute('/api/chapter/$chapterId/progress')({
  server: {
    handlers: {
      PUT: async ({
        request,
        params,
      }: {
        request: Request
        params: { chapterId: string }
      }) => {
        const { jsonResponse, toApiErrorResponse } = await import(
          '#/server/api/http'
        )

        try {
          const { assertLocalLibraryEnabled } = await import('#/server/runtime')
          assertLocalLibraryEnabled()

          const { ensureServerReady } = await import('#/server/bootstrap')
          const { progressPayloadSchema } = await import(
            '#/server/api/validators'
          )
          const { upsertProgress } = await import('#/server/db/repository')

          await ensureServerReady()
          const body = await request.json()
          const payload = progressPayloadSchema.parse(body)

          if (payload.chapterId !== params.chapterId) {
            return jsonResponse({ error: 'Chapter mismatch' }, { status: 400 })
          }

          const progress = upsertProgress(payload)
          return jsonResponse(progress)
        } catch (error) {
          return toApiErrorResponse(error)
        }
      },
    },
  },
})
