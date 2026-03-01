import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'

import { removeDirectory, safeResolveDataPath } from '#/server/fs'
import {
  deleteSeriesById,
  getChapterPayload,
  getSeriesDetail,
  listLibrarySeries,
  updatePageOverrides,
  upsertProgress,
} from '#/server/db/repository'
import { resolveImageAsset } from '#/server/image-service'
import { ensureServerReady } from '#/server/bootstrap'

import type { LocalLibraryProvider } from '../provider'

export const nodeLocalLibraryProvider: LocalLibraryProvider = {
  listSeries: async () => {
    await ensureServerReady()
    return listLibrarySeries()
  },
  getSeries: async (seriesId) => {
    await ensureServerReady()
    return getSeriesDetail(seriesId)
  },
  deleteSeries: async (seriesId) => {
    await ensureServerReady()

    const series = getSeriesDetail(seriesId)
    if (!series) {
      return false
    }

    deleteSeriesById(seriesId)
    await removeDirectory(safeResolveDataPath(`library/${seriesId}`))
    return true
  },
  getChapter: async (chapterId) => {
    await ensureServerReady()
    return getChapterPayload(chapterId)
  },
  updateProgress: async (payload) => {
    await ensureServerReady()
    return upsertProgress(payload)
  },
  updatePageOverrides: async (chapterId, pageIndex, payload) => {
    await ensureServerReady()
    return updatePageOverrides(chapterId, pageIndex, payload)
  },
  getImageResponse: async (request, chapterId, pageIndex, options) => {
    await ensureServerReady()

    const asset = await resolveImageAsset(chapterId, pageIndex, options)
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

    const stream = createReadStream(asset.filePath)

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
  },
}
