import { createFileRoute } from '@tanstack/react-router'

const createAnyFileRoute = createFileRoute as any

export const Route = createAnyFileRoute('/v1/local/$chapterId/$filename')({
  server: {
    handlers: {
      GET: async ({
        params,
      }: {
        params: { chapterId: string; filename: string }
      }) => {
        const { toApiErrorResponse } = await import('#/server/api/http')

        try {
          const { assertLocalLibraryEnabled } = await import('#/server/runtime')
          assertLocalLibraryEnabled()

          const { ensureServerReady } = await import('#/server/bootstrap')
          const { streamLocalAsset } = await import(
            '#/server/proxy/routes/localAssets'
          )

          await ensureServerReady()
          return await streamLocalAsset(params.chapterId, params.filename)
        } catch (error) {
          return toApiErrorResponse(error)
        }
      },
    },
  },
})
