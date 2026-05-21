import { queryOptions } from '@tanstack/react-query'

import type {
  ChapterPayload,
  SearchResult,
  SeriesDetail,
  WeebcentralChapterDTO,
  WeebcentralSeriesDTO,
} from '#/lib/contracts'
import { fetchJson } from '#/lib/http-client'

const LOCAL_STALE_TIME_MS = 120_000
const REMOTE_STALE_TIME_MS = 45_000
const GC_TIME_MS = 15 * 60_000

interface WeebcentralRequestOptions {
  prefetch?: boolean
}

function isRetryableUpstreamError(error: unknown) {
  if (!(error instanceof Error)) {
    return false
  }

  return /\b(502|503|504)\b/.test(error.message)
}

function buildWeebcentralRequestInit(
  options?: WeebcentralRequestOptions,
): RequestInit | undefined {
  if (!options?.prefetch) {
    return undefined
  }

  return {
    headers: {
      'x-tsuki-prefetch': '1',
    },
  }
}

export function localChapterQueryOptions(chapterId: string) {
  return queryOptions({
    queryKey: ['local-chapter', chapterId] as const,
    queryFn: () => fetchJson<ChapterPayload>(`/api/chapter/${chapterId}`),
    staleTime: LOCAL_STALE_TIME_MS,
    gcTime: GC_TIME_MS,
  })
}

export function localSeriesQueryOptions(seriesId: string) {
  return queryOptions({
    queryKey: ['local-series', seriesId] as const,
    queryFn: () => fetchJson<SeriesDetail>(`/api/series/${seriesId}`),
    staleTime: LOCAL_STALE_TIME_MS,
    gcTime: GC_TIME_MS,
  })
}

export function weebcentralChapterQueryOptions(
  chapterRef: string,
  options?: WeebcentralRequestOptions,
) {
  const requestInit = buildWeebcentralRequestInit(options)
  const prefetch = Boolean(options?.prefetch)

  return queryOptions({
    queryKey: ['weebcentral-chapter', chapterRef] as const,
    queryFn: () =>
      fetchJson<WeebcentralChapterDTO>(
        `/v1/weebcentral/chapter?url=${encodeURIComponent(chapterRef)}`,
        requestInit,
      ),
    staleTime: REMOTE_STALE_TIME_MS,
    gcTime: GC_TIME_MS,
    retry: prefetch
      ? 0
      : (failureCount, error) =>
          failureCount < 2 && isRetryableUpstreamError(error),
    retryDelay: (attempt) => (attempt === 1 ? 220 : 520),
  })
}

export function weebcentralSeriesQueryOptions(
  seriesRef: string,
  options?: { forceRefresh?: boolean; prefetch?: boolean },
) {
  const forceRefresh = Boolean(options?.forceRefresh)
  const prefetch = Boolean(options?.prefetch)
  const requestInit = buildWeebcentralRequestInit(options)

  return queryOptions({
    queryKey: ['weebcentral-series', seriesRef] as const,
    queryFn: () =>
      fetchJson<WeebcentralSeriesDTO>(
        `/v1/weebcentral/series?url=${encodeURIComponent(seriesRef)}${forceRefresh ? '&force=1' : ''}`,
        requestInit,
      ),
    staleTime: forceRefresh ? 0 : REMOTE_STALE_TIME_MS,
    gcTime: GC_TIME_MS,
    retry: prefetch
      ? 0
      : (failureCount, error) =>
          failureCount < 2 && isRetryableUpstreamError(error),
    retryDelay: (attempt) => (attempt === 1 ? 220 : 520),
  })
}

export function weebcentralSearchQueryOptions(query: string) {
  return queryOptions({
    queryKey: ['weebcentral-search', query] as const,
    queryFn: () =>
      fetchJson<SearchResult[]>(
        `/v1/weebcentral/search?q=${encodeURIComponent(query)}`,
      ),
    staleTime: REMOTE_STALE_TIME_MS,
    gcTime: GC_TIME_MS,
    enabled: query.trim().length >= 2,
  })
}
