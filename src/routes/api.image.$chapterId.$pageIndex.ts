import fs from 'node:fs'
import { Readable } from 'node:stream'

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
          const { ensureServerReady } = await import('#/server/bootstrap')
          const { resolveImageAsset } = await import('#/server/image-service')

          await ensureServerReady()

          const pageIndex = Number.parseInt(params.pageIndex, 10)
          const requestUrl = new URL(request.url)

          const thumb = requestUrl.searchParams.get('thumb') === '1'
          const width = parsePositiveInt(requestUrl.searchParams.get('w'))
          const height = parsePositiveInt(requestUrl.searchParams.get('h'))

          const asset = await resolveImageAsset(params.chapterId, pageIndex, {
            thumbnail: thumb,
            width,
            height,
          })

          const clientEtag = request.headers.get('if-none-match')

          if (clientEtag && clientEtag === asset.etag) {
            return new Response(null, {
              status: 304,
              headers: {
                ETag: asset.etag,
                'Cache-Control': 'public, max-age=31536000, immutable',
              },
            })
          }

          const stream = fs.createReadStream(asset.filePath)

          return new Response(Readable.toWeb(stream) as ReadableStream, {
            headers: {
              'Content-Type': asset.contentType,
              'Content-Length': asset.contentLength,
              'Cache-Control': 'public, max-age=31536000, immutable',
              ETag: asset.etag,
              'Last-Modified': asset.lastModified,
              'X-Content-Type-Options': 'nosniff',
            },
          })
        } catch (error) {
          return toApiErrorResponse(error)
        }
      },
    },
  },
})
