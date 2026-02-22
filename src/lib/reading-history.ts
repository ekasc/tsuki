import type { ReaderMode, ReadingHistoryItem } from './contracts'

const HISTORY_STORAGE_KEY = 'suki-reading-history.v1'
const MAX_HISTORY_ITEMS = 15

export function loadReadingHistory(): ReadingHistoryItem[] {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY)

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
  updatedAt?: number
}) {
  if (typeof window === 'undefined') {
    return
  }

  const updatedAt = input.updatedAt ?? Date.now()
  const existing = loadReadingHistory().filter(
    (item) => item.chapterId !== input.chapterId,
  )

  const next: ReadingHistoryItem[] = [
    {
      chapterId: input.chapterId,
      seriesId: input.seriesId,
      seriesTitle: input.seriesTitle,
      chapterTitle: input.chapterTitle,
      pageIndex: input.pageIndex,
      mode: input.mode,
      readerRoute: input.readerRoute ?? 'local',
      updatedAt,
    },
    ...existing,
  ].slice(0, MAX_HISTORY_ITEMS)

  window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(next))
}
