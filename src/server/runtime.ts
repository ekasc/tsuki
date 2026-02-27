import { HttpError } from './errors'

const DISABLED_VALUES = new Set(['0', 'false', 'no', 'off'])

export function isLocalLibraryEnabled(): boolean {
  const raw = process.env.TSUKI_LOCAL_LIBRARY_ENABLED?.trim().toLowerCase()
  if (!raw) {
    return true
  }

  return !DISABLED_VALUES.has(raw)
}

export function assertLocalLibraryEnabled(): void {
  if (isLocalLibraryEnabled()) {
    return
  }

  throw new HttpError(
    503,
    'Local library uploads are disabled in this deployment.',
  )
}
