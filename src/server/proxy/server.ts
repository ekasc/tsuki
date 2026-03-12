import type { ChapterDTO, SeriesDTO } from './adapters/weebcentral'
import { TtlCache } from './utils/cache'

export interface ProxyServerConfig {
  weebcentralOrigin: string
  weebcentralImageHostAllowlist: string[]
  seriesCacheTtlMs: number
  seriesCacheStaleTtlMs: number
  chapterCacheTtlMs: number
  chapterCacheStaleTtlMs: number
  scrapeRateLimitPerMinute: number
  scrapePrefetchRateLimitPerMinute: number
  scrapeForceRefreshRateLimitPerMinute: number
  uploadRateLimitPerMinute: number
  imageRateLimitPerMinute: number
  imagePrefetchRateLimitPerMinute: number
  upstreamGlobalRateLimitPerMinute: number
  upstreamMaxConcurrentRequests: number
  upstreamTimeoutMs: number
  upstreamRetryCount: number
  upstreamRetryBaseDelayMs: number
  upstreamCircuitFailureWindowMs: number
  upstreamCircuitFailureThreshold: number
  upstreamCircuitOpenMs: number
  uploadMaxBytes: number
  uploadMaxPages: number
  imageProxyMaxRedirects: number
}

function parseCsvEnv(name: string): string[] {
  const raw = process.env[name]?.trim()
  if (!raw) {
    return []
  }

  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

function parseIntegerEnv(
  name: string,
  fallback: number,
  options?: {
    min?: number
    max?: number
  },
): number {
  const raw = process.env[name]?.trim()
  if (!raw) {
    return fallback
  }

  const parsed = Number.parseInt(raw, 10)
  if (Number.isNaN(parsed)) {
    return fallback
  }

  const minimum = options?.min ?? Number.MIN_SAFE_INTEGER
  const maximum = options?.max ?? Number.MAX_SAFE_INTEGER
  return Math.min(maximum, Math.max(minimum, parsed))
}

const configuredLegacyCdnHosts = parseCsvEnv('WEBCENTRAL_CDN_HOSTS')
const configuredImageHosts = parseCsvEnv('TSUKI_IMAGE_HOST_ALLOWLIST')
const defaultImageHostAllowlist = [
  'weebcentral.com',
  'planeptune.us',
  'mangadex.org',
  'mangadex.network',
  'uploads.mangadex.org',
]

export const proxyConfig: ProxyServerConfig = {
  weebcentralOrigin: 'https://weebcentral.com',
  weebcentralImageHostAllowlist: Array.from(
    new Set([
      ...defaultImageHostAllowlist,
      ...configuredLegacyCdnHosts,
      ...configuredImageHosts,
    ]),
  ),
  seriesCacheTtlMs: parseIntegerEnv(
    'WEBCENTRAL_SERIES_CACHE_TTL_MS',
    10 * 60 * 1000,
    { min: 30_000 },
  ),
  seriesCacheStaleTtlMs: parseIntegerEnv(
    'WEBCENTRAL_SERIES_CACHE_STALE_TTL_MS',
    20 * 60 * 1000,
    { min: 0 },
  ),
  chapterCacheTtlMs: parseIntegerEnv(
    'WEBCENTRAL_CHAPTER_CACHE_TTL_MS',
    60 * 60 * 1000,
    { min: 30_000 },
  ),
  chapterCacheStaleTtlMs: parseIntegerEnv(
    'WEBCENTRAL_CHAPTER_CACHE_STALE_TTL_MS',
    30 * 60 * 1000,
    { min: 0 },
  ),
  scrapeRateLimitPerMinute: parseIntegerEnv(
    'WEBCENTRAL_SCRAPE_RATE_LIMIT_PER_MINUTE',
    90,
    { min: 20 },
  ),
  scrapePrefetchRateLimitPerMinute: parseIntegerEnv(
    'WEBCENTRAL_SCRAPE_PREFETCH_RATE_LIMIT_PER_MINUTE',
    24,
    { min: 10 },
  ),
  scrapeForceRefreshRateLimitPerMinute: parseIntegerEnv(
    'WEBCENTRAL_SCRAPE_FORCE_REFRESH_RATE_LIMIT_PER_MINUTE',
    6,
    { min: 1 },
  ),
  uploadRateLimitPerMinute: parseIntegerEnv(
    'TSUKI_UPLOAD_RATE_LIMIT_PER_MINUTE',
    12,
    { min: 1 },
  ),
  imageRateLimitPerMinute: parseIntegerEnv(
    'WEBCENTRAL_IMAGE_RATE_LIMIT_PER_MINUTE',
    240,
    { min: 60 },
  ),
  imagePrefetchRateLimitPerMinute: parseIntegerEnv(
    'WEBCENTRAL_IMAGE_PREFETCH_RATE_LIMIT_PER_MINUTE',
    60,
    { min: 20 },
  ),
  upstreamGlobalRateLimitPerMinute: parseIntegerEnv(
    'WEBCENTRAL_UPSTREAM_GLOBAL_RATE_LIMIT_PER_MINUTE',
    1_200,
    { min: 200 },
  ),
  upstreamMaxConcurrentRequests: parseIntegerEnv(
    'WEBCENTRAL_UPSTREAM_MAX_CONCURRENT_REQUESTS',
    10,
    { min: 2, max: 128 },
  ),
  upstreamTimeoutMs: parseIntegerEnv(
    'WEBCENTRAL_UPSTREAM_TIMEOUT_MS',
    8_000,
    { min: 1_000, max: 30_000 },
  ),
  upstreamRetryCount: parseIntegerEnv('WEBCENTRAL_UPSTREAM_RETRY_COUNT', 1, {
    min: 0,
    max: 6,
  }),
  upstreamRetryBaseDelayMs: parseIntegerEnv(
    'WEBCENTRAL_UPSTREAM_RETRY_BASE_DELAY_MS',
    220,
    { min: 50, max: 5_000 },
  ),
  upstreamCircuitFailureWindowMs: parseIntegerEnv(
    'WEBCENTRAL_UPSTREAM_CIRCUIT_FAILURE_WINDOW_MS',
    60_000,
    { min: 1_000, max: 15 * 60_000 },
  ),
  upstreamCircuitFailureThreshold: parseIntegerEnv(
    'WEBCENTRAL_UPSTREAM_CIRCUIT_FAILURE_THRESHOLD',
    10,
    { min: 2, max: 200 },
  ),
  upstreamCircuitOpenMs: parseIntegerEnv(
    'WEBCENTRAL_UPSTREAM_CIRCUIT_OPEN_MS',
    45_000,
    { min: 1_000, max: 15 * 60_000 },
  ),
  uploadMaxBytes: 250 * 1024 * 1024,
  uploadMaxPages: 600,
  imageProxyMaxRedirects: parseIntegerEnv('WEBCENTRAL_IMAGE_MAX_REDIRECTS', 5, {
    min: 0,
    max: 20,
  }),
}

export const seriesCache = new TtlCache<string, SeriesDTO>(
  proxyConfig.seriesCacheTtlMs,
  proxyConfig.seriesCacheStaleTtlMs,
)
export const chapterCache = new TtlCache<string, ChapterDTO>(
  proxyConfig.chapterCacheTtlMs,
  proxyConfig.chapterCacheStaleTtlMs,
)

const approvedImageUrlCache = new TtlCache<string, true>(
  proxyConfig.chapterCacheTtlMs,
)
const approvedImageHostCache = new TtlCache<string, true>(
  proxyConfig.chapterCacheTtlMs,
)
const approvedImageHostCacheTtlSeconds = Math.max(
  60,
  Math.floor(proxyConfig.chapterCacheTtlMs / 1_000),
)
const approvedImageHostCachePrefix =
  'https://tsuki.internal/__approved-image-host__/'

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase()
}

function extractHostname(url: string): string | null {
  try {
    return normalizeHostname(new URL(url).hostname)
  } catch {
    return null
  }
}

function getSharedApprovedHostCache(): Cache | null {
  const cacheStorage = (globalThis as { caches?: { default?: Cache } }).caches
  return cacheStorage?.default ?? null
}

function createApprovedHostCacheRequest(hostname: string): Request {
  const normalizedHostname = normalizeHostname(hostname)
  return new Request(
    `${approvedImageHostCachePrefix}${encodeURIComponent(normalizedHostname)}`,
    { method: 'GET' },
  )
}

async function persistApprovedImageHost(hostname: string): Promise<void> {
  const sharedCache = getSharedApprovedHostCache()
  if (!sharedCache) {
    return
  }

  const request = createApprovedHostCacheRequest(hostname)
  const response = new Response('1', {
    headers: {
      'Cache-Control': `public, max-age=${approvedImageHostCacheTtlSeconds}`,
    },
  })

  try {
    await sharedCache.put(request, response)
  } catch {
    // Ignore cache write failures; in-memory fallback still works.
  }
}

export function rememberApprovedImageUrl(url: string): void {
  approvedImageUrlCache.set(url, true)
  const hostname = extractHostname(url)
  if (hostname) {
    approvedImageHostCache.set(hostname, true)
  }
}

export function isApprovedImageUrl(url: string): boolean {
  return approvedImageUrlCache.get(url) === true
}

export async function rememberApprovedImageHosts(
  urls: readonly string[],
): Promise<void> {
  const hostnames = new Set<string>()

  for (const url of urls) {
    const hostname = extractHostname(url)
    if (!hostname) {
      continue
    }

    approvedImageHostCache.set(hostname, true)
    hostnames.add(hostname)
  }

  if (hostnames.size === 0) {
    return
  }

  await Promise.all(
    Array.from(hostnames, (hostname) => persistApprovedImageHost(hostname)),
  )
}

export async function isApprovedImageHost(hostname: string): Promise<boolean> {
  const normalizedHostname = normalizeHostname(hostname)
  if (normalizedHostname.length === 0) {
    return false
  }

  if (approvedImageHostCache.get(normalizedHostname) === true) {
    return true
  }

  const sharedCache = getSharedApprovedHostCache()
  if (!sharedCache) {
    return false
  }

  try {
    const response = await sharedCache.match(
      createApprovedHostCacheRequest(normalizedHostname),
    )
    if (!response) {
      return false
    }

    approvedImageHostCache.set(normalizedHostname, true)
    return true
  } catch {
    return false
  }
}
