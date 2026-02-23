import {
  getWeebcentralChapter,
  getWeebcentralSeries,
} from '../adapters/weebcentral'
import { proxyConfig } from '../server'

import { HttpError } from '#/server/errors'
import { assertRateLimit, requestClientId } from '#/server/rate-limit'

function readInputQuery(request: Request): string {
  const url = new URL(request.url)
  const value = url.searchParams.get('url')?.trim()

  if (!value) {
    throw new HttpError(400, 'Missing query parameter: url')
  }

  return value
}

function readForceRefreshQuery(request: Request): boolean {
  const url = new URL(request.url)
  return url.searchParams.get('force') === '1'
}

function assertScrapeRateLimit(request: Request): void {
  assertRateLimit(`proxy-scrape:${requestClientId(request)}`, {
    limit: proxyConfig.scrapeRateLimitPerMinute,
    windowMs: 60_000,
  })
}

export async function getSeriesDtoForRequest(request: Request) {
  assertScrapeRateLimit(request)
  const input = readInputQuery(request)
  return getWeebcentralSeries(input, proxyConfig, {
    bypassCache: readForceRefreshQuery(request),
  })
}

export async function getChapterDtoForRequest(request: Request) {
  assertScrapeRateLimit(request)
  const input = readInputQuery(request)
  return getWeebcentralChapter(input, proxyConfig)
}
