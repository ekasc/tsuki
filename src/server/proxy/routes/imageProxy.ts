import { HttpError } from '#/server/errors'

import { isApprovedImageHost, isApprovedImageUrl, proxyConfig } from '../server'
import { decodeBase64Url } from '../utils/base64url'
import { isHostnameAllowed } from '../utils/security'
import {
  enforceImageProxyRateLimit,
  fetchWithWeebcentralPolicy,
  isPrefetchRequest,
} from '../utils/upstream-policy'
import {
  errorMessageFromUnknown,
  logProxyEvent,
  resolveRequestId,
  statusCodeFromError,
  writeProxyMetric,
} from '../utils/observability'

function pickHeader(headers: Headers, key: string): string | null {
  const value = headers.get(key)
  if (!value) {
    return null
  }
  return value
}

const IMAGE_PROXY_CACHE_CONTROL =
  'public, max-age=604800, s-maxage=604800, stale-while-revalidate=86400, immutable'

export async function proxyImageByEncodedUrl(
  request: Request,
  encodedUrl: string,
  options: { crop?: 'left' | 'right' | null } = {},
): Promise<Response> {
  const startedAt = Date.now()
  const requestPath = new URL(request.url).pathname
  const requestId = resolveRequestId(request)
  const prefetch = isPrefetchRequest(request)
  await enforceImageProxyRateLimit(request, proxyConfig)
  const decoded = decodeBase64Url(encodedUrl)
  let decodedUrl: URL

  try {
    decodedUrl = new URL(decoded)
  } catch {
    throw new HttpError(400, 'Invalid upstream URL')
  }
  const isApproved = isApprovedImageUrl(decoded)
  const isApprovedHost = await isApprovedImageHost(decodedUrl.hostname)
  const isStaticallyAllowed = isHostnameAllowed(
    decodedUrl.hostname,
    proxyConfig.weebcentralImageHostAllowlist,
  )
  const upstreamHost = decodedUrl.hostname

  if (!isApproved && !isApprovedHost && !isStaticallyAllowed) {
    const durationMs = Date.now() - startedAt
    logProxyEvent('proxy.image.blocked_host', {
      route: '/v1/image/$b64',
      requestId,
      method: request.method,
      path: requestPath,
      provider: 'weebcentral',
      upstreamHost,
      status: 403,
      durationMs,
      prefetch,
      cachePolicy: 'image',
      outcome: 'error',
      errorMessage: `Host blocked by allowlist: ${upstreamHost}`,
    })
    await writeProxyMetric('proxy.image', {
      route: '/v1/image/$b64',
      provider: 'weebcentral',
      upstreamHost,
      status: 403,
      durationMs,
      prefetch,
      cachePolicy: 'image',
      outcome: 'error',
      errorMessage: `Host blocked by allowlist: ${upstreamHost}`,
    })
    throw new HttpError(403, 'Upstream host is not allowed')
  }

  const allowedHostnames = isApproved || isApprovedHost
    ? Array.from(
        new Set([decodedUrl.hostname, ...proxyConfig.weebcentralImageHostAllowlist]),
      )
    : proxyConfig.weebcentralImageHostAllowlist

  try {
    const upstreamResponse = await fetchWithWeebcentralPolicy(
      decoded,
      {
        method: 'GET',
        headers: {
          Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
        },
      },
      {
        allowedHostnames,
        maxRedirects: proxyConfig.imageProxyMaxRedirects,
        cacheClass: 'image',
        telemetry: {
          route: '/v1/image/$b64',
          requestId,
          method: request.method,
          path: requestPath,
          provider: 'weebcentral',
          prefetch,
        },
      },
      proxyConfig,
    )

    if (!upstreamResponse.ok || !upstreamResponse.body) {
      throw new HttpError(
        502,
        `Upstream image request failed with status ${upstreamResponse.status}`,
      )
    }

    const headers = new Headers()
    headers.set('Cache-Control', IMAGE_PROXY_CACHE_CONTROL)
    headers.set('X-Content-Type-Options', 'nosniff')

    if (options.crop) {
      const { default: sharp } = await import('sharp')
      const arrayBuffer = await upstreamResponse.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)

      let pipeline = sharp(buffer)
      const metadata = await pipeline.metadata()

      if (metadata.width && metadata.height) {
        const halfWidth = Math.floor(metadata.width / 2)
        pipeline = pipeline.extract({
          left: options.crop === 'right' ? halfWidth : 0,
          top: 0,
          width: halfWidth,
          height: metadata.height,
        })
      }

      const outputBuffer = await pipeline.webp({ quality: 84 }).toBuffer()

      headers.set('Content-Type', 'image/webp')
      headers.set('Content-Length', outputBuffer.length.toString())

      const etag = pickHeader(upstreamResponse.headers, 'etag')
      if (etag) {
        headers.set('ETag', `${etag}-crop-${options.crop}`)
      }
      const lastModified = pickHeader(upstreamResponse.headers, 'last-modified')
      if (lastModified) {
        headers.set('Last-Modified', lastModified)
      }

      const durationMs = Date.now() - startedAt
      logProxyEvent('proxy.image.success', {
        route: '/v1/image/$b64',
        requestId,
        method: request.method,
        path: requestPath,
        provider: 'weebcentral',
        upstreamHost,
        status: 200,
        durationMs,
        prefetch,
        cachePolicy: 'image',
        outcome: 'success',
      })
      await writeProxyMetric('proxy.image', {
        route: '/v1/image/$b64',
        provider: 'weebcentral',
        upstreamHost,
        status: 200,
        durationMs,
        prefetch,
        cachePolicy: 'image',
        outcome: 'success',
      })

      return new Response(outputBuffer as unknown as BodyInit, {
        status: 200,
        headers,
      })
    }

    headers.set(
      'Content-Type',
      pickHeader(upstreamResponse.headers, 'content-type') ??
        'application/octet-stream',
    )

    const copyHeaders = ['content-length', 'etag', 'last-modified']

    for (const key of copyHeaders) {
      const value = pickHeader(upstreamResponse.headers, key)
      if (value) {
        headers.set(key, value)
      }
    }

    const durationMs = Date.now() - startedAt
    logProxyEvent('proxy.image.success', {
      route: '/v1/image/$b64',
      requestId,
      method: request.method,
      path: requestPath,
      provider: 'weebcentral',
      upstreamHost,
      status: 200,
      durationMs,
      prefetch,
      cachePolicy: 'image',
      outcome: 'success',
    })
    await writeProxyMetric('proxy.image', {
      route: '/v1/image/$b64',
      provider: 'weebcentral',
      upstreamHost,
      status: 200,
      durationMs,
      prefetch,
      cachePolicy: 'image',
      outcome: 'success',
    })

    return new Response(upstreamResponse.body, {
      status: 200,
      headers,
    })
  } catch (error) {
    const durationMs = Date.now() - startedAt
    const status = statusCodeFromError(error)
    logProxyEvent('proxy.image.error', {
      route: '/v1/image/$b64',
      requestId,
      method: request.method,
      path: requestPath,
      provider: 'weebcentral',
      upstreamHost,
      status,
      durationMs,
      prefetch,
      cachePolicy: 'image',
      outcome: 'error',
      errorMessage: errorMessageFromUnknown(error),
    })
    await writeProxyMetric('proxy.image', {
      route: '/v1/image/$b64',
      provider: 'weebcentral',
      upstreamHost,
      status,
      durationMs,
      prefetch,
      cachePolicy: 'image',
      outcome: 'error',
      errorMessage: errorMessageFromUnknown(error),
    })
    throw error
  }
}
