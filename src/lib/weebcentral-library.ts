import type { RemoteProvider } from './remote-provider'
import type { SavedSeriesSummary } from './contracts'

export type { SavedSeriesSummary }

const STORAGE_KEY_V2 = 'tsuki-weebcentral-library.v2'
const STORAGE_KEY_V1 = 'tsuki-weebcentral-library.v1'
const LEGACY_STORAGE_KEY = 'suki-weebcentral-library.v1'

function readLibraryRaw(): string | null {
  const v2 = window.localStorage.getItem(STORAGE_KEY_V2)
  if (v2) {
    return v2
  }

  const v1 = window.localStorage.getItem(STORAGE_KEY_V1)
  if (v1) {
    return v1
  }

  const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY)
  if (legacy) {
    return legacy
  }

  return null
}

function migrateToV2(raw: string): SavedSeriesSummary[] {
  const parsed = JSON.parse(raw)
  if (!Array.isArray(parsed)) {
    return []
  }

  const savedAt = Date.now()

  const mapped: Array<SavedSeriesSummary | null> = parsed
    .map((entry: Record<string, unknown>) => {
      if (typeof entry?.id !== 'string') {
        return null
      }

      const chapters = entry.chapters
      const chapterCount = Array.isArray(chapters) ? chapters.length : 0

      return {
        id: entry.id as string,
        title: (entry.title as string) || 'Untitled',
        coverUrl: (entry.coverUrl as string | undefined) || undefined,
        author: (entry.author as string | undefined) || undefined,
        description: (entry.description as string | undefined) || undefined,
        chapterCount,
        provider: ((entry.provider as string) || 'weebcentral') as RemoteProvider,
        savedAt,
      }
    })

  const summaries: SavedSeriesSummary[] = mapped.filter(
    (entry): entry is SavedSeriesSummary => entry !== null,
  )

  window.localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(summaries))
  return summaries
}

export function loadSavedWeebcentralSeries(): SavedSeriesSummary[] {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const raw = readLibraryRaw()
    if (!raw) {
      return []
    }

    const v2 = window.localStorage.getItem(STORAGE_KEY_V2)
    if (v2) {
      const parsed = JSON.parse(v2) as SavedSeriesSummary[]
      return Array.isArray(parsed)
        ? parsed.filter((series) => typeof series?.id === 'string')
        : []
    }

    return migrateToV2(raw)
  } catch {
    return []
  }
}

export function upsertSavedWeebcentralSeries(series: SavedSeriesSummary) {
  if (typeof window === 'undefined') {
    return
  }

  const next = [
    series,
    ...loadSavedWeebcentralSeries().filter((entry) => entry.id !== series.id),
  ]
  window.localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(next))
}

export function removeSavedWeebcentralSeries(seriesId: string) {
  if (typeof window === 'undefined') {
    return
  }

  const next = loadSavedWeebcentralSeries().filter(
    (entry) => entry.id !== seriesId,
  )
  window.localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(next))
}
