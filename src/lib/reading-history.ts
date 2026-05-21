import type { ReaderMode, ReadingHistoryItem } from './contracts'

const HISTORY_STORAGE_KEY = 'tsuki-reading-history.v1'
const LEGACY_HISTORY_STORAGE_KEY = 'suki-reading-history.v1'
const MAX_HISTORY_ITEMS = 500

function readHistoryRaw(): string | null {
  const nextValue = window.localStorage.getItem(HISTORY_STORAGE_KEY)
  if (nextValue) {
    return nextValue
  }

  const legacyValue = window.localStorage.getItem(LEGACY_HISTORY_STORAGE_KEY)
  if (!legacyValue) {
    return null
  }

  window.localStorage.setItem(HISTORY_STORAGE_KEY, legacyValue)
  return legacyValue
}

export function loadReadingHistory(): ReadingHistoryItem[] {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const raw = readHistoryRaw()

    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw) as ReadingHistoryItem[]

    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed
      .filter((item) => typeof item.chapterId === 'string')
      .map((item) => ({
        ...item,
        readerRoute:
          item.readerRoute === 'weebcentral'
            ? ('weebcentral' as const)
            : ('local' as const),
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  } catch {
    return []
  }
}

export function upsertReadingHistory(input: {
  chapterId: string
  seriesId: string
  seriesTitle?: string
  chapterTitle: string
  pageIndex: number
  mode: ReaderMode
  readerRoute?: 'local' | 'weebcentral'
  completed?: boolean
  updatedAt?: number
}) {
  if (typeof window === 'undefined') {
    return
  }

  const updatedAt = input.updatedAt ?? Date.now()
  const nextReaderRoute = input.readerRoute ?? 'local'
  const existing = loadReadingHistory().filter(
    (item) =>
      item.chapterId !== input.chapterId ||
      item.readerRoute !== nextReaderRoute,
  )

  const next: ReadingHistoryItem[] = [
    {
      chapterId: input.chapterId,
      seriesId: input.seriesId,
      seriesTitle: input.seriesTitle,
      chapterTitle: input.chapterTitle,
      pageIndex: input.pageIndex,
      mode: input.mode,
      readerRoute: nextReaderRoute,
      completed: Boolean(input.completed),
      updatedAt,
    },
    ...existing,
  ].slice(0, MAX_HISTORY_ITEMS)

  window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(next))
}

export function clearReadingHistoryForSeries(input: {
  seriesId: string
  readerRoute?: 'local' | 'weebcentral'
}) {
  if (typeof window === 'undefined') {
    return
  }

  const next = loadReadingHistory().filter((item) => {
    if (item.seriesId !== input.seriesId) {
      return true
    }

    if (!input.readerRoute) {
      return false
    }

    return item.readerRoute !== input.readerRoute
  })

  window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(next))
}
