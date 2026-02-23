import type { WeebcentralSeriesDTO } from './contracts'

const STORAGE_KEY = 'tsuki-weebcentral-library.v1'
const LEGACY_STORAGE_KEY = 'suki-weebcentral-library.v1'

function readLibraryRaw(): string | null {
  const nextValue = window.localStorage.getItem(STORAGE_KEY)
  if (nextValue) {
    return nextValue
  }

  const legacyValue = window.localStorage.getItem(LEGACY_STORAGE_KEY)
  if (!legacyValue) {
    return null
  }

  window.localStorage.setItem(STORAGE_KEY, legacyValue)
  return legacyValue
}

export function loadSavedWeebcentralSeries(): WeebcentralSeriesDTO[] {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const raw = readLibraryRaw()
    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw) as WeebcentralSeriesDTO[]
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter((series) => typeof series?.id === 'string')
  } catch {
    return []
  }
}

export function upsertSavedWeebcentralSeries(series: WeebcentralSeriesDTO) {
  if (typeof window === 'undefined') {
    return
  }

  const next = [
    series,
    ...loadSavedWeebcentralSeries().filter((entry) => entry.id !== series.id),
  ]
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next.slice(0, 25)))
}

export function removeSavedWeebcentralSeries(seriesId: string) {
  if (typeof window === 'undefined') {
    return
  }

  const next = loadSavedWeebcentralSeries().filter(
    (entry) => entry.id !== seriesId,
  )
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
}
