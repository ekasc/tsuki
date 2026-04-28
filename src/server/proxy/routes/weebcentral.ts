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

interface ProxyTraceContext {
  route: string
  metricName: string
  request: Request
  requestPath: string
  requestId: string
  provider: string
  prefetch: boolean
  cachePolicy: string
  startedAt: number
}

async function traceProxy<T>(
  operation: () => Promise<T>,
  ctx: ProxyTraceContext,
): Promise<T> {
  try {
    const result = await operation()
    const durationMs = Date.now() - ctx.startedAt
    const base = {
      route: ctx.route,
      requestId: ctx.requestId,
      method: ctx.request.method,
      path: ctx.requestPath,
      provider: ctx.provider,
      status: 200,
      durationMs,
      prefetch: ctx.prefetch,
      cachePolicy: ctx.cachePolicy,
      outcome: 'success' as const,
    }
    logProxyEvent(`${ctx.metricName}.success`, base)
    await writeProxyMetric(ctx.metricName, base)
    return result
  } catch (error) {
    const durationMs = Date.now() - ctx.startedAt
    const status = statusCodeFromError(error)
    const base = {
      route: ctx.route,
      requestId: ctx.requestId,
      method: ctx.request.method,
      path: ctx.requestPath,
      provider: ctx.provider,
      status,
      durationMs,
      prefetch: ctx.prefetch,
      cachePolicy: ctx.cachePolicy,
      outcome: 'error' as const,
      errorMessage: errorMessageFromUnknown(error),
    }
    logProxyEvent(`${ctx.metricName}.error`, base)
    await writeProxyMetric(ctx.metricName, base)
    throw error
  }
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
  const telemetry = {
    route: '/v1/weebcentral/series',
    requestId,
    method: request.method,
    path: requestPath,
    provider,
    prefetch,
  }

  return traceProxy(
    () =>
      provider === 'mangadex'
        ? getMangaDexSeries(input, proxyConfig, {
            bypassCache: forceRefresh,
            telemetry,
          })
        : getWeebcentralSeries(input, proxyConfig, {
            bypassCache: forceRefresh,
            telemetry,
          }),
    {
      route: '/v1/weebcentral/series',
      metricName: 'proxy.series',
      request,
      requestPath,
      requestId,
      provider,
      prefetch,
      cachePolicy: forceRefresh ? 'bypass' : 'metadata',
      startedAt,
    },
  )
}

export async function getChapterDtoForRequest(request: Request) {
  const startedAt = Date.now()
  const requestPath = new URL(request.url).pathname
  const requestId = resolveRequestId(request)
  const prefetch = isPrefetchRequest(request)
  await enforceWeebcentralApiRateLimit(request, proxyConfig)
  const input = readInputQuery(request)
  const provider = detectRemoteProviderFromInput(input)
  const telemetry = {
    route: '/v1/weebcentral/chapter',
    requestId,
    method: request.method,
    path: requestPath,
    provider,
    prefetch,
  }

  return traceProxy(
    () =>
      provider === 'mangadex'
        ? getMangaDexChapter(input, proxyConfig, { telemetry })
        : getWeebcentralChapter(input, proxyConfig, { telemetry }),
    {
      route: '/v1/weebcentral/chapter',
      metricName: 'proxy.chapter',
      request,
      requestPath,
      requestId,
      provider,
      prefetch,
      cachePolicy: 'metadata',
      startedAt,
    },
  )
}
