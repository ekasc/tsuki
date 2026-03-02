import { HttpError } from '#/server/errors'

import {
  type CloudflareAnalyticsBinding,
  getCloudflareBinding,
} from './cloudflare-bindings'

export type ProxyLogLevel = 'info' | 'warn' | 'error'

export interface ProxyTelemetryFields {
  route: string
  requestId?: string
  method?: string
  path?: string
  provider?: string
  upstreamHost?: string
  status?: number
  durationMs?: number
  prefetch?: boolean
  cachePolicy?: string
  attempt?: number
  maxAttempts?: number
  retryDelayMs?: number
  outcome?: 'success' | 'error'
  errorMessage?: string
}

const DEFAULT_ANALYTICS_BINDING = 'TSUKI_ANALYTICS'
const REQUEST_ID_HEADER = 'x-request-id'
const DEFAULT_SUCCESS_SAMPLE_RATE = 0.2
const DEFAULT_PREFETCH_SAMPLE_RATE = 0.05
const MAX_ERROR_MESSAGE_LENGTH = 240
const REDACTED_VALUE = '[redacted]'

function clampSampleRate(rate: number): number {
  if (!Number.isFinite(rate)) {
    return DEFAULT_SUCCESS_SAMPLE_RATE
  }

  return Math.min(1, Math.max(0, rate))
}

function toHashUnitInterval(input: string): number {
  // FNV-1a hash for deterministic log sampling without external state.
  let hash = 2166136261

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return (hash >>> 0) / 4294967295
}

function sanitizeMessage(message: string): string {
  const withoutSensitiveQueryValues = message.replace(
    /([?&](?:api[_-]?key|auth|authorization|key|signature|sig|token|expires)=)[^&\s]+/gi,
    `$1${REDACTED_VALUE}`,
  )

  const withoutVerboseUrls = withoutSensitiveQueryValues.replace(
    /https?:\/\/[^\s]+/gi,
    (candidate) => {
      try {
        const normalized = new URL(candidate)
        return `${normalized.origin}${normalized.pathname}`
      } catch {
        return candidate
      }
    },
  )

  return withoutVerboseUrls.slice(0, MAX_ERROR_MESSAGE_LENGTH)
}

function resolveRandomRequestId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID()
  }

  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.getRandomValues === 'function'
  ) {
    const bytes = new Uint8Array(12)
    crypto.getRandomValues(bytes)
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  }

  return `tsuki-${Date.now().toString(36)}`
}

function sanitizeRequestId(value: string): string {
  return value
    .trim()
    .replace(/[^\w\-.:]/g, '')
    .slice(0, 128)
}

function inferLogLevel(fields: ProxyTelemetryFields): ProxyLogLevel {
  if (fields.outcome === 'error') {
    return 'error'
  }

  if (typeof fields.status === 'number') {
    if (fields.status >= 500) {
      return 'error'
    }
    if (fields.status >= 400) {
      return 'warn'
    }
  }

  return 'info'
}

function shouldLog(
  level: ProxyLogLevel,
  event: string,
  fields: ProxyTelemetryFields,
  sampleRate?: number,
): boolean {
  if (level === 'warn' || level === 'error') {
    return true
  }

  if (fields.outcome === 'error' || (fields.status ?? 0) >= 400) {
    return true
  }

  const rate = clampSampleRate(
    sampleRate ??
      (fields.prefetch ? DEFAULT_PREFETCH_SAMPLE_RATE : DEFAULT_SUCCESS_SAMPLE_RATE),
  )
  if (rate >= 1) {
    return true
  }
  if (rate <= 0) {
    return false
  }

  const key = `${fields.requestId ?? ''}:${event}:${fields.route}:${
    fields.status ?? 0
  }:${fields.attempt ?? 0}`
  return toHashUnitInterval(key) < rate
}

function toSafeNumber(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0
  }

  return value
}

export function resolveRequestId(request: Request): string {
  const primary = request.headers.get(REQUEST_ID_HEADER)
  if (primary) {
    const sanitized = sanitizeRequestId(primary)
    if (sanitized.length > 0) {
      return sanitized
    }
  }

  const cfRay = request.headers.get('cf-ray')
  if (cfRay) {
    const sanitized = sanitizeRequestId(cfRay)
    if (sanitized.length > 0) {
      return sanitized
    }
  }

  return resolveRandomRequestId()
}

export function attachRequestIdHeader(response: Response, requestId: string): void {
  if (!requestId) {
    return
  }

  response.headers.set(REQUEST_ID_HEADER, requestId)
}

export function errorMessageFromUnknown(error: unknown): string {
  if (error instanceof Error) {
    return sanitizeMessage(error.message)
  }

  return sanitizeMessage(String(error ?? 'Unknown error'))
}

export function statusCodeFromError(error: unknown): number {
  if (error instanceof HttpError) {
    return error.status
  }

  return 500
}

export function logProxyEvent(
  event: string,
  fields: ProxyTelemetryFields,
  options?: {
    level?: ProxyLogLevel
    sampleRate?: number
  },
): void {
  const level = options?.level ?? inferLogLevel(fields)
  if (!shouldLog(level, event, fields, options?.sampleRate)) {
    return
  }

  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    requestId: fields.requestId,
    method: fields.method,
    path: fields.path,
    provider: fields.provider,
    upstreamHost: fields.upstreamHost,
    route: fields.route,
    status: fields.status,
    durationMs: fields.durationMs,
    prefetch: fields.prefetch,
    cachePolicy: fields.cachePolicy,
    attempt: fields.attempt,
    maxAttempts: fields.maxAttempts,
    retryDelayMs: fields.retryDelayMs,
    outcome: fields.outcome,
    errorMessage: fields.errorMessage
      ? sanitizeMessage(fields.errorMessage)
      : undefined,
  }

  try {
    if (level === 'error') {
      console.error(JSON.stringify(payload))
      return
    }

    if (level === 'warn') {
      console.warn(JSON.stringify(payload))
      return
    }

    console.info(JSON.stringify(payload))
  } catch {
    console.info('[tsuki-proxy]', level, event, fields)
  }
}

async function getAnalyticsBinding(): Promise<CloudflareAnalyticsBinding | null> {
  return getCloudflareBinding<CloudflareAnalyticsBinding>(
    DEFAULT_ANALYTICS_BINDING,
  )
}

export async function writeProxyMetric(
  metric: string,
  fields: ProxyTelemetryFields,
): Promise<void> {
  const binding = await getAnalyticsBinding()
  if (!binding) {
    return
  }

  try {
    binding.writeDataPoint({
      indexes: [
        metric,
        fields.route,
        fields.provider ?? 'unknown',
      ],
      blobs: [
        fields.outcome ?? 'success',
        fields.prefetch ? 'prefetch' : 'interactive',
        fields.cachePolicy ?? '',
        fields.errorMessage ? sanitizeMessage(fields.errorMessage) : '',
      ],
      doubles: [
        toSafeNumber(fields.status),
        toSafeNumber(fields.durationMs),
        Date.now(),
      ],
    })
  } catch {
    // Telemetry must never break user requests.
  }
}
