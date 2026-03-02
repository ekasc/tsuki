import { describe, expect, it } from 'vitest'

import {
  attachRequestIdHeader,
  errorMessageFromUnknown,
  resolveRequestId,
} from './observability'

describe('resolveRequestId', () => {
  it('prefers explicit x-request-id header', () => {
    const request = new Request('https://example.com/v1/weebcentral/series', {
      headers: {
        'x-request-id': 'abc-123',
        'cf-ray': 'ray-456',
      },
    })

    expect(resolveRequestId(request)).toBe('abc-123')
  })

  it('falls back to cf-ray when x-request-id is absent', () => {
    const request = new Request('https://example.com/v1/weebcentral/series', {
      headers: {
        'cf-ray': 'ray-456',
      },
    })

    expect(resolveRequestId(request)).toBe('ray-456')
  })
})

describe('attachRequestIdHeader', () => {
  it('writes x-request-id header to responses', () => {
    const response = new Response('ok')

    attachRequestIdHeader(response, 'req-789')
    expect(response.headers.get('x-request-id')).toBe('req-789')
  })
})

describe('errorMessageFromUnknown', () => {
  it('redacts known sensitive query params', () => {
    const message = errorMessageFromUnknown(
      new Error('Upstream failed: https://a.com/p?token=abc123&foo=1'),
    )

    expect(message).not.toContain('?token=')
    expect(message).not.toContain('abc123')
    expect(message).toContain('https://a.com/p')
  })
})
