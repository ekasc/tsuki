import { createFileRoute } from '@tanstack/react-router'

const createAnyFileRoute = createFileRoute as any

export const Route = createAnyFileRoute('/api/upload')({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const { jsonResponse, toApiErrorResponse } = await import(
          '#/server/api/http'
        )

        try {
          const { assertLocalLibraryEnabled } = await import('#/server/runtime')
          assertLocalLibraryEnabled()

          const { ensureServerReady } = await import('#/server/bootstrap')
          const { uploadRequestSchema } = await import(
            '#/server/api/validators'
          )
          const { HttpError } = await import('#/server/errors')
          const { ingestArchiveUpload } = await import(
            '#/server/ingest/import-archive'
          )
          const { pruneStaleSessionUploads } = await import(
            '#/server/ingest/prune-session-uploads'
          )
          const { assertRateLimit, requestClientId } = await import(
            '#/server/rate-limit'
          )

          await ensureServerReady()
          await pruneStaleSessionUploads()

          assertRateLimit(requestClientId(request), {
            limit: 6,
            windowMs: 60_000,
          })

          const formData = await request.formData()
          const archive = formData.get('archive')

          if (!(archive instanceof File)) {
            throw new HttpError(400, 'Missing archive file')
          }

          const metadata = uploadRequestSchema.parse({
            seriesTitle: formData.get('seriesTitle')?.toString() ?? undefined,
            chapterTitle: formData.get('chapterTitle')?.toString() ?? undefined,
            chapterNumber: formData.get('chapterNumber')
              ? Number.parseInt(formData.get('chapterNumber')!.toString(), 10)
              : undefined,
          })

          const result = await ingestArchiveUpload({
            file: archive,
            ...metadata,
          })

          return jsonResponse(result, { status: 201 })
        } catch (error) {
          return toApiErrorResponse(error)
        }
      },
    },
  },
})
