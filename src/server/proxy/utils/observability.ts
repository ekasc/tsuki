import { HttpError } from '#/server/errors'

import {
  type CloudflareAnalyticsBinding,
  getCloudflareBinding,
} from './cloudflare-bindings'

interface ProxyTelemetryFields {
  route: string
  provider?: string
  status?: number
  durationMs?: number
  prefetch?: boolean
  cachePolicy?: string
  outcome?: 'success' | 'error'
  errorMessage?: string
}

const DEFAULT_ANALYTICS_BINDING = 'TSUKI_ANALYTICS'

function toSafeNumber(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0
  }

  return value
}

export function statusCodeFromError(error: unknown): number {
  if (error instanceof HttpError) {
    return error.status
  }

  return 500
}

export function logProxyEvent(event: string, fields: ProxyTelemetryFields): void {
  const payload = {
    ts: new Date().toISOString(),
    event,
    ...fields,
  }

  try {
    console.info(JSON.stringify(payload))
  } catch {
    console.info('[tsuki-proxy]', event, fields)
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
        fields.errorMessage ?? '',
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
