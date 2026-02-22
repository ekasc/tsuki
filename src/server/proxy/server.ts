import type { ChapterDTO, SeriesDTO } from './adapters/weebcentral'
import { TtlCache } from './utils/cache'

export interface ProxyServerConfig {
  weebcentralOrigin: string
  weebcentralImageHostAllowlist: string[]
  seriesCacheTtlMs: number
  chapterCacheTtlMs: number
  scrapeRateLimitPerMinute: number
  uploadRateLimitPerMinute: number
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

const configuredCdnHosts = parseCsvEnv('WEBCENTRAL_CDN_HOSTS')

export const proxyConfig: ProxyServerConfig = {
  weebcentralOrigin: 'https://weebcentral.com',
  weebcentralImageHostAllowlist: Array.from(
    new Set(['weebcentral.com', ...configuredCdnHosts]),
  ),
  seriesCacheTtlMs: 10 * 60 * 1000,
  chapterCacheTtlMs: 60 * 60 * 1000,
  scrapeRateLimitPerMinute: 120,
  uploadRateLimitPerMinute: 12,
  uploadMaxBytes: 250 * 1024 * 1024,
  uploadMaxPages: 600,
  imageProxyMaxRedirects: 5,
}

export const seriesCache = new TtlCache<string, SeriesDTO>(
  proxyConfig.seriesCacheTtlMs,
)
export const chapterCache = new TtlCache<string, ChapterDTO>(
  proxyConfig.chapterCacheTtlMs,
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
