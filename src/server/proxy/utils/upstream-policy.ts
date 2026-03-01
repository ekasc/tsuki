import pLimit from 'p-limit'

import { HttpError } from '#/server/errors'
import { assertRateLimit, requestClientId } from '#/server/rate-limit'

import type { ProxyServerConfig } from '../server'
import { proxyConfig } from '../server'
import {
  type CloudflareRateLimitBinding,
  type CloudflareRateLimitResult,
  getCloudflareBinding,
} from './cloudflare-bindings'
import { fetchWithSafeRedirects } from './security'

const circuitFailuresByHost = new Map<string, number[]>()
const circuitOpenUntilByHost = new Map<string, number>()
const upstreamLimitersByConcurrency = new Map<number, ReturnType<typeof pLimit>>()

const RETRYABLE_STATUSES = new Set([502, 503, 504])
const CIRCUIT_BREAKER_STATUSES = new Set([403, 429, 502, 503, 504])
const MAX_RETRY_AFTER_MS = 15 * 60_000
const EDGE_RATE_LIMIT_SCRAPE_BINDING = 'TSUKI_RL_SCRAPE'
const EDGE_RATE_LIMIT_SCRAPE_PREFETCH_BINDING = 'TSUKI_RL_SCRAPE_PREFETCH'
const EDGE_RATE_LIMIT_SCRAPE_FORCE_BINDING = 'TSUKI_RL_SCRAPE_FORCE'
const EDGE_RATE_LIMIT_IMAGE_BINDING = 'TSUKI_RL_IMAGE'
const EDGE_RATE_LIMIT_IMAGE_PREFETCH_BINDING = 'TSUKI_RL_IMAGE_PREFETCH'

interface CfCachePolicyInput {
  cacheClass?: 'metadata' | 'image'
  bypassCloudflareCache?: boolean
}

interface CfCachePolicyOutput {
  cacheEverything?: boolean
  cacheTtl?: number
  cacheTtlByStatus?: Record<string, number>
}

interface RequestInitWithCloudflare extends RequestInit {
  cf?: CfCachePolicyOutput
}

function resolveHost(input: URL | string): string {
  const url = input instanceof URL ? input : new URL(input)
  return url.hostname.toLowerCase()
}

function getUpstreamLimiter(
  concurrency: number,
): ReturnType<typeof pLimit> {
  const safeConcurrency = Math.max(1, concurrency)
  const existing = upstreamLimitersByConcurrency.get(safeConcurrency)
  if (existing) {
    return existing
  }

  const limiter = pLimit(safeConcurrency)
  upstreamLimitersByConcurrency.set(safeConcurrency, limiter)
  return limiter
}

function jitteredBackoffMs(baseDelayMs: number, attempt: number): number {
  const exponential = baseDelayMs * Math.pow(2, Math.max(0, attempt - 1))
  const jitterFactor = 0.82 + Math.random() * 0.36
  return Math.floor(exponential * jitterFactor)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function mergeAbortSignals(
  primary: AbortSignal,
  secondary?: AbortSignal,
): AbortSignal {
  if (!secondary) {
    return primary
  }

  if (primary.aborted || secondary.aborted) {
    const aborted = new AbortController()
    aborted.abort()
    return aborted.signal
  }

  const controller = new AbortController()

  const abort = () => {
    controller.abort()
  }

  primary.addEventListener('abort', abort, { once: true })
  secondary.addEventListener('abort', abort, { once: true })
  return controller.signal
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  return error.name === 'AbortError'
}

function mapTimeoutError(error: unknown): HttpError {
  if (error instanceof HttpError) {
    return error
  }

  if (isAbortError(error)) {
    return new HttpError(504, 'Upstream request timed out. Please try again.')
  }

  if (error instanceof Error) {
    return new HttpError(502, error.message)
  }

  return new HttpError(502, 'Failed to fetch upstream resource')
}

function pruneHostFailures(host: string, config: ProxyServerConfig): number[] {
  const now = Date.now()
  const lowerBound = now - config.upstreamCircuitFailureWindowMs
  const kept =
    circuitFailuresByHost
      .get(host)
      ?.filter((timestamp) => timestamp >= lowerBound) ?? []
  circuitFailuresByHost.set(host, kept)
  return kept
}

function recordHostFailure(
  host: string,
  config: ProxyServerConfig,
  options?: { forceOpenMs?: number },
): void {
  const now = Date.now()
  const failures = pruneHostFailures(host, config)
  failures.push(now)
  circuitFailuresByHost.set(host, failures)

  if (options?.forceOpenMs && options.forceOpenMs > 0) {
    const forcedOpenUntil = now + Math.min(options.forceOpenMs, MAX_RETRY_AFTER_MS)
    const currentOpenUntil = circuitOpenUntilByHost.get(host) ?? 0
    circuitOpenUntilByHost.set(host, Math.max(currentOpenUntil, forcedOpenUntil))
  }

  if (failures.length >= config.upstreamCircuitFailureThreshold) {
    circuitOpenUntilByHost.set(host, now + config.upstreamCircuitOpenMs)
  }
}

function recordHostSuccess(host: string): void {
  circuitOpenUntilByHost.delete(host)
  circuitFailuresByHost.delete(host)
}

function assertHostCircuitClosed(host: string): void {
  const now = Date.now()
  const openUntil = circuitOpenUntilByHost.get(host) ?? 0
  if (openUntil <= now) {
    return
  }

  const remainingMs = openUntil - now
  const waitSeconds = Math.max(1, Math.ceil(remainingMs / 1000))
  throw new HttpError(
    503,
    `Upstream is temporarily throttled. Retry in about ${waitSeconds}s.`,
  )
}

function shouldRetryStatus(status: number): boolean {
  return RETRYABLE_STATUSES.has(status)
}

function shouldTripCircuitForStatus(status: number): boolean {
  return CIRCUIT_BREAKER_STATUSES.has(status)
}

function shouldRetryError(error: HttpError): boolean {
  return RETRYABLE_STATUSES.has(error.status)
}

function shouldTripCircuitForError(error: HttpError): boolean {
  return CIRCUIT_BREAKER_STATUSES.has(error.status)
}

function parseRetryAfterMs(headerValue: string | null): number | null {
  if (!headerValue) {
    return null
  }

  const seconds = Number.parseInt(headerValue, 10)
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(seconds * 1_000, MAX_RETRY_AFTER_MS)
  }

  const asDate = Date.parse(headerValue)
  if (Number.isNaN(asDate)) {
    return null
  }

  const ms = asDate - Date.now()
  if (ms <= 0) {
    return null
  }

  return Math.min(ms, MAX_RETRY_AFTER_MS)
}

export function buildCloudflareCachePolicy(
  options: CfCachePolicyInput,
): CfCachePolicyOutput | undefined {
  if (options.bypassCloudflareCache) {
    return {
      cacheEverything: false,
      cacheTtl: 0,
      cacheTtlByStatus: {
        '200-299': 0,
        '300-499': 0,
        '500-599': 0,
      },
    }
  }

  if (options.cacheClass === 'image') {
    return {
      cacheEverything: true,
      cacheTtlByStatus: {
        '200-299': 60 * 60 * 24,
        '404': 60,
        '500-599': 0,
      },
    }
  }

  return {
    cacheEverything: true,
    cacheTtlByStatus: {
      '200-299': 120,
      '404': 15,
      '500-599': 0,
    },
  }
}

async function consumeEdgeRateLimit(
  bindingName: string,
  key: string,
): Promise<boolean> {
  const binding = await getCloudflareBinding<CloudflareRateLimitBinding>(
    bindingName,
  )

  if (!binding || typeof binding.limit !== 'function') {
    return false
  }

  let result: CloudflareRateLimitResult
  try {
    result = await binding.limit({ key })
  } catch {
    return false
  }

  if (result?.success === false) {
    throw new HttpError(429, 'Too many requests. Please try again shortly.')
  }

  return true
}

export function isPrefetchRequest(request: Request): boolean {
  const explicit = request.headers.get('x-tsuki-prefetch')
  if (explicit === '1') {
    return true
  }

  const purpose = request.headers.get('purpose')?.toLowerCase()
  if (purpose?.includes('prefetch')) {
    return true
  }

  const secPurpose = request.headers.get('sec-purpose')?.toLowerCase()
  if (secPurpose?.includes('prefetch')) {
    return true
  }

  const secFetchPurpose = request.headers
    .get('sec-fetch-purpose')
    ?.toLowerCase()
  if (secFetchPurpose?.includes('prefetch')) {
    return true
  }

  return false
}

export function assertWeebcentralApiRateLimit(
  request: Request,
  config: ProxyServerConfig = proxyConfig,
): void {
  const clientId = requestClientId(request)
  const prefetch = isPrefetchRequest(request)
  const limit = prefetch
    ? config.scrapePrefetchRateLimitPerMinute
    : config.scrapeRateLimitPerMinute
  const scope = prefetch ? 'prefetch' : 'interactive'

  assertRateLimit(`proxy-scrape:${scope}:${clientId}`, {
    limit,
    windowMs: 60_000,
  })
}

export async function enforceWeebcentralApiRateLimit(
  request: Request,
  config: ProxyServerConfig = proxyConfig,
): Promise<void> {
  const clientId = requestClientId(request)
  const prefetch = isPrefetchRequest(request)
  const scope = prefetch ? 'prefetch' : 'interactive'
  const key = `proxy-scrape:${scope}:${clientId}`
  const edgeBinding = prefetch
    ? EDGE_RATE_LIMIT_SCRAPE_PREFETCH_BINDING
    : EDGE_RATE_LIMIT_SCRAPE_BINDING

  const edgeApplied = await consumeEdgeRateLimit(edgeBinding, key)
  if (edgeApplied) {
    return
  }

  assertWeebcentralApiRateLimit(request, config)
}

export function assertWeebcentralForceRefreshRateLimit(
  request: Request,
  config: ProxyServerConfig = proxyConfig,
): void {
  const clientId = requestClientId(request)
  assertRateLimit(`proxy-scrape-force:${clientId}`, {
    limit: config.scrapeForceRefreshRateLimitPerMinute,
    windowMs: 60_000,
  })
}

export async function enforceWeebcentralForceRefreshRateLimit(
  request: Request,
  config: ProxyServerConfig = proxyConfig,
): Promise<void> {
  const clientId = requestClientId(request)
  const key = `proxy-scrape-force:${clientId}`
  const edgeApplied = await consumeEdgeRateLimit(
    EDGE_RATE_LIMIT_SCRAPE_FORCE_BINDING,
    key,
  )

  if (edgeApplied) {
    return
  }

  assertWeebcentralForceRefreshRateLimit(request, config)
}

export function assertImageProxyRateLimit(
  request: Request,
  config: ProxyServerConfig = proxyConfig,
): void {
  const clientId = requestClientId(request)
  const prefetch = isPrefetchRequest(request)
  const limit = prefetch
    ? config.imagePrefetchRateLimitPerMinute
    : config.imageRateLimitPerMinute
  const scope = prefetch ? 'prefetch' : 'interactive'

  assertRateLimit(`proxy-image:${scope}:${clientId}`, {
    limit,
    windowMs: 60_000,
  })
}

export async function enforceImageProxyRateLimit(
  request: Request,
  config: ProxyServerConfig = proxyConfig,
): Promise<void> {
  const clientId = requestClientId(request)
  const prefetch = isPrefetchRequest(request)
  const scope = prefetch ? 'prefetch' : 'interactive'
  const key = `proxy-image:${scope}:${clientId}`
  const edgeBinding = prefetch
    ? EDGE_RATE_LIMIT_IMAGE_PREFETCH_BINDING
    : EDGE_RATE_LIMIT_IMAGE_BINDING

  const edgeApplied = await consumeEdgeRateLimit(edgeBinding, key)
  if (edgeApplied) {
    return
  }

  assertImageProxyRateLimit(request, config)
}

export async function fetchWithWeebcentralPolicy(
  input: URL | string,
  init: RequestInit,
  options: {
    allowedHostnames: string[]
    maxRedirects?: number
    cacheClass?: 'metadata' | 'image'
    bypassCloudflareCache?: boolean
  },
  config: ProxyServerConfig = proxyConfig,
): Promise<Response> {
  const host = resolveHost(input)
  const attempts = Math.max(1, config.upstreamRetryCount + 1)
  const limiter = getUpstreamLimiter(config.upstreamMaxConcurrentRequests)

  let latestError: HttpError | null = null

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    assertRateLimit('proxy-upstream:global', {
      limit: config.upstreamGlobalRateLimitPerMinute,
      windowMs: 60_000,
    })
    assertHostCircuitClosed(host)

    try {
      const response = await limiter(async () => {
        const timeoutController = new AbortController()
        const timeoutId = setTimeout(
          () => timeoutController.abort(),
          config.upstreamTimeoutMs,
        )

        try {
          const cfCachePolicy = buildCloudflareCachePolicy({
            cacheClass: options.cacheClass,
            bypassCloudflareCache: options.bypassCloudflareCache,
          })

          const requestInit: RequestInitWithCloudflare = {
            ...init,
            signal: mergeAbortSignals(
              timeoutController.signal,
              init.signal ?? undefined,
            ),
          }

          if (cfCachePolicy) {
            requestInit.cf = {
              ...(requestInit.cf ?? {}),
              ...cfCachePolicy,
            }
          }

          return await fetchWithSafeRedirects(
            input,
            requestInit,
            {
              allowedHostnames: options.allowedHostnames,
              maxRedirects: options.maxRedirects,
            },
          )
        } finally {
          clearTimeout(timeoutId)
        }
      })

      if (response.ok) {
        recordHostSuccess(host)
        return response
      }

      const retryAfterMs =
        response.status === 429
          ? parseRetryAfterMs(response.headers.get('retry-after'))
          : null

      if (shouldTripCircuitForStatus(response.status)) {
        recordHostFailure(host, config, {
          forceOpenMs:
            response.status === 429
              ? retryAfterMs ?? config.upstreamCircuitOpenMs
              : retryAfterMs ?? undefined,
        })
      } else {
        recordHostSuccess(host)
      }

      if (shouldRetryStatus(response.status) && attempt < attempts) {
        // Release the response body before retrying to avoid socket/resource buildup.
        await response.arrayBuffer().catch(() => undefined)
        await delay(jitteredBackoffMs(config.upstreamRetryBaseDelayMs, attempt))
        continue
      }

      return response
    } catch (error) {
      const normalized = mapTimeoutError(error)
      latestError = normalized

      if (shouldTripCircuitForError(normalized)) {
        recordHostFailure(host, config)
      }

      if (shouldRetryError(normalized) && attempt < attempts) {
        await delay(jitteredBackoffMs(config.upstreamRetryBaseDelayMs, attempt))
        continue
      }

      throw normalized
    }
  }

  throw (
    latestError ??
    new HttpError(502, 'Failed to fetch upstream resource after retries')
  )
}
