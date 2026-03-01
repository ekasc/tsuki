import {
  assertLocalLibraryAvailable,
  resolveLocalLibraryDriver,
} from './runtime-driver'

export { assertLocalLibraryAvailable }

export function isLocalLibraryEnabled(): boolean {
  return resolveLocalLibraryDriver() !== 'disabled'
}

export function assertLocalLibraryEnabled(): void {
  assertLocalLibraryAvailable()
}
