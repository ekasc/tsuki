import { createFileRoute, Link } from '@tanstack/react-router'

const createAnyFileRoute = createFileRoute as any
import { useCallback, useEffect, useMemo, useState } from 'react'

import type { SeriesDetail } from '#/lib/contracts'
import { fetchJson } from '#/lib/http-client'
import { loadReadingHistory } from '#/lib/reading-history'
import { cn } from '#/lib/utils'

export const Route = createAnyFileRoute('/series/$seriesId')({
  component: SeriesPage,
})

function SeriesPage() {
  const params = Route.useParams()
  const [series, setSeries] = useState<SeriesDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [completedChapters, setCompletedChapters] = useState<Set<string>>(
    () => new Set<string>(),
  )

  const loadSeries = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const payload = await fetchJson<SeriesDetail>(
        `/api/series/${params.seriesId}`,
      )
      setSeries(payload)
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : 'Load failed',
      )
    } finally {
      setIsLoading(false)
    }
  }, [params.seriesId])

  useEffect(() => {
    void loadSeries()
  }, [loadSeries])

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

  const chapterStatuses = useMemo(() => completedChapters, [completedChapters])
  const orderedChapters = useMemo(
    () =>
      [...(series?.chapters ?? [])].sort((left, right) => {
        if (left.chapterNumber !== right.chapterNumber) {
          return left.chapterNumber - right.chapterNumber
        }

        return left.sortIndex - right.sortIndex
      }),
    [series?.chapters],
  )

  return (
    <div className="space-y-4">
      <div
        className="animate-enter ui-panel p-5"
        style={{ animationDelay: '20ms' }}
      >
        <Link
          to="/"
          className="ui-link-card inline-flex items-center px-3 py-1.5 text-xs text-muted-foreground"
        >
          Back to library
        </Link>
        {series ? (
          <>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
              {series.title}
            </h2>
            <p className="mt-1 text-muted-foreground">
              {series.description ?? 'No description'}
            </p>
            <div className="ui-pill mt-3">Source: {series.source}</div>
          </>
        ) : null}
      </div>

      {isLoading ? (
        <div className="ui-panel p-5 text-muted-foreground">
          Loading chapters…
        </div>
      ) : null}

      {error ? (
        <div className="border border-destructive/30 bg-destructive/10 p-5 text-destructive">
          {error}
        </div>
      ) : null}

      {!isLoading && series ? (
        <div className="space-y-2">
          {orderedChapters.map((chapter) => (
            <Link
              key={chapter.id}
              to="/reader/$chapterId"
              params={{ chapterId: chapter.id }}
              className="ui-link-card animate-enter group block px-3 py-3"
              style={{ animationDelay: `${80 + chapter.pageCount * 3}ms` }}
            >
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    'ui-check',
                    chapterStatuses.has(chapter.id)
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-surface-soft text-muted-foreground',
                  )}
                  aria-hidden
                >
                  {chapterStatuses.has(chapter.id) ? '✓' : ''}
                </span>
                <div className="min-w-0">
                  <p className="ui-kicker">ch {chapter.chapterNumber}</p>
                  <h3 className="truncate text-base font-semibold text-foreground group-hover:text-primary">
                    {chapter.title}
                  </h3>
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  )
}
