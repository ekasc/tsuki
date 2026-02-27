export type RemoteProvider = 'weebcentral' | 'mangadex'

const MANGADEX_SERIES_PREFIX = 'mds_'
const MANGADEX_CHAPTER_PREFIX = 'mdc_'
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function safeTrim(input: string): string {
  return input.trim()
}

function parseUrl(input: string): URL | null {
  const trimmed = safeTrim(input)
  if (!trimmed) {
    return null
  }

  const directCandidate =
    /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`

  try {
    return new URL(directCandidate)
  } catch {
    return null
  }
}

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(safeTrim(value))
}

export function isMangadexSeriesId(value: string): boolean {
  return safeTrim(value).toLowerCase().startsWith(MANGADEX_SERIES_PREFIX)
}

export function isMangadexChapterId(value: string): boolean {
  return safeTrim(value).toLowerCase().startsWith(MANGADEX_CHAPTER_PREFIX)
}

export function toMangadexSeriesId(rawId: string): string {
  return `${MANGADEX_SERIES_PREFIX}${safeTrim(rawId)}`
}

export function toMangadexChapterId(rawId: string): string {
  return `${MANGADEX_CHAPTER_PREFIX}${safeTrim(rawId)}`
}

export function fromMangadexSeriesId(seriesId: string): string | null {
  const trimmed = safeTrim(seriesId)
  if (!isMangadexSeriesId(trimmed)) {
    return null
  }

  const raw = trimmed.slice(MANGADEX_SERIES_PREFIX.length)
  return raw.length > 0 ? raw : null
}

export function fromMangadexChapterId(chapterId: string): string | null {
  const trimmed = safeTrim(chapterId)
  if (!isMangadexChapterId(trimmed)) {
    return null
  }

  const raw = trimmed.slice(MANGADEX_CHAPTER_PREFIX.length)
  return raw.length > 0 ? raw : null
}

export function isMangadexInput(input: string): boolean {
  const trimmed = safeTrim(input)
  if (!trimmed) {
    return false
  }

  if (isMangadexSeriesId(trimmed) || isMangadexChapterId(trimmed)) {
    return true
  }

  if (isUuid(trimmed)) {
    return true
  }

  const url = parseUrl(trimmed)
  if (!url) {
    return false
  }

  const hostname = url.hostname.toLowerCase()
  return hostname === 'mangadex.org' || hostname.endsWith('.mangadex.org')
}

export function detectRemoteProviderFromInput(input: string): RemoteProvider {
  return isMangadexInput(input) ? 'mangadex' : 'weebcentral'
}

export function detectRemoteProviderFromSeriesId(
  seriesId: string,
  fallback: RemoteProvider = 'weebcentral',
): RemoteProvider {
  return isMangadexSeriesId(seriesId) ? 'mangadex' : fallback
}

export function remoteProviderLabel(provider: RemoteProvider): string {
  return provider === 'mangadex' ? 'MangaDex' : 'WeebCentral'
}

export function buildRemoteSeriesSourceUrl(
  seriesId: string,
  provider: RemoteProvider,
): string {
  if (provider === 'mangadex') {
    const rawId = fromMangadexSeriesId(seriesId) ?? seriesId
    return `https://mangadex.org/title/${encodeURIComponent(rawId)}`
  }

  return `https://weebcentral.com/series/${encodeURIComponent(seriesId)}`
}
