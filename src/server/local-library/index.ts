import type { LocalLibraryDriver } from '#/server/runtime-driver'
import { resolveLocalLibraryDriver } from '#/server/runtime-driver'

import type { LocalLibraryProvider } from './provider'

let cachedDriver: LocalLibraryDriver | null = null
let cachedProvider: LocalLibraryProvider | null = null
let loadingPromise: Promise<LocalLibraryProvider> | null = null

async function loadProviderForDriver(
  driver: LocalLibraryDriver,
): Promise<LocalLibraryProvider> {
  if (driver === 'disabled') {
    const { disabledLocalLibraryProvider } = await import(
      './providers/disabled-provider'
    )
    return disabledLocalLibraryProvider
  }

  if (driver === 'fixtures') {
    const { fixtureLocalLibraryProvider } = await import(
      './providers/fixture-provider'
    )
    return fixtureLocalLibraryProvider
  }

  const { nodeLocalLibraryProvider } = await import('./providers/node-provider')
  return nodeLocalLibraryProvider
}

export async function getLocalLibraryProvider(): Promise<LocalLibraryProvider> {
  const driver = resolveLocalLibraryDriver()

  if (cachedProvider && cachedDriver === driver) {
    return cachedProvider
  }

  if (loadingPromise && cachedDriver === driver) {
    return loadingPromise
  }

  cachedDriver = driver
  loadingPromise = loadProviderForDriver(driver)

  try {
    cachedProvider = await loadingPromise
    return cachedProvider
  } finally {
    loadingPromise = null
  }
}
