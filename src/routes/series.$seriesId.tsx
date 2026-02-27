import { createFileRoute, Link } from '@tanstack/react-router'
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  LayoutGrid,
  List,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'

const createAnyFileRoute = createFileRoute as any
import { useCallback, useEffect, useMemo, useState } from 'react'

import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import type { SeriesDetail } from '#/lib/contracts'
import { resolveApiUrl } from '#/lib/http-client'
import { isLocalSessionSeriesAllowed } from '#/lib/local-upload-session'
import { localSeriesQueryOptions } from '#/lib/query-options'
import type { AppRouterContext } from '#/lib/router-context'
import { loadReadingHistory, upsertReadingHistory } from '#/lib/reading-history'
import { cn } from '#/lib/utils'

export const Route = createAnyFileRoute('/series/$seriesId')({
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
  const [completedChapters, setCompletedChapters] = useState<Set<string>>(
    () => new Set<string>(),
  )
  const [chapterView, setChapterView] = useState<'list' | 'grid'>('list')
  const [chapterOrder, setChapterOrder] = useState<'oldest' | 'newest'>(
    'oldest',
  )
  const [chapterQuery, setChapterQuery] = useState('')
  const [previewCoverPageIndex, setPreviewCoverPageIndex] = useState(0)

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
    const completed = loadReadingHistory()
      .filter(
        (item) =>
          item.readerRoute !== 'weebcentral' &&
          item.seriesId === params.seriesId &&
          item.completed,
      )
      .map((item) => item.chapterId)

    setCompletedChapters(new Set(completed))
  }, [params.seriesId])

  const sortedChapters = useMemo(() => {
    const base = [...(series?.chapters ?? [])].sort((left, right) => {
      if (left.chapterNumber !== right.chapterNumber) {
        return left.chapterNumber - right.chapterNumber
      }

      return left.sortIndex - right.sortIndex
    })

    return chapterOrder === 'newest' ? [...base].reverse() : base
  }, [chapterOrder, series?.chapters])

  const nextChapter =
    sortedChapters.find((chapter) => !completedChapters.has(chapter.id)) ??
    sortedChapters[0] ??
    null
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

  const toggleChapterRead = useCallback(
    (chapterId: string, chapterTitle: string, chapterNumber: number) => {
      const nextCompleted = !completedChapters.has(chapterId)

      upsertReadingHistory({
        chapterId,
        seriesId: params.seriesId,
        chapterTitle: formatChapterLabel(chapterNumber, chapterTitle),
        pageIndex: 0,
        mode: 'single',
        readerRoute: 'local',
        completed: nextCompleted,
      })

      setCompletedChapters((current) => {
        const next = new Set(current)
        if (nextCompleted) {
          next.add(chapterId)
        } else {
          next.delete(chapterId)
        }
        return next
      })
    },
    [completedChapters, formatChapterLabel, params.seriesId],
  )

  useEffect(() => {
    setPreviewCoverPageIndex(0)
  }, [previewCoverChapterId])

  return (
    <div className="space-y-5 pb-10">
      <section
        className="exp-hero animate-enter"
        style={{ animationDelay: '20ms' }}
      >
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex min-w-0 flex-col items-start gap-4 sm:flex-row">
            {previewCoverChapterId ? (
              <img
                src={resolveApiUrl(
                  `/api/image/${previewCoverChapterId}/${previewCoverPageIndex}?thumb=1`,
                )}
                alt={`${series?.title ?? 'Series'} cover`}
                className="h-36 w-24 shrink-0 border border-border object-cover sm:h-32"
                loading="lazy"
                onError={() => {
                  if (previewCoverPageIndex === 0) {
                    setPreviewCoverPageIndex(1)
                  }
                }}
              />
            ) : (
              <div className="flex h-36 w-24 shrink-0 items-center justify-center border border-border bg-surface-soft text-xs text-muted-foreground sm:h-32">
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
                  <h1 className="manga-title mt-4 text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
                    {series.title}
                  </h1>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground sm:line-clamp-5 md:line-clamp-none">
                    {series.description ?? 'No summary yet.'}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <span className="manga-stamp">
                      {sortedChapters.length} chapters
                    </span>
                    <span className="manga-stamp">
                      {completedCount} completed
                    </span>
                    <span className="manga-stamp">Source: {series.source}</span>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">
                    Pick any chapter below to start.
                  </p>
                </>
              ) : null}
            </div>
          </div>

          {nextChapter ? (
            <Link
              to="/reader/$chapterId"
              params={{ chapterId: nextChapter.id }}
              className="inline-flex h-10 w-full items-center justify-center border-2 border-primary bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-[2px_2px_0_var(--shadow)] sm:w-auto"
            >
              Continue reading
            </Link>
          ) : null}
        </div>
      </section>

      {isLoading ? (
        <section className="exp-surface animate-enter text-sm text-muted-foreground">
          Loading chapters…
        </section>
      ) : null}

      {error ? (
        <section className="exp-surface text-sm text-destructive">
          We could not open this series right now. Please go back and try again.
        </section>
      ) : null}

      <div className="manga-divider" aria-hidden />

      {!isLoading && series ? (
        <section
          className="animate-enter space-y-2"
          style={{ animationDelay: '55ms' }}
        >
          <div className="flex flex-wrap items-center gap-2">
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
            <Input
              value={chapterQuery}
              onChange={(event) => setChapterQuery(event.target.value)}
              className="h-8 w-full sm:ml-auto sm:max-w-xs"
              placeholder="Search chapters"
            />
          </div>
          <div
            className={
              chapterView === 'grid'
                ? 'grid gap-2 sm:grid-cols-2 lg:grid-cols-3'
                : 'space-y-1.5'
            }
          >
            {filteredChapters.map((chapter) => {
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
                        className={cn(
                          'inline-flex size-5 shrink-0 items-center justify-center border text-xs font-semibold',
                          completed
                            ? 'bg-primary/14 text-primary'
                            : 'bg-surface-soft text-transparent',
                        )}
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
                    className={cn(
                      'inline-flex size-5 shrink-0 items-center justify-center border text-xs font-semibold',
                      completed
                        ? 'bg-primary/14 text-primary'
                        : 'bg-surface-soft text-transparent',
                    )}
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
          {filteredChapters.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No chapters found for that search.
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
