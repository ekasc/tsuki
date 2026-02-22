interface CacheEntry<T> {
  value: T
  expiresAt: number
}

export class TtlCache<K, V> {
  private readonly entries = new Map<K, CacheEntry<V>>()

  constructor(private readonly defaultTtlMs: number) {}

  get(key: K): V | null {
    const entry = this.entries.get(key)

    if (!entry) {
      return null
    }

    if (Date.now() >= entry.expiresAt) {
      this.entries.delete(key)
      return null
    }

    return entry.value
  }

  set(key: K, value: V, ttlMs = this.defaultTtlMs): void {
    this.entries.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    })
  }

  delete(key: K): void {
    this.entries.delete(key)
  }

  clear(): void {
    this.entries.clear()
  }

  pruneExpired(): void {
    const now = Date.now()

    for (const [key, entry] of this.entries.entries()) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key)
      }
    }
  }

  async getOrSet(
    key: K,
    compute: () => Promise<V>,
    ttlMs = this.defaultTtlMs,
  ): Promise<V> {
    const cached = this.get(key)

    if (cached !== null) {
      return cached
    }

    const value = await compute()
    this.set(key, value, ttlMs)
    return value
  }
}
