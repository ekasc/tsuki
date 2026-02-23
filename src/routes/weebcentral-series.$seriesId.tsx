import { Link, createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'

import type { WeebcentralSeriesDTO } from '#/lib/contracts'
import { fetchJson } from '#/lib/http-client'
import { loadReadingHistory } from '#/lib/reading-history'
import { cn } from '#/lib/utils'

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

  const loadSeries = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const payload = await fetchJson<WeebcentralSeriesDTO>(
        `/v1/weebcentral/series?url=${encodeURIComponent(seriesId)}`,
      )
      setSeries(payload)
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Failed to load WeebCentral series',
      )
    } finally {
      setIsLoading(false)
    }
  }, [seriesId])

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

  const chapters = useMemo(() => series?.chapters ?? [], [series?.chapters])

  if (isLoading) {
    return (
      <div className="ui-panel p-5 text-muted-foreground">Loading series…</div>
    )
  }

  if (error || !series) {
    return (
      <div className="border border-destructive/30 bg-destructive/10 p-5 text-destructive">
        {error ?? 'Series unavailable'}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="ui-panel p-5">
        <Link
          to="/"
          className="ui-link-card inline-flex items-center px-3 py-1.5 text-xs text-muted-foreground"
        >
          Back to library
        </Link>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
          {series.title}
        </h2>
        {series.description ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {series.description}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        {chapters.map((chapter) => {
          const completed = historyMap[chapter.id] === true

          return (
            <Link
              key={chapter.id}
              to="/weebcentral/$chapterId"
              params={{ chapterId: chapter.id }}
              search={{
                seriesId: series.id,
                seriesTitle: series.title,
              }}
              className="ui-link-card group block px-3 py-3"
            >
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    'ui-check',
                    completed
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-surface-soft text-muted-foreground',
                  )}
                  aria-hidden
                >
                  {completed ? '✓' : ''}
                </span>
                <div className="min-w-0">
                  <p className="ui-kicker">Ch {chapter.number}</p>
                  <h3 className="truncate text-base font-semibold text-foreground group-hover:text-primary">
                    {chapter.title}
                  </h3>
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
