interface CacheEntry<T> {
  value: T
  freshUntil: number
  staleUntil: number
}

export class TtlCache<K, V> {
  private readonly entries = new Map<K, CacheEntry<V>>()
  private readonly inFlight = new Map<K, Promise<V>>()

  constructor(
    private readonly defaultTtlMs: number,
    private readonly defaultStaleTtlMs = 0,
  ) {}

  get(key: K): V | null {
    const entry = this.entries.get(key)

    if (!entry) {
      return null
    }

    const now = Date.now()

    if (now < entry.freshUntil) {
      return entry.value
    }

    if (now >= entry.staleUntil) {
      this.entries.delete(key)
      return null
    }

    return null
  }

  getStale(key: K): V | null {
    const entry = this.entries.get(key)

    if (!entry) {
      return null
    }

    const now = Date.now()
    if (now < entry.freshUntil) {
      return entry.value
    }

    if (now >= entry.staleUntil) {
      this.entries.delete(key)
      return null
    }

    return entry.value
  }

  set(
    key: K,
    value: V,
    ttlMs = this.defaultTtlMs,
    staleTtlMs = this.defaultStaleTtlMs,
  ): void {
    const now = Date.now()
    const safeTtlMs = Math.max(0, ttlMs)
    const safeStaleTtlMs = Math.max(0, staleTtlMs)

    this.entries.set(key, {
      value,
      freshUntil: now + safeTtlMs,
      staleUntil: now + safeTtlMs + safeStaleTtlMs,
    })
  }

  delete(key: K): void {
    this.entries.delete(key)
    this.inFlight.delete(key)
  }

  clear(): void {
    this.entries.clear()
    this.inFlight.clear()
  }

  pruneExpired(): void {
    const now = Date.now()

    for (const [key, entry] of this.entries.entries()) {
      if (entry.staleUntil <= now) {
        this.entries.delete(key)
      }
    }
  }

  async getOrSet(
    key: K,
    compute: () => Promise<V>,
    ttlMs = this.defaultTtlMs,
    staleTtlMs = this.defaultStaleTtlMs,
  ): Promise<V> {
    const cached = this.get(key)

    if (cached !== null) {
      return cached
    }

    const existingInFlight = this.inFlight.get(key)
    if (existingInFlight) {
      return existingInFlight
    }

    const promise = (async () => {
      const value = await compute()
      this.set(key, value, ttlMs, staleTtlMs)
      return value
    })()

    this.inFlight.set(key, promise)

    try {
      return await promise
    } finally {
      this.inFlight.delete(key)
    }
  }

  async getOrSetWithStaleFallback(
    key: K,
    compute: () => Promise<V>,
    ttlMs = this.defaultTtlMs,
    staleTtlMs = this.defaultStaleTtlMs,
  ): Promise<V> {
    const stale = this.getStale(key)

    try {
      return await this.getOrSet(key, compute, ttlMs, staleTtlMs)
    } catch (error) {
      if (stale !== null) {
        return stale
      }

      throw error
    }
  }
}
