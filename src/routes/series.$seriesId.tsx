import { createFileRoute, Link } from '@tanstack/react-router'

const createAnyFileRoute = createFileRoute as any
import { useCallback, useEffect, useState } from 'react'

import { buttonVariants } from '#/components/ui/button'
import type { SeriesDetail } from '#/lib/contracts'
import { fetchJson } from '#/lib/http-client'
import { cn } from '#/lib/utils'

export const Route = createAnyFileRoute('/series/$seriesId')({
  component: SeriesPage,
})

function SeriesPage() {
  const params = Route.useParams()
  const [series, setSeries] = useState<SeriesDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

  return (
    <div className="space-y-4">
      <div
        className="animate-enter rounded-2xl border border-border bg-surface p-5 shadow-[0_16px_30px_-26px_var(--shadow)]"
        style={{ animationDelay: '20ms' }}
      >
        <Link
          to="/"
          className={cn(
            buttonVariants({ variant: 'soft', size: 'sm' }),
            'rounded-full text-muted-foreground',
          )}
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
            <div className="mt-3 inline-flex items-center rounded-full border border-border bg-surface-soft px-3 py-1 text-xs text-muted-foreground">
              Source: {series.source}
            </div>
          </>
        ) : null}
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-border bg-surface p-5 text-muted-foreground">
          Loading chapters…
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-5 text-destructive">
          {error}
        </div>
      ) : null}

      {!isLoading && series ? (
        <div className="space-y-3">
          {series.chapters.map((chapter) => (
            <article
              key={chapter.id}
              className="animate-enter group rounded-xl border border-border bg-surface p-4 transition-colors duration-200 hover:border-primary/50"
              style={{ animationDelay: `${80 + chapter.pageCount * 3}ms` }}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    ch {chapter.chapterNumber}
                  </p>
                  <h3 className="mt-1 text-xl font-semibold tracking-tight text-foreground">
                    {chapter.title}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {chapter.pageCount} pages
                  </p>
                </div>
                <Link
                  className={cn(
                    buttonVariants({ variant: 'soft' }),
                    'rounded-full',
                  )}
                  to="/reader/$chapterId"
                  params={{ chapterId: chapter.id }}
                >
                  Read chapter
                </Link>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  )
}
