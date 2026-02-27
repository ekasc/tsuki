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

const configuredCdnHosts = parseCsvEnv('WEBCENTRAL_CDN_HOSTS')

export const proxyConfig: ProxyServerConfig = {
  weebcentralOrigin: 'https://weebcentral.com',
  weebcentralImageHostAllowlist: Array.from(
    new Set(['weebcentral.com', ...configuredCdnHosts]),
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

export function rememberApprovedImageUrl(url: string): void {
  approvedImageUrlCache.set(url, true)
}

export function isApprovedImageUrl(url: string): boolean {
  return approvedImageUrlCache.get(url) === true
}
