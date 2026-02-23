import { Link, createFileRoute } from '@tanstack/react-router'
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  LayoutGrid,
  List,
  Plus,
  RefreshCcw,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import type { WeebcentralSeriesDTO } from '#/lib/contracts'
import { fetchJson } from '#/lib/http-client'
import { loadReadingHistory, upsertReadingHistory } from '#/lib/reading-history'
import { cn } from '#/lib/utils'
import {
  loadSavedWeebcentralSeries,
  removeSavedWeebcentralSeries,
  upsertSavedWeebcentralSeries,
} from '#/lib/weebcentral-library'

const createAnyFileRoute = createFileRoute as any

export const Route = createAnyFileRoute('/weebcentral-series/$seriesId')({
  component: WeebcentralSeriesPage,
})

function WeebcentralSeriesPage() {
  const { seriesId } = Route.useParams()
  const [series, setSeries] = useState<WeebcentralSeriesDTO | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [historyMap, setHistoryMap] = useState<Record<string, boolean>>({})
  const [chapterView, setChapterView] = useState<'list' | 'grid'>('list')
  const [chapterOrder, setChapterOrder] = useState<'oldest' | 'newest'>(
    'oldest',
  )
  const [chapterQuery, setChapterQuery] = useState('')
  const [isSavedInLibrary, setIsSavedInLibrary] = useState(false)

  const loadSeries = useCallback(
    async (forceRefresh = false) => {
      setIsLoading(true)
      setError(null)

      try {
        const payload = await fetchJson<WeebcentralSeriesDTO>(
          `/v1/weebcentral/series?url=${encodeURIComponent(seriesId)}${forceRefresh ? '&force=1' : ''}`,
        )
        setSeries(payload)
      } catch (requestError) {
        void requestError
        setError('Could not open this online series right now.')
      } finally {
        setIsLoading(false)
      }
    },
    [seriesId],
  )

  useEffect(() => {
    void loadSeries()
  }, [loadSeries])

  useEffect(() => {
    const history = loadReadingHistory().filter(
      (item) =>
        item.readerRoute === 'weebcentral' && item.seriesId === seriesId,
    )

    setHistoryMap(
      history.reduce<Record<string, boolean>>((acc, item) => {
        acc[item.chapterId] = Boolean(item.completed)
        return acc
      }, {}),
    )
  }, [seriesId])

  useEffect(() => {
    const saved = loadSavedWeebcentralSeries()
    setIsSavedInLibrary(saved.some((entry) => entry.id === seriesId))
  }, [seriesId])

  const chapters = useMemo(() => {
    const base = [...(series?.chapters ?? [])].sort(
      (left, right) => left.number - right.number,
    )
    return chapterOrder === 'newest' ? [...base].reverse() : base
  }, [chapterOrder, series?.chapters])
  const latestReleaseDate = useMemo(
    () => chapters.find((chapter) => Boolean(chapter.date))?.date ?? null,
    [chapters],
  )
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
  const nextChapter =
    chapters.find((chapter) => historyMap[chapter.id] !== true) ??
    chapters[0] ??
    null
  const filteredChapters = useMemo(() => {
    const query = chapterQuery.trim().toLowerCase()
    if (!query) {
      return chapters
    }

    return chapters.filter((chapter) => {
      const chapterNumber = String(chapter.number)
      return (
        chapter.title.toLowerCase().includes(query) ||
        chapterNumber.includes(query)
      )
    })
  }, [chapterQuery, chapters])

  const toggleChapterRead = useCallback(
    (chapterId: string, chapterTitle: string, chapterNumber: number) => {
      const nextCompleted = historyMap[chapterId] !== true

      upsertReadingHistory({
        chapterId,
        seriesId,
        seriesTitle: series?.title,
        chapterTitle: formatChapterLabel(chapterNumber, chapterTitle),
        pageIndex: 0,
        mode: 'single',
        readerRoute: 'weebcentral',
        completed: nextCompleted,
      })

      setHistoryMap((current) => ({
        ...current,
        [chapterId]: nextCompleted,
      }))
    },
    [formatChapterLabel, historyMap, series?.title, seriesId],
  )

  if (isLoading) {
    return (
      <div className="exp-surface animate-enter text-sm text-muted-foreground">
        Loading series…
      </div>
    )
  }

  if (error || !series) {
    return (
      <div className="exp-surface text-sm text-destructive">
        We could not open this series right now. Please go back and try again.
      </div>
    )
  }

  return (
    <div className="space-y-5 pb-10">
      <section
        className="exp-hero animate-enter"
        style={{ animationDelay: '20ms' }}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-1 items-start gap-4">
            {series.coverUrl ? (
              <img
                src={series.coverUrl}
                alt={`${series.title} cover`}
                className="h-52 w-36 shrink-0 border border-border object-cover md:h-56 md:w-40"
                loading="lazy"
              />
            ) : (
              <div className="flex h-52 w-36 shrink-0 items-center justify-center border border-border bg-surface-soft text-xs text-muted-foreground md:h-56 md:w-40">
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

              <h1 className="manga-title mt-4 text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
                {series.title}
              </h1>
              {series.description ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  {series.description}
                </p>
              ) : null}
              {series.author ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  Author: {series.author}
                </p>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="manga-stamp">{chapters.length} chapters</span>
                <a
                  href={`https://weebcentral.com/series/${series.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="manga-stamp underline-offset-2 hover:underline"
                >
                  Source: WeebCentral
                </a>
                {formattedLatestReleaseDate ? (
                  <span className="manga-stamp">
                    Latest: {formattedLatestReleaseDate}
                  </span>
                ) : null}
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                Pick any chapter below to start.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {nextChapter ? (
              <Link
                to="/weebcentral/$chapterId"
                params={{ chapterId: nextChapter.id }}
                search={{
                  seriesId: series.id,
                  seriesTitle: series.title,
                }}
                className="inline-flex h-10 items-center border-2 border-primary bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-[2px_2px_0_var(--shadow)]"
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
                  upsertSavedWeebcentralSeries(series)
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
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-9"
              onClick={() => {
                void loadSeries(true)
              }}
              title="Refresh metadata"
              aria-label="Refresh metadata"
            >
              <RefreshCcw className="size-3.5" />
            </Button>
          </div>
        </div>
      </section>

      <section
        className="animate-enter space-y-2"
        style={{ animationDelay: '52ms' }}
      >
        <div className="manga-divider" aria-hidden />
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
            const completed = historyMap[chapter.id] === true

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
                  className={cn(
                    'inline-flex size-5 shrink-0 items-center justify-center border text-xs font-semibold',
                    completed
                      ? 'bg-primary/14 text-primary'
                      : 'bg-surface-soft text-transparent',
                  )}
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
        {filteredChapters.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No chapters found for that search.
          </p>
        ) : null}
      </section>
    </div>
  )
}
