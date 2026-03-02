import { detectRemoteProviderFromInput } from '#/lib/remote-provider'
import {
  getWeebcentralChapter,
  getWeebcentralSeries,
} from '../adapters/weebcentral'
import { getMangaDexChapter, getMangaDexSeries } from '../adapters/mangadex'
import { proxyConfig } from '../server'
import {
  enforceWeebcentralApiRateLimit,
  enforceWeebcentralForceRefreshRateLimit,
  isPrefetchRequest,
} from '../utils/upstream-policy'
import {
  errorMessageFromUnknown,
  logProxyEvent,
  resolveRequestId,
  statusCodeFromError,
  writeProxyMetric,
} from '../utils/observability'

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
  const startedAt = Date.now()
  const requestPath = new URL(request.url).pathname
  const requestId = resolveRequestId(request)
  const prefetch = isPrefetchRequest(request)
  await enforceWeebcentralApiRateLimit(request, proxyConfig)
  const forceRefresh = readForceRefreshQuery(request)
  if (forceRefresh) {
    await enforceWeebcentralForceRefreshRateLimit(request, proxyConfig)
  }
  const input = readInputQuery(request)

  const provider = detectRemoteProviderFromInput(input)

  try {
    const payload =
      provider === 'mangadex'
        ? await getMangaDexSeries(input, proxyConfig, {
            bypassCache: forceRefresh,
            telemetry: {
              route: '/v1/weebcentral/series',
              requestId,
              method: request.method,
              path: requestPath,
              provider,
              prefetch,
            },
          })
        : await getWeebcentralSeries(input, proxyConfig, {
            bypassCache: forceRefresh,
            telemetry: {
              route: '/v1/weebcentral/series',
              requestId,
              method: request.method,
              path: requestPath,
              provider,
              prefetch,
            },
          })

    const durationMs = Date.now() - startedAt
    logProxyEvent('proxy.series.success', {
      route: '/v1/weebcentral/series',
      requestId,
      method: request.method,
      path: requestPath,
      provider,
      status: 200,
      durationMs,
      prefetch,
      cachePolicy: forceRefresh ? 'bypass' : 'metadata',
      outcome: 'success',
    })
    await writeProxyMetric('proxy.series', {
      route: '/v1/weebcentral/series',
      provider,
      status: 200,
      durationMs,
      prefetch,
      cachePolicy: forceRefresh ? 'bypass' : 'metadata',
      outcome: 'success',
    })

    return payload
  } catch (error) {
    const durationMs = Date.now() - startedAt
    const status = statusCodeFromError(error)
    logProxyEvent('proxy.series.error', {
      route: '/v1/weebcentral/series',
      requestId,
      method: request.method,
      path: requestPath,
      provider,
      status,
      durationMs,
      prefetch,
      cachePolicy: forceRefresh ? 'bypass' : 'metadata',
      outcome: 'error',
      errorMessage: errorMessageFromUnknown(error),
    })
    await writeProxyMetric('proxy.series', {
      route: '/v1/weebcentral/series',
      provider,
      status,
      durationMs,
      prefetch,
      cachePolicy: forceRefresh ? 'bypass' : 'metadata',
      outcome: 'error',
      errorMessage: errorMessageFromUnknown(error),
    })
    throw error
  }
}

export async function getChapterDtoForRequest(request: Request) {
  const startedAt = Date.now()
  const requestPath = new URL(request.url).pathname
  const requestId = resolveRequestId(request)
  const prefetch = isPrefetchRequest(request)
  await enforceWeebcentralApiRateLimit(request, proxyConfig)
  const input = readInputQuery(request)

  const provider = detectRemoteProviderFromInput(input)

  try {
    const payload =
      provider === 'mangadex'
        ? await getMangaDexChapter(input, proxyConfig, {
            telemetry: {
              route: '/v1/weebcentral/chapter',
              requestId,
              method: request.method,
              path: requestPath,
              provider,
              prefetch,
            },
          })
        : await getWeebcentralChapter(input, proxyConfig, {
            telemetry: {
              route: '/v1/weebcentral/chapter',
              requestId,
              method: request.method,
              path: requestPath,
              provider,
              prefetch,
            },
          })

    const durationMs = Date.now() - startedAt
    logProxyEvent('proxy.chapter.success', {
      route: '/v1/weebcentral/chapter',
      requestId,
      method: request.method,
      path: requestPath,
      provider,
      status: 200,
      durationMs,
      prefetch,
      cachePolicy: 'metadata',
      outcome: 'success',
    })
    await writeProxyMetric('proxy.chapter', {
      route: '/v1/weebcentral/chapter',
      provider,
      status: 200,
      durationMs,
      prefetch,
      cachePolicy: 'metadata',
      outcome: 'success',
    })

    return payload
  } catch (error) {
    const durationMs = Date.now() - startedAt
    const status = statusCodeFromError(error)
    logProxyEvent('proxy.chapter.error', {
      route: '/v1/weebcentral/chapter',
      requestId,
      method: request.method,
      path: requestPath,
      provider,
      status,
      durationMs,
      prefetch,
      cachePolicy: 'metadata',
      outcome: 'error',
      errorMessage: errorMessageFromUnknown(error),
    })
    await writeProxyMetric('proxy.chapter', {
      route: '/v1/weebcentral/chapter',
      provider,
      status,
      durationMs,
      prefetch,
      cachePolicy: 'metadata',
      outcome: 'error',
      errorMessage: errorMessageFromUnknown(error),
    })
    throw error
  }
}
