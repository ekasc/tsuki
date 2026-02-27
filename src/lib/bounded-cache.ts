export function setBoundedMapEntry<K, V>(
  map: Map<K, V>,
  key: K,
  value: V,
  maxEntries: number,
): void {
  if (maxEntries <= 0) {
    return
  }

  if (map.has(key)) {
    map.delete(key)
  }
  map.set(key, value)

  while (map.size > maxEntries) {
    const oldestKey = map.keys().next().value as K | undefined
    if (oldestKey === undefined) {
      break
    }
    map.delete(oldestKey)
  }
}

export function addBoundedSetEntry<T>(
  set: Set<T>,
  value: T,
  maxEntries: number,
): void {
  if (maxEntries <= 0) {
    return
  }

  if (set.has(value)) {
    set.delete(value)
  }
  set.add(value)

  while (set.size > maxEntries) {
    const oldestValue = set.values().next().value as T | undefined
    if (oldestValue === undefined) {
      break
    }
    set.delete(oldestValue)
  }
}
