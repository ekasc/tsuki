import { describe, expect, it, vi } from 'vitest'

import { TtlCache } from './cache'

describe('TtlCache', () => {
  it('serves stale values until stale window expires', () => {
    vi.useFakeTimers()

    const cache = new TtlCache<string, number>(1_000, 2_000)
    cache.set('k', 7)

    expect(cache.get('k')).toBe(7)
    expect(cache.getStale('k')).toBe(7)

    vi.advanceTimersByTime(1_200)
    expect(cache.get('k')).toBeNull()
    expect(cache.getStale('k')).toBe(7)

    vi.advanceTimersByTime(2_100)
    expect(cache.get('k')).toBeNull()
    expect(cache.getStale('k')).toBeNull()

    vi.useRealTimers()
  })

  it('deduplicates concurrent compute calls in getOrSet', async () => {
    const cache = new TtlCache<string, number>(1_000)
    let computeCalls = 0

    const compute = async () => {
      computeCalls += 1
      await new Promise((resolve) => setTimeout(resolve, 30))
      return 42
    }

    const [a, b, c] = await Promise.all([
      cache.getOrSet('answer', compute),
      cache.getOrSet('answer', compute),
      cache.getOrSet('answer', compute),
    ])

    expect(a).toBe(42)
    expect(b).toBe(42)
    expect(c).toBe(42)
    expect(computeCalls).toBe(1)
  })

  it('falls back to stale data when refresh fails', async () => {
    vi.useFakeTimers()

    const cache = new TtlCache<string, number>(1_000, 5_000)
    cache.set('count', 9)
    vi.advanceTimersByTime(1_200)

    const value = await cache.getOrSetWithStaleFallback('count', async () => {
      throw new Error('upstream failed')
    })

    expect(value).toBe(9)
    vi.useRealTimers()
  })
})
