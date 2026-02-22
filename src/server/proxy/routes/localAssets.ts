import fs from 'node:fs'
import { Readable } from 'node:stream'

import { resolveLocalAsset } from '../utils/storage'

export async function streamLocalAsset(
  chapterId: string,
  filename: string,
): Promise<Response> {
  const resolved = await resolveLocalAsset(chapterId, filename)
  const stream = fs.createReadStream(resolved.filePath)

  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: {
      'Content-Type': resolved.contentType,
      'Content-Length': resolved.contentLength,
      'Last-Modified': resolved.lastModified,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
