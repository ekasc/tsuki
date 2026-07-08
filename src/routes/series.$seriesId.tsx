import { createFileRoute, Link } from '@tanstack/react-router'
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  List,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'

import { useCallback, useEffect, useMemo, useState } from 'react'

import { Button } from '#/components/ui/button'
import { FadeImage } from '#/components/ui/fade-image'
import { Input } from '#/components/ui/input'
import type { ReadingHistoryItem, SeriesDetail } from '#/lib/contracts'
import { resolveApiUrl } from '#/lib/http-client'
import { isLocalSessionSeriesAllowed } from '#/lib/local-upload-session'
import { localSeriesQueryOptions } from '#/lib/query-options'
import type { AppRouterContext } from '#/lib/router-context'
import { loadReadingHistory, upsertReadingHistory } from '#/lib/reading-history'
import { cn } from '#/lib/utils'

const CHAPTERS_PER_PAGE = 50

const LOCAL_SERIES_LOADING_LINES = [
  'Opening your shelf…',
  'Stacking chapter cards…',
  'Indexing page turns…',
] as const

export const Route = createFileRoute('/series/$seriesId')({
  headers: () => ({
    'X-Robots-Tag': 'noindex, nofollow',
  }),
  head: () => ({
    meta: [
      { title: 'Tsuki reader' },
      { name: 'robots', content: 'noindex,nofollow' },
    ],
  }),
  loader: async ({
    params,
    context,
  }: {
    params: { seriesId: string }
    context: AppRouterContext
  }) => {
    if (typeof window === 'undefined') {
      return null
    }

    return context.queryClient.ensureQueryData(
      localSeriesQueryOptions(params.seriesId),
    )
  },
  staleTime: 120_000,
  preloadStaleTime: 240_000,
  gcTime: 15 * 60_000,
  component: SeriesPage,
})

function SeriesPage() {
  const chapterSearchInputId = 'local-series-chapter-search'
  const params = Route.useParams()
  const loaderSeries = Route.useLoaderData() as SeriesDetail | undefined
  const queryClient = useQueryClient()
  const isSeriesAllowed =
    typeof window === 'undefined'
      ? true
      : isLocalSessionSeriesAllowed(params.seriesId)

  const [series, setSeries] = useState<SeriesDetail | null>(
    () => loaderSeries ?? null,
  )
  const [isLoading, setIsLoading] = useState(() => !loaderSeries)
  const [error, setError] = useState<string | null>(null)
  const [historyByChapterId, setHistoryByChapterId] = useState<
    Record<string, ReadingHistoryItem>
  >(() => ({}))
  const [latestHistoryEntry, setLatestHistoryEntry] =
    useState<ReadingHistoryItem | null>(null)
  const [chapterOrder, setChapterOrder] = useState<'oldest' | 'newest'>(
    'oldest',
  )
  const [chapterView, setChapterView] = useState<'list' | 'grid'>('list')
  const [chapterQuery, setChapterQuery] = useState('')
  const [chapterPage, setChapterPage] = useState(1)
  const [previewCoverPageIndex, setPreviewCoverPageIndex] = useState(0)
  const [loadingLineIndex, setLoadingLineIndex] = useState(0)
  const [descriptionExpanded, setDescriptionExpanded] = useState(false)

  const loadSeries = useCallback(async () => {
    if (!isSeriesAllowed) {
      setIsLoading(false)
      setError('This upload session has expired. Please upload the file again.')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const payload = await queryClient.ensureQueryData(
        localSeriesQueryOptions(params.seriesId),
      )
      setSeries(payload)
    } catch (requestError) {
      void requestError
      setError('Could not open this series right now.')
    } finally {
      setIsLoading(false)
    }
  }, [isSeriesAllowed, params.seriesId, queryClient])

  useEffect(() => {
    if (loaderSeries) {
      setSeries(loaderSeries)
      setIsLoading(false)
      setError(null)
      return
    }

    void loadSeries()
  }, [loadSeries, loaderSeries])

  useEffect(() => {
    const history = loadReadingHistory().filter(
      (item) =>
        item.readerRoute !== 'weebcentral' && item.seriesId === params.seriesId,
    )

    const latestByChapter = history.reduce<Record<string, ReadingHistoryItem>>(
      (acc, item) => {
        if (!acc[item.chapterId]) {
          acc[item.chapterId] = item
        }
        return acc
      },
      {},
    )

    setHistoryByChapterId(latestByChapter)
    setLatestHistoryEntry(history[0] ?? null)
    if (history.length > 0) {
      setChapterOrder('newest')
    }
  }, [params.seriesId])

  useEffect(() => {
    setChapterPage(1)
  }, [chapterQuery, chapterOrder])

  const ascendingChapters = useMemo(() => {
    return [...(series?.chapters ?? [])].sort((left, right) => {
      if (left.chapterNumber !== right.chapterNumber) {
        return left.chapterNumber - right.chapterNumber
      }

      return left.sortIndex - right.sortIndex
    })
  }, [series?.chapters])

  const sortedChapters = useMemo(() => {
    const base = ascendingChapters

    return chapterOrder === 'newest' ? [...base].reverse() : base
  }, [ascendingChapters, chapterOrder])

  const completedChapters = useMemo(() => {
    return new Set(
      Object.values(historyByChapterId)
        .filter((item) => item.completed === true)
        .map((item) => item.chapterId),
    )
  }, [historyByChapterId])

  const nextChapter = useMemo(() => {
    const latestChapterId = latestHistoryEntry?.chapterId
    const latestChapter = latestChapterId
      ? (ascendingChapters.find((chapter) => chapter.id === latestChapterId) ??
        null)
      : null
    const firstUnread =
      ascendingChapters.find((chapter) => !completedChapters.has(chapter.id)) ??
      null

    if (latestHistoryEntry && latestHistoryEntry.completed !== true) {
      return latestChapter ?? firstUnread ?? ascendingChapters[0] ?? null
    }

    return firstUnread ?? latestChapter ?? ascendingChapters[0] ?? null
  }, [ascendingChapters, completedChapters, latestHistoryEntry])

  const filteredChapters = useMemo(() => {
    const query = chapterQuery.trim().toLowerCase()
    if (!query) {
      return sortedChapters
    }

    return sortedChapters.filter((chapter) => {
      const chapterNumber = String(chapter.chapterNumber)
      return (
        chapter.title.toLowerCase().includes(query) ||
        chapterNumber.includes(query)
      )
    })
  }, [chapterQuery, sortedChapters])
  const totalPages = Math.max(
    1,
    Math.ceil(filteredChapters.length / CHAPTERS_PER_PAGE),
  )
  const paginatedChapters = useMemo(() => {
    const start = (chapterPage - 1) * CHAPTERS_PER_PAGE
    return filteredChapters.slice(start, start + CHAPTERS_PER_PAGE)
  }, [filteredChapters, chapterPage])
  const completedCount = sortedChapters.filter((chapter) =>
    completedChapters.has(chapter.id),
  ).length
  const previewCoverChapterId = sortedChapters[0]?.id ?? null

  const formatChapterLabel = useCallback(
    (chapterNumber: number, title: string) => {
      const cleanedTitle = title
        .replace(/^chapter\s*\d+(?:\.\d+)?\s*[:\-]?\s*/i, '')
        .trim()

      if (!cleanedTitle) {
        return `Chapter ${chapterNumber}`
      }

      return `Chapter ${chapterNumber} · ${cleanedTitle}`
    },
    [],
  )

  const latestHistoryLabel = useMemo(() => {
    if (!latestHistoryEntry) {
      return null
    }

    const chapterMeta = ascendingChapters.find(
      (chapter) => chapter.id === latestHistoryEntry.chapterId,
    )
    const chapterLabel = chapterMeta
      ? formatChapterLabel(chapterMeta.chapterNumber, chapterMeta.title)
      : latestHistoryEntry.chapterTitle
    const pageLabel = `Page ${Math.max(1, latestHistoryEntry.pageIndex + 1)}`
    const completionLabel =
      latestHistoryEntry.completed === true ? 'Completed' : 'In progress'

    return `${chapterLabel} · ${pageLabel} · ${completionLabel}`
  }, [ascendingChapters, formatChapterLabel, latestHistoryEntry])

  const toggleChapterRead = useCallback(
    (chapterId: string, chapterTitle: string, chapterNumber: number) => {
      const existingHistory = historyByChapterId[chapterId]
      const nextCompleted = existingHistory?.completed !== true
      const nextUpdatedAt = Date.now()

      upsertReadingHistory({
        chapterId,
        seriesId: params.seriesId,
        chapterTitle: formatChapterLabel(chapterNumber, chapterTitle),
        pageIndex: existingHistory?.pageIndex ?? 0,
        mode: existingHistory?.mode ?? 'single',
        readerRoute: 'local',
        completed: nextCompleted,
        updatedAt: nextUpdatedAt,
      })

      const nextItem: ReadingHistoryItem = {
        chapterId,
        seriesId: params.seriesId,
        chapterTitle: formatChapterLabel(chapterNumber, chapterTitle),
        pageIndex: existingHistory?.pageIndex ?? 0,
        mode: existingHistory?.mode ?? 'single',
        readerRoute: 'local',
        completed: nextCompleted,
        updatedAt: nextUpdatedAt,
      }

      setHistoryByChapterId((current) => ({
        ...current,
        [chapterId]: nextItem,
      }))
      setLatestHistoryEntry(nextItem)
    },
    [formatChapterLabel, historyByChapterId, params.seriesId],
  )

  useEffect(() => {
    setPreviewCoverPageIndex(0)
  }, [previewCoverChapterId])

  useEffect(() => {
    if (!isLoading) {
      setLoadingLineIndex(0)
      return
    }

    const timer = window.setInterval(() => {
      setLoadingLineIndex(
        (current) => (current + 1) % LOCAL_SERIES_LOADING_LINES.length,
      )
    }, 900)

    return () => {
      window.clearInterval(timer)
    }
  }, [isLoading])

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if (
        event.key !== '/' ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.repeat
      ) {
        return
      }

      const target = event.target
      if (target instanceof HTMLElement) {
        const tag = target.tagName
        if (
          target.isContentEditable ||
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT'
        ) {
          return
        }
      }

      const input = document.getElementById(
        chapterSearchInputId,
      ) as HTMLInputElement | null
      if (!input) {
        return
      }

      event.preventDefault()
      input.focus()
      input.select()
    }

    window.addEventListener('keydown', onShortcut)
    return () => {
      window.removeEventListener('keydown', onShortcut)
    }
  }, [chapterSearchInputId])

  return (
    <div className="space-y-5 pb-10">
      <section className="exp-hero">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex min-w-0 flex-col items-start gap-4 sm:flex-row">
            {previewCoverChapterId ? (
              <FadeImage
                src={resolveApiUrl(
                  `/api/image/${previewCoverChapterId}/${previewCoverPageIndex}?thumb=1`,
                )}
                alt={`${series?.title ?? 'Series'} cover`}
                className="cover-hover h-36 w-24 shrink-0 border border-border object-cover sm:h-32"
                loading="eager"
                fetchPriority="high"
                decoding="async"
                style={{ viewTransitionName: `cover-${params.seriesId}` }}
                onError={() => {
                  if (previewCoverPageIndex === 0) {
                    setPreviewCoverPageIndex(1)
                  }
                }}
              />
            ) : (
              <div
                className="flex h-36 w-24 shrink-0 items-center justify-center border border-border bg-surface-soft text-xs text-muted-foreground sm:h-32"
                style={{ viewTransitionName: `cover-${params.seriesId}` }}
              >
                No image
              </div>
            )}
            <div className="max-w-3xl min-w-0">
              <Link to="/" className="exp-back-link">
                ← Home
              </Link>
              <div className="mt-3">
                <span className="issue-label">From your files</span>
              </div>

              {series ? (
                <>
                  <h1 className="manga-title mt-4 text-3xl font-bold tracking-tight text-foreground md:text-4xl">
                    {series.title}
                  </h1>
                  {series.description ? (
                    <>
                      <p
                        className={cn(
                          'mt-2 text-sm leading-6 text-muted-foreground',
                          !descriptionExpanded && 'truncate',
                        )}
                      >
                        {series.description}
                      </p>
                      <button
                        type="button"
                        onClick={() => setDescriptionExpanded((v) => !v)}
                        className="mt-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                      >
                        {descriptionExpanded ? 'Show less' : 'Show more'}
                      </button>
                    </>
                  ) : (
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      No summary yet.
                    </p>
                  )}
                  <div className="mt-4 flex gap-2">
                    <span className="manga-stamp">
                      {sortedChapters.length} chapters
                    </span>
                    <span className="manga-stamp">
                      {completedCount} completed
                    </span>
                    <span className="manga-stamp">Source: {series.source}</span>
                  </div>
                  {latestHistoryLabel ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Last read: {latestHistoryLabel}
                    </p>
                  ) : null}
                  <p className="delight-tip mt-2 text-xs text-muted-foreground">
                    Tip: press <kbd className="delight-kbd">/</kbd> to focus
                    chapter search.
                  </p>
                </>
              ) : null}
            </div>
          </div>

          {nextChapter ? (
            <Link
              to="/reader/$chapterId"
              params={{ chapterId: nextChapter.id }}
              className="delight-cta inline-flex h-10 w-full items-center justify-center bg-koten px-4 text-sm font-semibold text-[var(--active-contrast)] sm:w-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-koten"
            >
              Continue reading
            </Link>
          ) : null}
        </div>
      </section>

      {isLoading ? (
        <section
          className="text-sm text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          <p className="delight-loading-note">
            {LOCAL_SERIES_LOADING_LINES[loadingLineIndex]}
          </p>
        </section>
      ) : null}

      {error ? (
        <section className="text-sm text-destructive">
          We could not open this series right now. Please go back and try again.
        </section>
      ) : null}

      <div className="manga-divider" aria-hidden />

      {!isLoading && series ? (
        <section className="space-y-2">
          <div className="exp-filter-toolbar">
            <div className="exp-toolbar-copy">
              <span className="issue-label">Chapters</span>
              <p className="text-sm text-foreground">
                Filter, sort, or switch views.
              </p>
              <p className="text-xs">Search by chapter number or title.</p>
            </div>
            <div className="exp-filter-actions">
              <Button
                type="button"
                variant={chapterView === 'grid' ? 'default' : 'soft'}
                size="icon"
                className="size-9"
                onClick={() => setChapterView('grid')}
                title="Grid view"
                aria-label="Grid view"
              >
                <LayoutGrid className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant={chapterView === 'list' ? 'default' : 'soft'}
                size="icon"
                className="size-9"
                onClick={() => setChapterView('list')}
                title="List view"
                aria-label="List view"
              >
                <List className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant={chapterOrder === 'oldest' ? 'default' : 'soft'}
                size="icon"
                className="size-9"
                onClick={() => setChapterOrder('oldest')}
                title="Oldest first"
                aria-label="Oldest first"
              >
                <ArrowUpNarrowWide className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant={chapterOrder === 'newest' ? 'default' : 'soft'}
                size="icon"
                className="size-9"
                onClick={() => setChapterOrder('newest')}
                title="Newest first"
                aria-label="Newest first"
              >
                <ArrowDownWideNarrow className="size-3.5" />
              </Button>
              <Input
                id={chapterSearchInputId}
                value={chapterQuery}
                onChange={(event) => setChapterQuery(event.target.value)}
                className="h-8 w-full sm:w-[18rem]"
                placeholder="Filter by chapter number or title"
              />
            </div>
          </div>
          <div
            className={
              chapterView === 'grid'
                ? 'grid gap-2 sm:grid-cols-2 lg:grid-cols-3'
                : 'space-y-1.5'
            }
          >
            {paginatedChapters.map((chapter) => {
              const completed = completedChapters.has(chapter.id)

              if (chapterView === 'grid') {
                return (
                  <article
                    key={chapter.id}
                    className={cn(
                      'exp-row h-full flex-col items-start gap-2 p-3 transition-opacity',
                      completed ? 'opacity-65' : '',
                    )}
                  >
                    <div className="flex w-full min-w-0 items-center gap-3">
                      <button
                        type="button"
                        className="chapter-toggle"
                        data-complete={completed ? 'true' : 'false'}
                        onClick={() =>
                          toggleChapterRead(
                            chapter.id,
                            chapter.title,
                            chapter.chapterNumber,
                          )
                        }
                        aria-label={completed ? 'Mark unread' : 'Mark read'}
                        aria-pressed={completed}
                      >
                        ✓
                      </button>
                      <Link
                        to="/reader/$chapterId"
                        params={{ chapterId: chapter.id }}
                        className="min-w-0 flex-1"
                      >
                        <h3
                          className={cn(
                            'truncate text-sm font-semibold md:text-base',
                            completed
                              ? 'text-muted-foreground'
                              : 'text-foreground',
                          )}
                        >
                          {formatChapterLabel(
                            chapter.chapterNumber,
                            chapter.title,
                          )}
                        </h3>
                      </Link>
                    </div>
                  </article>
                )
              }

              return (
                <article
                  key={chapter.id}
                  className={cn(
                    'exp-row transition-opacity',
                    completed ? 'opacity-65' : '',
                  )}
                >
                  <button
                    type="button"
                    className="chapter-toggle"
                    data-complete={completed ? 'true' : 'false'}
                    onClick={() =>
                      toggleChapterRead(
                        chapter.id,
                        chapter.title,
                        chapter.chapterNumber,
                      )
                    }
                    aria-label={completed ? 'Mark unread' : 'Mark read'}
                    aria-pressed={completed}
                  >
                    ✓
                  </button>
                  <Link
                    to="/reader/$chapterId"
                    params={{ chapterId: chapter.id }}
                    className="flex min-w-0 flex-1 items-center"
                  >
                    <div className="min-w-0">
                      <h3
                        className={cn(
                          'truncate text-sm font-semibold md:text-base',
                          completed
                            ? 'text-muted-foreground'
                            : 'text-foreground',
                        )}
                      >
                        {formatChapterLabel(
                          chapter.chapterNumber,
                          chapter.title,
                        )}
                      </h3>
                    </div>
                  </Link>
                </article>
              )
            })}
          </div>
          {filteredChapters.length > CHAPTERS_PER_PAGE && (
            <div className="flex items-center justify-center gap-3 pt-4">
              <Button
                variant="outline"
                size="sm"
                disabled={chapterPage <= 1}
                onClick={() => setChapterPage((p) => p - 1)}
              >
                <ChevronLeft className="size-4" />
                Prev
              </Button>
              <span className="text-xs text-muted-foreground tabular-nums">
                {chapterPage} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={chapterPage >= totalPages}
                onClick={() => setChapterPage((p) => p + 1)}
              >
                Next
                <ChevronRight className="size-4" />
              </Button>
            </div>
          )}
          {filteredChapters.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {chapterQuery.trim().length > 0
                ? `No chapters matched "${chapterQuery.trim()}". Try a chapter number or a shorter title.`
                : 'No chapters available yet.'}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
