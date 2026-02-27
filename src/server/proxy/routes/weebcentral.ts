import { detectRemoteProviderFromInput } from '#/lib/remote-provider'
import {
  getWeebcentralChapter,
  getWeebcentralSeries,
} from '../adapters/weebcentral'
import { getMangaDexChapter, getMangaDexSeries } from '../adapters/mangadex'
import { proxyConfig } from '../server'
import {
  assertWeebcentralApiRateLimit,
  assertWeebcentralForceRefreshRateLimit,
} from '../utils/upstream-policy'

import { HttpError } from '#/server/errors'

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

export async function getSeriesDtoForRequest(request: Request) {
  assertWeebcentralApiRateLimit(request, proxyConfig)
  const forceRefresh = readForceRefreshQuery(request)
  if (forceRefresh) {
    assertWeebcentralForceRefreshRateLimit(request, proxyConfig)
  }
  const input = readInputQuery(request)

  const provider = detectRemoteProviderFromInput(input)

  if (provider === 'mangadex') {
    return getMangaDexSeries(input, proxyConfig, {
      bypassCache: forceRefresh,
    })
  }

  return getWeebcentralSeries(input, proxyConfig, {
    bypassCache: forceRefresh,
  })
}

export async function getChapterDtoForRequest(request: Request) {
  assertWeebcentralApiRateLimit(request, proxyConfig)
  const input = readInputQuery(request)

  const provider = detectRemoteProviderFromInput(input)

  if (provider === 'mangadex') {
    return getMangaDexChapter(input, proxyConfig)
  }

  return getWeebcentralChapter(input, proxyConfig)
}
