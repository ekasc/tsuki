import {
  fromMangadexChapterId,
  fromMangadexSeriesId,
  isUuid,
  toMangadexChapterId,
  toMangadexSeriesId,
} from '#/lib/remote-provider'
import { HttpError } from '#/server/errors'

import type { ProxyServerConfig } from '../server'
import {
  chapterCache,
  proxyConfig,
  rememberApprovedImageUrl,
  seriesCache,
} from '../server'
import { encodeBase64Url } from '../utils/base64url'
import {
  type UpstreamTelemetryContext,
  fetchWithWeebcentralPolicy,
} from '../utils/upstream-policy'
import type { ChapterDTO, SeriesDTO } from './weebcentral'

const MANGADEX_API_HOST = 'api.mangadex.org'
const MANGADEX_API_ORIGIN = `https://${MANGADEX_API_HOST}`
const MANGADEX_COVER_ORIGIN = 'https://uploads.mangadex.org'

interface MangadexRelationship {
  id: string
  type: string
  attributes?: Record<string, unknown>
}

interface MangadexMangaAttributes {
  title?: Record<string, string>
  altTitles?: Array<Record<string, string>>
  description?: Record<string, string>
}

interface MangadexChapterAttributes {
  chapter?: string | null
  title?: string | null
  publishAt?: string
  readableAt?: string
  createdAt?: string
  externalUrl?: string | null
}

interface MangadexEntity<TAttributes> {
  id: string
  attributes?: TAttributes
  relationships?: MangadexRelationship[]
}

interface MangadexErrorResponse {
  errors?: Array<{
    title?: string
    detail?: string
  }>
}

interface MangadexSingleResponse<T> extends MangadexErrorResponse {
  result?: string
  data?: T
}

interface MangadexCollectionResponse<T> extends MangadexErrorResponse {
  result?: string
  data?: T[]
  limit?: number
  offset?: number
  total?: number
}

interface MangadexAtHomeResponse extends MangadexErrorResponse {
  baseUrl?: string
  chapter?: {
    hash?: string
    data?: string[]
    dataSaver?: string[]
  }
}

interface ParsedMangadexInput {
  seriesId: string | null
  chapterId: string | null
}

function parseInput(input: string): ParsedMangadexInput {
  const trimmed = input.trim()
  if (!trimmed) {
    throw new HttpError(400, 'Missing MangaDex input')
  }

  const prefixedSeriesId = fromMangadexSeriesId(trimmed)
  if (prefixedSeriesId) {
    return {
      seriesId: prefixedSeriesId,
      chapterId: null,
    }
  }

  const prefixedChapterId = fromMangadexChapterId(trimmed)
  if (prefixedChapterId) {
    return {
      seriesId: null,
      chapterId: prefixedChapterId,
    }
  }

  try {
    const url = new URL(trimmed)
    const segments = url.pathname.split('/').filter(Boolean)
    const titleIndex = segments.findIndex(
      (segment) => segment.toLowerCase() === 'title',
    )
    if (titleIndex >= 0) {
      const maybeId = segments[titleIndex + 1]
      if (maybeId && isUuid(maybeId)) {
        return {
          seriesId: maybeId,
          chapterId: null,
        }
      }
    }

    const chapterIndex = segments.findIndex(
      (segment) => segment.toLowerCase() === 'chapter',
    )
    if (chapterIndex >= 0) {
      const maybeId = segments[chapterIndex + 1]
      if (maybeId && isUuid(maybeId)) {
        return {
          seriesId: null,
          chapterId: maybeId,
        }
      }
    }
  } catch {
    // Non-URL input is handled below.
  }

  if (isUuid(trimmed)) {
    return {
      seriesId: trimmed,
      chapterId: null,
    }
  }

  throw new HttpError(
    400,
    'Invalid MangaDex input. Use a title/chapter URL or MangaDex UUID.',
  )
}

function firstObjectValue(record?: Record<string, string>): string | null {
  if (!record) {
    return null
  }

  for (const value of Object.values(record)) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }

  return null
}

function pickLocalizedText(
  primary?: Record<string, string>,
  fallbacks?: Array<Record<string, string>>,
): string | null {
  const preferred = primary?.en?.trim()
  if (preferred) {
    return preferred
  }

  const direct = firstObjectValue(primary)
  if (direct) {
    return direct
  }

  if (fallbacks) {
    for (const entry of fallbacks) {
      const fallback = firstObjectValue(entry)
      if (fallback) {
        return fallback
      }
    }
  }

  return null
}

function parseChapterNumber(
  rawChapter: string | null | undefined,
  fallback: number,
): number {
  if (!rawChapter) {
    return fallback
  }

  const parsed = Number.parseFloat(rawChapter)
  return Number.isFinite(parsed) ? parsed : fallback
}

function readApiErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const typed = payload as MangadexErrorResponse
  const first = typed.errors?.[0]
  if (!first) {
    return null
  }

  if (typeof first.detail === 'string' && first.detail.trim().length > 0) {
    return first.detail.trim()
  }

  if (typeof first.title === 'string' && first.title.trim().length > 0) {
    return first.title.trim()
  }

  return null
}

function extractRelationshipId(
  relationships: MangadexRelationship[] | undefined,
  type: string,
): string | null {
  const relationship = relationships?.find((entry) => entry.type === type)
  return relationship?.id ?? null
}

function extractCoverFileName(
  relationships: MangadexRelationship[] | undefined,
): string | null {
  const relation = relationships?.find((entry) => entry.type === 'cover_art')
  const fileName = relation?.attributes?.fileName
  return typeof fileName === 'string' && fileName.trim().length > 0
    ? fileName
    : null
}

async function fetchMangadexJson<TResponse>(
  pathname: string,
  config: ProxyServerConfig,
  searchParams?: URLSearchParams,
  options?: {
    bypassCloudflareCache?: boolean
    telemetry?: UpstreamTelemetryContext
  },
): Promise<TResponse> {
  const url = new URL(pathname, MANGADEX_API_ORIGIN)
  if (searchParams) {
    url.search = searchParams.toString()
  }

  const response = await fetchWithWeebcentralPolicy(
    url,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    },
    {
      allowedHostnames: [MANGADEX_API_HOST],
      maxRedirects: config.imageProxyMaxRedirects,
      cacheClass: 'metadata',
      bypassCloudflareCache: options?.bypassCloudflareCache,
      telemetry: options?.telemetry,
    },
    config,
  )

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    const detail = readApiErrorMessage(payload)
    if (response.status === 404) {
      throw new HttpError(404, detail ?? 'MangaDex resource not found')
    }
    throw new HttpError(
      502,
      detail ?? `MangaDex request failed with status ${response.status}`,
    )
  }

  return payload as TResponse
}

async function fetchChapterEntity(
  chapterId: string,
  config: ProxyServerConfig,
  options?: { telemetry?: UpstreamTelemetryContext },
): Promise<MangadexEntity<MangadexChapterAttributes>> {
  const payload = await fetchMangadexJson<
    MangadexSingleResponse<MangadexEntity<MangadexChapterAttributes>>
  >(`/chapter/${chapterId}`, config, undefined, {
    telemetry: options?.telemetry,
  })

  if (payload.result !== 'ok' || !payload.data) {
    throw new HttpError(502, 'Invalid MangaDex chapter payload')
  }

  return payload.data
}

async function resolveSeriesIdFromChapterId(
  chapterId: string,
  config: ProxyServerConfig,
  options?: { telemetry?: UpstreamTelemetryContext },
): Promise<string> {
  const chapter = await fetchChapterEntity(chapterId, config, options)
  const seriesId = extractRelationshipId(chapter.relationships, 'manga')
  if (!seriesId) {
    throw new HttpError(502, 'Could not resolve MangaDex series from chapter')
  }

  return seriesId
}

async function resolveSeriesIdFromInput(
  input: string,
  config: ProxyServerConfig,
  options?: { telemetry?: UpstreamTelemetryContext },
): Promise<string> {
  const parsed = parseInput(input)
  if (parsed.seriesId) {
    return parsed.seriesId
  }

  if (parsed.chapterId) {
    return resolveSeriesIdFromChapterId(parsed.chapterId, config, options)
  }

  throw new HttpError(400, 'Missing MangaDex series ID')
}

async function resolveChapterIdFromInput(input: string): Promise<string> {
  const trimmed = input.trim()
  if (isUuid(trimmed)) {
    return trimmed
  }

  const parsed = parseInput(input)
  if (!parsed.chapterId) {
    throw new HttpError(
      400,
      'Missing MangaDex chapter ID. Use a chapter URL or chapter UUID.',
    )
  }

  return parsed.chapterId
}

async function fetchSeriesDtoBySeriesId(
  seriesId: string,
  config: ProxyServerConfig,
  options?: { bypassCache?: boolean; telemetry?: UpstreamTelemetryContext },
): Promise<SeriesDTO> {
  const cacheKey = `mangadex:series:${seriesId}`

  const fetchSeriesPayload = async () => {
    const seriesQuery = new URLSearchParams()
    seriesQuery.append('includes[]', 'cover_art')
    const seriesPayload = await fetchMangadexJson<
      MangadexSingleResponse<MangadexEntity<MangadexMangaAttributes>>
    >(`/manga/${seriesId}`, config, seriesQuery, {
      bypassCloudflareCache: options?.bypassCache,
      telemetry: options?.telemetry,
    })

    if (seriesPayload.result !== 'ok' || !seriesPayload.data) {
      throw new HttpError(502, 'Invalid MangaDex series payload')
    }

    const seriesEntity = seriesPayload.data
    const seriesAttributes = seriesEntity.attributes
    const title =
      pickLocalizedText(
        seriesAttributes?.title,
        seriesAttributes?.altTitles,
      ) ?? `MangaDex ${seriesId}`
    const description = pickLocalizedText(seriesAttributes?.description) ?? undefined

    const coverFileName = extractCoverFileName(seriesEntity.relationships)
    const coverUrl = coverFileName
      ? `${MANGADEX_COVER_ORIGIN}/covers/${seriesId}/${encodeURIComponent(coverFileName)}.512.jpg`
      : undefined

    const chapters: Array<{
      id: string
      number: number
      title: string
      date?: string
    }> = []
    const seenChapterIds = new Set<string>()
    const limit = 500
    let offset = 0
    let total = 0

    do {
      const feedQuery = new URLSearchParams()
      feedQuery.set('limit', String(limit))
      feedQuery.set('offset', String(offset))
      feedQuery.append('order[chapter]', 'asc')
      feedQuery.append('contentRating[]', 'safe')
      feedQuery.append('contentRating[]', 'suggestive')
      feedQuery.append('contentRating[]', 'erotica')
      feedQuery.append('contentRating[]', 'pornographic')

      const feedPayload = await fetchMangadexJson<
        MangadexCollectionResponse<MangadexEntity<MangadexChapterAttributes>>
      >(`/manga/${seriesId}/feed`, config, feedQuery, {
        bypassCloudflareCache: options?.bypassCache,
        telemetry: options?.telemetry,
      })

      if (feedPayload.result !== 'ok' || !Array.isArray(feedPayload.data)) {
        throw new HttpError(502, 'Invalid MangaDex chapter feed payload')
      }

      total = feedPayload.total ?? feedPayload.data.length
      const entries = feedPayload.data

      entries.forEach((entry, index) => {
        if (!entry.id || seenChapterIds.has(entry.id)) {
          return
        }

        seenChapterIds.add(entry.id)

        const chapterTitleRaw = entry.attributes?.title?.trim()
        const chapterNumber = parseChapterNumber(
          entry.attributes?.chapter,
          offset + index + 1,
        )

        chapters.push({
          id: toMangadexChapterId(entry.id),
          number: chapterNumber,
          title: chapterTitleRaw?.length ? chapterTitleRaw : `Chapter ${chapterNumber}`,
          date:
            entry.attributes?.readableAt ??
            entry.attributes?.publishAt ??
            entry.attributes?.createdAt,
        })
      })

      offset += entries.length
      if (entries.length === 0) {
        break
      }
    } while (offset < total)

    chapters.sort((left, right) => {
      if (left.number !== right.number) {
        return left.number - right.number
      }

      const leftDate = left.date ? Date.parse(left.date) : Number.NaN
      const rightDate = right.date ? Date.parse(right.date) : Number.NaN

      if (Number.isFinite(leftDate) && Number.isFinite(rightDate)) {
        return leftDate - rightDate
      }

      return left.id.localeCompare(right.id)
    })

    return {
      provider: 'mangadex' as const,
      id: toMangadexSeriesId(seriesId),
      title,
      description,
      coverUrl,
      chapters,
    }
  }

  if (options?.bypassCache) {
    const payload = await fetchSeriesPayload()
    seriesCache.set(
      cacheKey,
      payload,
      config.seriesCacheTtlMs,
      config.seriesCacheStaleTtlMs,
    )
    return payload
  }

  return seriesCache.getOrSetWithStaleFallback(
    cacheKey,
    fetchSeriesPayload,
    config.seriesCacheTtlMs,
    config.seriesCacheStaleTtlMs,
  )
}

async function fetchChapterPages(
  chapterId: string,
  config: ProxyServerConfig,
  options?: { telemetry?: UpstreamTelemetryContext },
): Promise<string[]> {
  const payload = await fetchMangadexJson<MangadexAtHomeResponse>(
    `/at-home/server/${chapterId}`,
    config,
    undefined,
    {
      telemetry: options?.telemetry,
    },
  )

  const baseUrl = payload.baseUrl
  const chapterHash = payload.chapter?.hash
  const data = payload.chapter?.data

  if (!baseUrl || !chapterHash || !Array.isArray(data) || data.length === 0) {
    throw new HttpError(502, 'Invalid MangaDex chapter image payload')
  }

  const urls = data.map((fileName) => {
    return `${baseUrl}/data/${chapterHash}/${encodeURIComponent(fileName)}`
  })

  urls.forEach((url) => {
    rememberApprovedImageUrl(url)
  })

  return urls
}

function toProxiedImagePath(url: string): string {
  return `/v1/image/${encodeBase64Url(url)}`
}

export async function getMangaDexSeries(
  input: string,
  config: ProxyServerConfig = proxyConfig,
  options?: { bypassCache?: boolean; telemetry?: UpstreamTelemetryContext },
): Promise<SeriesDTO> {
  const seriesId = await resolveSeriesIdFromInput(input, config, options)
  return fetchSeriesDtoBySeriesId(seriesId, config, options)
}

export async function getMangaDexChapter(
  input: string,
  config: ProxyServerConfig = proxyConfig,
  options?: { telemetry?: UpstreamTelemetryContext },
): Promise<ChapterDTO> {
  const chapterId = await resolveChapterIdFromInput(input)
  const cacheKey = `mangadex:chapter:${chapterId}`

  return chapterCache.getOrSetWithStaleFallback(
    cacheKey,
    async () => {
      const chapterEntity = await fetchChapterEntity(chapterId, config, options)
      const seriesId = extractRelationshipId(chapterEntity.relationships, 'manga')
      if (!seriesId) {
        throw new HttpError(502, 'Could not resolve MangaDex series from chapter')
      }

      const pages = await fetchChapterPages(chapterId, config, options)
      return {
        provider: 'mangadex' as const,
        seriesId: toMangadexSeriesId(seriesId),
        chapterId: toMangadexChapterId(chapterId),
        pages: pages.map((url) => ({
          url: toProxiedImagePath(url),
        })),
      }
    },
    config.chapterCacheTtlMs,
    config.chapterCacheStaleTtlMs,
  )
}
