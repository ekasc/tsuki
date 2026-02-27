import { describe, expect, it } from 'vitest'

import { proxyConfig } from '../server'
import {
  assertImageProxyRateLimit,
  assertWeebcentralApiRateLimit,
  assertWeebcentralForceRefreshRateLimit,
  isPrefetchRequest,
} from './upstream-policy'

function makeRequest(url: string, ip: string, headers?: HeadersInit): Request {
  const requestHeaders = new Headers(headers)
  requestHeaders.set('x-forwarded-for', ip)

  return new Request(url, {
    headers: requestHeaders,
  })
}

describe('isPrefetchRequest', () => {
  it('detects explicit tsuki prefetch marker', () => {
    const request = new Request('https://example.com/v1/weebcentral/chapter', {
      headers: {
        'x-tsuki-prefetch': '1',
      },
    })

    expect(isPrefetchRequest(request)).toBe(true)
  })

  it('detects browser purpose prefetch headers', () => {
    const request = new Request('https://example.com/v1/image/abc', {
      headers: {
        purpose: 'prefetch',
      },
    })

    expect(isPrefetchRequest(request)).toBe(true)
  })

  it('does not treat normal requests as prefetch', () => {
    const request = new Request('https://example.com/v1/weebcentral/series')
    expect(isPrefetchRequest(request)).toBe(false)
  })
})

describe('upstream policy rate limit scopes', () => {
  it('keeps interactive and prefetch scrape buckets separate', () => {
    const clientIp = '198.51.100.11'
    const config = {
      ...proxyConfig,
      scrapeRateLimitPerMinute: 1,
      scrapePrefetchRateLimitPerMinute: 1,
    }

    const interactive = makeRequest(
      'https://example.com/v1/weebcentral/chapter',
      clientIp,
    )
    const prefetch = makeRequest(
      'https://example.com/v1/weebcentral/chapter',
      clientIp,
      {
        'x-tsuki-prefetch': '1',
      },
    )

    expect(() => assertWeebcentralApiRateLimit(interactive, config)).not.toThrow()
    expect(() => assertWeebcentralApiRateLimit(prefetch, config)).not.toThrow()
    expect(() => assertWeebcentralApiRateLimit(interactive, config)).toThrow(
      /too many requests/i,
    )
    expect(() => assertWeebcentralApiRateLimit(prefetch, config)).toThrow(
      /too many requests/i,
    )
  })

  it('keeps interactive and prefetch image buckets separate', () => {
    const clientIp = '203.0.113.19'
    const config = {
      ...proxyConfig,
      imageRateLimitPerMinute: 1,
      imagePrefetchRateLimitPerMinute: 1,
    }

    const interactive = makeRequest('https://example.com/v1/image/abc', clientIp)
    const prefetch = makeRequest('https://example.com/v1/image/abc', clientIp, {
      'x-tsuki-prefetch': '1',
    })

    expect(() => assertImageProxyRateLimit(interactive, config)).not.toThrow()
    expect(() => assertImageProxyRateLimit(prefetch, config)).not.toThrow()
    expect(() => assertImageProxyRateLimit(interactive, config)).toThrow(
      /too many requests/i,
    )
    expect(() => assertImageProxyRateLimit(prefetch, config)).toThrow(
      /too many requests/i,
    )
  })

  it('applies dedicated force-refresh throttle for metadata sync', () => {
    const clientIp = '192.0.2.21'
    const config = {
      ...proxyConfig,
      scrapeForceRefreshRateLimitPerMinute: 1,
    }

    const request = makeRequest(
      'https://example.com/v1/weebcentral/series?force=1',
      clientIp,
    )

    expect(() =>
      assertWeebcentralForceRefreshRateLimit(request, config),
    ).not.toThrow()
    expect(() =>
      assertWeebcentralForceRefreshRateLimit(request, config),
    ).toThrow(/too many requests/i)
  })
})
