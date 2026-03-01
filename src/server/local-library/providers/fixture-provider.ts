import type {
  ChapterPayload,
  ChapterProgress,
  LibrarySeries,
  SeriesDetail,
} from '#/lib/contracts'
import { HttpError } from '#/server/errors'

import {
  cloneFixtureChapterPayload,
  cloneFixtureSeriesDetail,
  cloneFixtureSeriesList,
  FIXTURE_SERIES_ID,
  getFixtureImageTemplate,
} from '../fixtures/demo'
import type { LocalLibraryProvider } from '../provider'

const FIXTURE_LAST_MODIFIED = 'Mon, 01 Jan 2024 00:00:00 GMT'

function hashString(value: string): string {
  let hash = 2166136261

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash +=
      (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)
  }

  return (hash >>> 0).toString(16)
}

function escapeSvgText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function deriveSize(
  width: number,
  height: number,
  options: {
    thumbnail?: boolean
    width?: number
    height?: number
    crop?: 'left' | 'right' | null
  },
): { width: number; height: number } {
  let nextWidth = width
  let nextHeight = height

  if (options.thumbnail) {
    const scale = Math.min(360 / width, 360 / height, 1)
    nextWidth = Math.max(1, Math.round(width * scale))
    nextHeight = Math.max(1, Math.round(height * scale))
  }

  if (options.width || options.height) {
    const widthScale = options.width ? options.width / width : Number.POSITIVE_INFINITY
    const heightScale = options.height
      ? options.height / height
      : Number.POSITIVE_INFINITY
    const scale = Math.min(widthScale, heightScale, 1)

    if (Number.isFinite(scale)) {
      nextWidth = Math.max(1, Math.round(width * scale))
      nextHeight = Math.max(1, Math.round(height * scale))
    }
  }

  if (options.crop) {
    nextWidth = Math.max(1, Math.floor(nextWidth / 2))
  }

  return {
    width: nextWidth,
    height: nextHeight,
  }
}

function buildFixtureSvg(params: {
  width: number
  height: number
  title: string
  subtitle: string
  background: string
}): string {
  const fontSize = Math.max(22, Math.floor(params.width / 11))
  const subtitleSize = Math.max(12, Math.floor(fontSize * 0.28))

  return `\n<svg width="${params.width}" height="${params.height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeSvgText(params.title)}">\n  <defs>\n    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">\n      <stop offset="0%" stop-color="${params.background}" />\n      <stop offset="100%" stop-color="#0f172a" />\n    </linearGradient>\n  </defs>\n  <rect width="100%" height="100%" fill="url(#bg)" />\n  <rect x="6%" y="68%" width="88%" height="22%" rx="16" fill="#00000070" />\n  <text x="50%" y="47%" fill="#f8fafc" dominant-baseline="middle" text-anchor="middle" font-family="Georgia, serif" font-size="${fontSize}" font-weight="700">${escapeSvgText(params.title)}</text>\n  <text x="50%" y="79%" fill="#e2e8f0" dominant-baseline="middle" text-anchor="middle" font-family="Verdana, sans-serif" font-size="${subtitleSize}">${escapeSvgText(params.subtitle)}</text>\n</svg>\n`
}

interface FixtureState {
  seriesList: LibrarySeries[]
  seriesById: Map<string, SeriesDetail>
  chaptersById: Map<string, ChapterPayload>
  progressByChapterId: Map<string, ChapterProgress>
}

let fixtureState: FixtureState | null = null

function ensureFixtureState(): FixtureState {
  if (fixtureState) {
    return fixtureState
  }

  const seriesList = cloneFixtureSeriesList()
  const seriesDetail = cloneFixtureSeriesDetail(FIXTURE_SERIES_ID)
  const firstChapter = cloneFixtureChapterPayload('SQW_DloYbKHRLibsR0-wV')
  const secondChapter = cloneFixtureChapterPayload('3uGXSAKdwDP7pcym0iZ4x')

  if (!seriesDetail || !firstChapter || !secondChapter) {
    throw new HttpError(500, 'Fixture state failed to initialize')
  }

  fixtureState = {
    seriesList,
    seriesById: new Map([[seriesDetail.id, seriesDetail]]),
    chaptersById: new Map([
      [firstChapter.manifest.chapterId, firstChapter],
      [secondChapter.manifest.chapterId, secondChapter],
    ]),
    progressByChapterId: new Map(),
  }

  return fixtureState
}

function getChapterPayloadOrNull(chapterId: string): ChapterPayload | null {
  const state = ensureFixtureState()
  const chapter = state.chaptersById.get(chapterId)

  if (!chapter) {
    return null
  }

  const progress = state.progressByChapterId.get(chapterId) ?? null

  return {
    manifest: {
      ...chapter.manifest,
      pages: chapter.manifest.pages.map((page) => ({ ...page })),
    },
    progress: progress ? { ...progress } : null,
  }
}

export const fixtureLocalLibraryProvider: LocalLibraryProvider = {
  listSeries: () => {
    const state = ensureFixtureState()
    return state.seriesList.map((entry) => ({ ...entry }))
  },
  getSeries: (seriesId) => {
    const state = ensureFixtureState()
    const detail = state.seriesById.get(seriesId)

    if (!detail) {
      return null
    }

    return {
      ...detail,
      chapters: detail.chapters.map((chapter) => ({ ...chapter })),
    }
  },
  deleteSeries: (seriesId) => {
    const state = ensureFixtureState()
    if (!state.seriesById.has(seriesId)) {
      return false
    }

    state.seriesById.delete(seriesId)
    state.seriesList = state.seriesList.filter((entry) => entry.id !== seriesId)

    for (const chapterId of Array.from(state.chaptersById.keys())) {
      const chapter = state.chaptersById.get(chapterId)
      if (chapter?.manifest.seriesId === seriesId) {
        state.chaptersById.delete(chapterId)
        state.progressByChapterId.delete(chapterId)
      }
    }

    return true
  },
  getChapter: (chapterId) => {
    return getChapterPayloadOrNull(chapterId)
  },
  updateProgress: (payload) => {
    const state = ensureFixtureState()
    const chapter = state.chaptersById.get(payload.chapterId)

    if (!chapter) {
      throw new HttpError(404, 'Chapter not found')
    }

    const progress: ChapterProgress = {
      ...payload,
      updatedAt: Date.now(),
    }

    state.progressByChapterId.set(payload.chapterId, progress)
    chapter.progress = { ...progress }

    return { ...progress }
  },
  updatePageOverrides: (chapterId, pageIndex, payload) => {
    const state = ensureFixtureState()
    const chapter = state.chaptersById.get(chapterId)

    if (!chapter) {
      return false
    }

    const page = chapter.manifest.pages.find((entry) => entry.pageIndex === pageIndex)
    if (!page) {
      return false
    }

    if (payload.userOverrideSpread !== undefined) {
      page.autoIsSpread = payload.userOverrideSpread ?? page.autoIsSpread
    }

    if (payload.splitSpread !== undefined) {
      page.splitSpread = payload.splitSpread
    }

    return true
  },
  getImageResponse: async (request, chapterId, pageIndex, options) => {
    const template = getFixtureImageTemplate(chapterId, pageIndex)

    if (!template) {
      throw new HttpError(404, 'Page not found')
    }

    const dimensions = deriveSize(template.width, template.height, options)
    const svg = buildFixtureSvg({
      width: dimensions.width,
      height: dimensions.height,
      title: `${template.label}`,
      subtitle: `${chapterId.slice(0, 6)} · page ${pageIndex + 1}`,
      background: template.background,
    })

    const variantKey = `${chapterId}:${pageIndex}:${options.thumbnail ? 'thumb' : 'full'}:${options.width ?? ''}:${options.height ?? ''}:${options.crop ?? ''}`
    const etag = `W/"fixture-${hashString(variantKey)}-${svg.length}"`
    const clientEtag = request.headers.get('if-none-match')

    if (clientEtag && clientEtag === etag) {
      return new Response(null, {
        status: 304,
        headers: {
          ETag: etag,
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      })
    }

    const contentLength = String(new TextEncoder().encode(svg).byteLength)

    return new Response(svg, {
      status: 200,
      headers: {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Content-Length': contentLength,
        'Cache-Control': 'public, max-age=31536000, immutable',
        ETag: etag,
        'Last-Modified': FIXTURE_LAST_MODIFIED,
        'X-Content-Type-Options': 'nosniff',
      },
    })
  },
}
