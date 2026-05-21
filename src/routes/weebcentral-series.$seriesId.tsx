import { Link, createFileRoute } from '@tanstack/react-router'
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  ChevronLeft,
  ChevronRight,
  History,
  LayoutGrid,
  List,
  Plus,
  RefreshCcw,
  X,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { Button } from '#/components/ui/button'
import { FadeImage } from '#/components/ui/fade-image'
import { Input } from '#/components/ui/input'
import type {
  ReadingHistoryItem,
  SavedSeriesSummary,
  WeebcentralSeriesDTO,
} from '#/lib/contracts'
import { weebcentralSeriesQueryOptions } from '#/lib/query-options'
import {
  buildRemoteSeriesSourceUrl,
  detectRemoteProviderFromSeriesId,
  remoteProviderLabel,
} from '#/lib/remote-provider'
import type { AppRouterContext } from '#/lib/router-context'
import {
  clearReadingHistoryForSeries,
  loadReadingHistory,
  upsertReadingHistory,
} from '#/lib/reading-history'
import {
  absoluteUrl,
  canonicalUrl,
  DEFAULT_OG_IMAGE_PATH,
  truncateDescription,
} from '#/lib/seo'
import { cn } from '#/lib/utils'
import {
  loadSavedWeebcentralSeries,
  removeSavedWeebcentralSeries,
  upsertSavedWeebcentralSeries,
} from '#/lib/weebcentral-library'

const CHAPTERS_PER_PAGE = 50

const REMOTE_SERIES_LOADING_LINES = [
  'Fetching chapter map…',
  'Polishing cover details…',
  'Preparing your reading queue…',
] as const

export const Route = createFileRoute('/weebcentral-series/$seriesId')({
  head: ({
    params,
    loaderData,
  }: {
    params: { seriesId: string }
    loaderData?: WeebcentralSeriesDTO | null
  }) => {
    const title = 'Tsuki reader'
    const description = truncateDescription(
      loaderData?.description?.trim() ||
        'Browse chapters and continue reading with Tsuki Reader.',
    )
    const canonical = canonicalUrl(
      `/weebcentral-series/${encodeURIComponent(params.seriesId)}`,
    )
    const image = absoluteUrl(loaderData?.coverUrl || DEFAULT_OG_IMAGE_PATH)

    return {
      meta: [
        { title },
        { name: 'description', content: description },
        { property: 'og:type', content: 'website' },
        { property: 'og:title', content: title },
        { property: 'og:description', content: description },
        { property: 'og:url', content: canonical },
        { property: 'og:image', content: image },
        { property: 'og:image:alt', content: 'Series cover image' },
        { name: 'twitter:title', content: title },
        { name: 'twitter:description', content: description },
        { name: 'twitter:image', content: image },
      ],
      links: [{ rel: 'canonical', href: canonical }],
    }
  },
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
      weebcentralSeriesQueryOptions(params.seriesId),
    )
  },
  staleTime: 45_000,
  preloadStaleTime: 120_000,
  gcTime: 15 * 60_000,
  component: WeebcentralSeriesPage,
})

function WeebcentralSeriesPage() {
  const chapterSearchInputId = 'remote-series-chapter-search'
  const { seriesId } = Route.useParams()
  const loaderSeries = Route.useLoaderData() as WeebcentralSeriesDTO | undefined
  const queryClient = useQueryClient()
  const [series, setSeries] = useState<WeebcentralSeriesDTO | null>(
    () => loaderSeries ?? null,
  )
  const [isLoading, setIsLoading] = useState(() => !loaderSeries)
  const [error, setError] = useState<string | null>(null)
  const [historyByChapterId, setHistoryByChapterId] = useState<
    Record<string, ReadingHistoryItem>
  >(() => ({}))
  const [latestHistoryEntry, setLatestHistoryEntry] =
    useState<ReadingHistoryItem | null>(null)
  const [chapterView, setChapterView] = useState<'list' | 'grid'>('list')
  const [chapterOrder, setChapterOrder] = useState<'oldest' | 'newest'>(
    'oldest',
  )
  const [chapterQuery, setChapterQuery] = useState('')
  const [chapterReadFilter, setChapterReadFilter] = useState<'all' | 'read' | 'unread'>('all')
  const [chapterPage, setChapterPage] = useState(1)
  const [isSavedInLibrary, setIsSavedInLibrary] = useState(false)
  const [isSyncingMetadata, setIsSyncingMetadata] = useState(false)
  const [syncTimedOut, setSyncTimedOut] = useState(false)
  const [loadingLineIndex, setLoadingLineIndex] = useState(0)

  const loadSeries = useCallback(
    async (forceRefresh = false) => {
      setIsLoading(true)
      setError(null)

      try {
        const queryOptions = weebcentralSeriesQueryOptions(seriesId, {
          forceRefresh,
        })

        if (forceRefresh) {
          await queryClient.invalidateQueries({
            queryKey: queryOptions.queryKey,
          })
        }

        const payload = await queryClient.fetchQuery(queryOptions)
        setSeries(payload)
      } catch (requestError) {
        void requestError
        setError('Could not open this online series right now.')
      } finally {
        setIsLoading(false)
      }
    },
    [queryClient, seriesId],
  )

  useEffect(() => {
    if (loaderSeries) {
      setSeries(loaderSeries)
      setIsLoading(false)
      setError(null)
      return
    }

    void loadSeries()
  }, [loaderSeries, loadSeries])

  useEffect(() => {
    const history = loadReadingHistory().filter(
      (item) =>
        item.readerRoute === 'weebcentral' && item.seriesId === seriesId,
    )

    setHistoryByChapterId(
      history.reduce<Record<string, ReadingHistoryItem>>((acc, item) => {
        if (!acc[item.chapterId]) {
          acc[item.chapterId] = item
        }
        return acc
      }, {}),
    )
    setLatestHistoryEntry(history[0] ?? null)
  }, [seriesId])

  useEffect(() => {
    const saved = loadSavedWeebcentralSeries()
    setIsSavedInLibrary(saved.some((entry) => entry.id === seriesId))
  }, [seriesId])

  useEffect(() => {
    if (!isLoading) {
      setLoadingLineIndex(0)
      return
    }

    const timer = window.setInterval(() => {
      setLoadingLineIndex(
        (current) => (current + 1) % REMOTE_SERIES_LOADING_LINES.length,
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

  useEffect(() => {
    setChapterPage(1)
  }, [chapterQuery, chapterOrder, chapterReadFilter])

  const syncSeriesMetadata = useCallback(async () => {
    setSyncTimedOut(false)
    setError(null)
    setIsSyncingMetadata(true)

    let timeoutId: number | undefined

    try {
      const queryOptions = weebcentralSeriesQueryOptions(seriesId, {
        forceRefresh: true,
      })

      await queryClient.invalidateQueries({ queryKey: queryOptions.queryKey })

      const timeoutPromise = new Promise<{ type: 'timeout' }>((resolve) => {
        timeoutId = window.setTimeout(() => resolve({ type: 'timeout' }), 3_000)
      })
      const fetchPromise = queryClient.fetchQuery(queryOptions).then(
        (payload) => ({ type: 'payload' as const, payload }),
        (requestError) => ({ type: 'error' as const, requestError }),
      )
      const result = await Promise.race([fetchPromise, timeoutPromise])

      if (result.type === 'timeout') {
        setSyncTimedOut(true)
        return
      }

      if (result.type === 'error') {
        throw result.requestError
      }

      setSeries(result.payload)
      setSyncTimedOut(false)
    } catch (requestError) {
      void requestError
      setError('Could not sync metadata right now.')
    } finally {
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId)
      }
      setIsSyncingMetadata(false)
    }
  }, [queryClient, seriesId])

  const resetSeriesHistory = useCallback(() => {
    clearReadingHistoryForSeries({ seriesId, readerRoute: 'weebcentral' })
    setHistoryByChapterId({})
    setLatestHistoryEntry(null)
  }, [seriesId])

  const ascendingChapters = useMemo(
    () =>
      [...(series?.chapters ?? [])].sort(
        (left, right) => left.number - right.number,
      ),
    [series?.chapters],
  )
  const chapters = useMemo(
    () =>
      chapterOrder === 'newest'
        ? [...ascendingChapters].reverse()
        : ascendingChapters,
    [ascendingChapters, chapterOrder],
  )
  const chapterCount = useMemo(
    () => new Set(ascendingChapters.map((chapter) => chapter.id)).size,
    [ascendingChapters],
  )
  const sourceProvider = useMemo(
    () =>
      series?.provider ??
      detectRemoteProviderFromSeriesId(series?.id ?? seriesId),
    [series?.id, series?.provider, seriesId],
  )
  const sourceLink = useMemo(
    () => buildRemoteSeriesSourceUrl(series?.id ?? seriesId, sourceProvider),
    [series?.id, seriesId, sourceProvider],
  )
  const sourceLabel = useMemo(
    () => remoteProviderLabel(sourceProvider),
    [sourceProvider],
  )
  const latestReleaseDate = useMemo(() => {
    for (let index = ascendingChapters.length - 1; index >= 0; index -= 1) {
      const date = ascendingChapters[index]?.date
      if (date) {
        return date
      }
    }

    return null
  }, [ascendingChapters])
  const formattedLatestReleaseDate = useMemo(() => {
    if (!latestReleaseDate) {
      return null
    }

    const parsed = new Date(latestReleaseDate)
    if (Number.isNaN(parsed.getTime())) {
      return latestReleaseDate
    }

    return parsed.toLocaleDateString(undefined, { dateStyle: 'medium' })
  }, [latestReleaseDate])

  const formatChapterDate = useCallback((value?: string) => {
    if (!value) {
      return 'Date not available'
    }

    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) {
      return value
    }

    return parsed.toLocaleDateString(undefined, { dateStyle: 'medium' })
  }, [])

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
  const completedChapterIds = useMemo(() => {
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
      ascendingChapters.find(
        (chapter) => !completedChapterIds.has(chapter.id),
      ) ?? null

    if (latestHistoryEntry && latestHistoryEntry.completed !== true) {
      return latestChapter ?? firstUnread ?? ascendingChapters[0] ?? null
    }

    return firstUnread ?? latestChapter ?? ascendingChapters[0] ?? null
  }, [ascendingChapters, completedChapterIds, latestHistoryEntry])
  const latestHistoryLabel = useMemo(() => {
    if (!latestHistoryEntry) {
      return null
    }

    const chapterMeta = ascendingChapters.find(
      (chapter) => chapter.id === latestHistoryEntry.chapterId,
    )
    const chapterLabel = chapterMeta
      ? formatChapterLabel(chapterMeta.number, chapterMeta.title)
      : latestHistoryEntry.chapterTitle
    const pageLabel = `Page ${Math.max(1, latestHistoryEntry.pageIndex + 1)}`
    const completionLabel =
      latestHistoryEntry.completed === true ? 'Completed' : 'In progress'

    return `${chapterLabel} · ${pageLabel} · ${completionLabel}`
  }, [ascendingChapters, formatChapterLabel, latestHistoryEntry])
  const filteredChapters = useMemo(() => {
    const query = chapterQuery.trim().toLowerCase()

    let list = chapters

    if (query) {
      list = list.filter((chapter) => {
        const chapterNumber = String(chapter.number)
        return (
          chapter.title.toLowerCase().includes(query) ||
          chapterNumber.includes(query)
        )
      })
    }

    if (chapterReadFilter === 'read') {
      list = list.filter((chapter) => completedChapterIds.has(chapter.id))
    } else if (chapterReadFilter === 'unread') {
      list = list.filter((chapter) => !completedChapterIds.has(chapter.id))
    }

    return list
  }, [chapterQuery, chapters, chapterReadFilter, completedChapterIds])
  const totalPages = Math.max(
    1,
    Math.ceil(filteredChapters.length / CHAPTERS_PER_PAGE),
  )
  const paginatedChapters = useMemo(() => {
    const start = (chapterPage - 1) * CHAPTERS_PER_PAGE
    return filteredChapters.slice(start, start + CHAPTERS_PER_PAGE)
  }, [filteredChapters, chapterPage])

  const toggleChapterRead = useCallback(
    (chapterId: string, chapterTitle: string, chapterNumber: number) => {
      const existingHistory = historyByChapterId[chapterId]
      const nextCompleted = existingHistory?.completed !== true
      const nextUpdatedAt = Date.now()

      upsertReadingHistory({
        chapterId,
        seriesId,
        seriesTitle: series?.title,
        chapterTitle: formatChapterLabel(chapterNumber, chapterTitle),
        pageIndex: existingHistory?.pageIndex ?? 0,
        mode: existingHistory?.mode ?? 'single',
        readerRoute: 'weebcentral',
        completed: nextCompleted,
        updatedAt: nextUpdatedAt,
      })

      const nextItem: ReadingHistoryItem = {
        chapterId,
        seriesId,
        seriesTitle: series?.title,
        chapterTitle: formatChapterLabel(chapterNumber, chapterTitle),
        pageIndex: existingHistory?.pageIndex ?? 0,
        mode: existingHistory?.mode ?? 'single',
        readerRoute: 'weebcentral',
        completed: nextCompleted,
        updatedAt: nextUpdatedAt,
      }

      setHistoryByChapterId((current) => ({
        ...current,
        [chapterId]: nextItem,
      }))
      setLatestHistoryEntry(nextItem)
    },
    [formatChapterLabel, historyByChapterId, series?.title, seriesId],
  )

  if (isLoading) {
    return (
      <div
        className="text-sm text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        <p className="delight-loading-note">
          {REMOTE_SERIES_LOADING_LINES[loadingLineIndex]}
        </p>
      </div>
    )
  }

  if (error || !series) {
    return (
      <div className="text-sm text-destructive">
        We could not open this series right now. Please go back and try again.
      </div>
    )
  }

  return (
    <div className="space-y-5 pb-10">
      <section className="exp-hero">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex min-w-0 flex-col items-start gap-4 sm:flex-row">
            {series.coverUrl ? (
              <FadeImage
                src={series.coverUrl}
                alt={`${series.title} cover`}
                className="cover-hover h-44 w-30 shrink-0 border border-border object-cover sm:h-52 sm:w-36 md:h-56 md:w-40"
                loading="eager"
                fetchPriority="high"
                decoding="async"
                style={{ viewTransitionName: `cover-${series.id}` }}
              />
            ) : (
              <div
                className="flex h-44 w-30 shrink-0 items-center justify-center border border-border bg-surface-soft text-xs text-muted-foreground sm:h-52 sm:w-36 md:h-56 md:w-40"
                style={{ viewTransitionName: `cover-${series.id}` }}
              >
                No image
              </div>
            )}
            <div className="max-w-3xl min-w-0">
              <Link to="/" className="exp-back-link">
                ← Home
              </Link>
              <div className="mt-3">
                <span className="issue-label">Read online</span>
              </div>

              <h1 className="manga-title mt-4 text-3xl font-bold tracking-tight text-foreground md:text-4xl">
                {series.title}
              </h1>
              {series.description ? (
                <p className="mt-2 text-sm leading-6 text-muted-foreground sm:line-clamp-5 md:line-clamp-none">
                  {series.description}
                </p>
              ) : null}
              {series.author ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  Author: {series.author}
                </p>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="manga-stamp">{chapterCount} chapters</span>
                <a
                  href={sourceLink}
                  target="_blank"
                  rel="noreferrer"
                  className="manga-stamp underline-offset-2 hover:underline"
                >
                  Source: {sourceLabel}
                </a>
                {formattedLatestReleaseDate ? (
                  <span className="manga-stamp">
                    Latest: {formattedLatestReleaseDate}
                  </span>
                ) : null}
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                Start with the next unread chapter, or browse the full chapter
                list below.
              </p>
              {latestHistoryLabel ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Last read: {latestHistoryLabel}
                </p>
              ) : null}
              <p className="delight-tip mt-2 text-xs text-muted-foreground">
                Tip: press <kbd className="delight-kbd">/</kbd> to focus chapter
                search.
              </p>
            </div>
          </div>

          <div className="flex w-full flex-wrap items-start gap-2 md:w-auto md:justify-end">
            {nextChapter ? (
              <Link
                to="/weebcentral/$chapterId"
                params={{ chapterId: nextChapter.id }}
                search={{
                  seriesId: series.id,
                  seriesTitle: series.title,
                }}
                className="delight-cta inline-flex h-10 flex-1 items-center justify-center bg-koten px-4 text-sm font-semibold text-[var(--active-contrast)] md:flex-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-koten"
              >
                Continue reading
              </Link>
            ) : null}
            <Button
              type="button"
              variant={isSavedInLibrary ? 'destructive' : 'soft'}
              size="icon"
              className="size-9"
              onClick={() => {
                if (isSavedInLibrary) {
                  removeSavedWeebcentralSeries(series.id)
                  setIsSavedInLibrary(false)
                } else {
                  const summary: SavedSeriesSummary = {
                    id: series.id,
                    title: series.title,
                    coverUrl: series.coverUrl,
                    author: series.author,
                    description: series.description,
                    chapterCount: series.chapters.length,
                    provider: series.provider ?? 'weebcentral',
                    savedAt: Date.now(),
                  }
                  upsertSavedWeebcentralSeries(summary)
                  setIsSavedInLibrary(true)
                }
              }}
              title={
                isSavedInLibrary ? 'Remove from library' : 'Add to library'
              }
              aria-label={
                isSavedInLibrary ? 'Remove from library' : 'Add to library'
              }
            >
              {isSavedInLibrary ? (
                <X className="size-3.5" />
              ) : (
                <Plus className="size-3.5" />
              )}
            </Button>
            <div className="flex flex-col items-center gap-1">
              <div className="relative">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className={cn(
                    'size-9',
                    syncTimedOut ? 'text-muted-foreground' : '',
                  )}
                  onClick={() => {
                    void syncSeriesMetadata()
                  }}
                  title={
                    syncTimedOut
                      ? 'Refresh metadata (sync delayed)'
                      : 'Refresh metadata'
                  }
                  aria-label="Refresh metadata"
                  disabled={isSyncingMetadata}
                >
                  <RefreshCcw
                    className={cn(
                      'size-3.5',
                      isSyncingMetadata ? 'animate-spin' : '',
                    )}
                  />
                </Button>
                {syncTimedOut ? (
                  <span className="pointer-events-none absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-muted-foreground/70" />
                ) : null}
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-9"
                onClick={resetSeriesHistory}
                title="Reset reading history"
                aria-label="Reset reading history"
              >
                <History className="size-3.5" />
              </Button>
            </div>
            {isSyncingMetadata ? (
              <p className="delight-loading-note w-full text-xs text-muted-foreground md:text-right">
                Refreshing chapter metadata…
              </p>
            ) : null}
            {!isSyncingMetadata && syncTimedOut ? (
              <p className="w-full text-xs text-muted-foreground md:text-right">
                Sync is taking longer than usual. Try again in a moment.
              </p>
            ) : null}
            {!isSyncingMetadata && !syncTimedOut ? (
              <p className="w-full text-xs text-muted-foreground md:text-right">
                Save this series, refresh chapter info, or reset your reading
                progress.
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <div className="manga-divider" aria-hidden />
        <div className="exp-filter-toolbar">
          <div className="exp-toolbar-copy">
            <span className="issue-label">Chapters</span>
            <p className="text-sm text-foreground">
              Filter, sort, or switch views.
            </p>
            <p className="text-xs">
              Search by chapter number, title, or release date.
            </p>
          </div>
          <div className="exp-filter-actions">
            <Button
              type="button"
              variant={chapterView === 'grid' ? 'default' : 'soft'}
              size="icon"
              className="size-8"
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
              className="size-8"
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
              className="size-8"
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
              className="size-8"
              onClick={() => setChapterOrder('newest')}
              title="Newest first"
              aria-label="Newest first"
            >
              <ArrowDownWideNarrow className="size-3.5" />
            </Button>
            <div className="flex items-center gap-1 rounded border border-border p-0.5">
              <button
                type="button"
                onClick={() => setChapterReadFilter('all')}
                className={cn(
                  'h-6 rounded px-2 text-xs font-medium transition-colors',
                  chapterReadFilter === 'all'
                    ? 'bg-koten text-[var(--active-contrast)]'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setChapterReadFilter('unread')}
                className={cn(
                  'h-6 rounded px-2 text-xs font-medium transition-colors',
                  chapterReadFilter === 'unread'
                    ? 'bg-koten text-[var(--active-contrast)]'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                Unread
              </button>
              <button
                type="button"
                onClick={() => setChapterReadFilter('read')}
                className={cn(
                  'h-6 rounded px-2 text-xs font-medium transition-colors',
                  chapterReadFilter === 'read'
                    ? 'bg-koten text-[var(--active-contrast)]'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                Read
              </button>
            </div>
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
            const completed = historyByChapterId[chapter.id]?.completed === true

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
                          chapter.number,
                        )
                      }
                      aria-label={completed ? 'Mark unread' : 'Mark read'}
                      aria-pressed={completed}
                    >
                      ✓
                    </button>
                    <Link
                      to="/weebcentral/$chapterId"
                      params={{ chapterId: chapter.id }}
                      search={{
                        seriesId: series.id,
                        seriesTitle: series.title,
                      }}
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
                        {formatChapterLabel(chapter.number, chapter.title)}
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        {formatChapterDate(chapter.date)}
                      </p>
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
                    toggleChapterRead(chapter.id, chapter.title, chapter.number)
                  }
                  aria-label={completed ? 'Mark unread' : 'Mark read'}
                  aria-pressed={completed}
                >
                  ✓
                </button>
                <Link
                  to="/weebcentral/$chapterId"
                  params={{ chapterId: chapter.id }}
                  search={{
                    seriesId: series.id,
                    seriesTitle: series.title,
                  }}
                  className="flex min-w-0 flex-1 items-center"
                >
                  <div className="min-w-0">
                    <h3
                      className={cn(
                        'truncate text-sm font-semibold md:text-base',
                        completed ? 'text-muted-foreground' : 'text-foreground',
                      )}
                    >
                      {formatChapterLabel(chapter.number, chapter.title)}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {formatChapterDate(chapter.date)}
                    </p>
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
              ? `No chapters matched "${chapterQuery.trim()}". Try a chapter number, title, or shorter search.`
              : 'No chapters available right now.'}
          </p>
        ) : null}
      </section>
    </div>
  )
}
