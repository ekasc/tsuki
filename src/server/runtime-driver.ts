import { HttpError } from './errors'

export type LocalLibraryDriver = 'disabled' | 'fixtures' | 'node'

const DISABLED_VALUES = new Set(['0', 'false', 'no', 'off'])
const ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on'])

function normalize(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? ''
}

function parseDriver(value: string | undefined): LocalLibraryDriver | null {
  const normalized = normalize(value)

  if (!normalized) {
    return null
  }

  if (
    normalized !== 'disabled' &&
    normalized !== 'fixtures' &&
    normalized !== 'node'
  ) {
    return 'disabled'
  }

  return normalized
}

function hasFixtureFlag(): boolean {
  const normalized = normalize(process.env.TSUKI_TEST_FIXTURES)

  if (!normalized) {
    return false
  }

  if (DISABLED_VALUES.has(normalized)) {
    return false
  }

  return ENABLED_VALUES.has(normalized) || normalized === '1'
}

function isLegacyLocalLibraryDisabled(): boolean {
  const normalized = normalize(process.env.TSUKI_LOCAL_LIBRARY_ENABLED)
  if (!normalized) {
    return false
  }

  return DISABLED_VALUES.has(normalized)
}

export function resolveLocalLibraryDriver(): LocalLibraryDriver {
  const explicitDriver = parseDriver(process.env.TSUKI_LOCAL_LIBRARY_DRIVER)
  if (explicitDriver) {
    return explicitDriver
  }

  if (hasFixtureFlag()) {
    return 'fixtures'
  }

  if (isLegacyLocalLibraryDisabled()) {
    return 'disabled'
  }

  return 'node'
}

export function assertLocalLibraryAvailable(): void {
  if (resolveLocalLibraryDriver() !== 'disabled') {
    return
  }

  throw new HttpError(
    503,
    'Local library APIs are disabled in this deployment.',
  )
}

export function assertNodeLocalLibraryDriver(
  message = 'Local library uploads are disabled in this deployment.',
): void {
  if (resolveLocalLibraryDriver() === 'node') {
    return
  }

  throw new HttpError(503, message)
}
