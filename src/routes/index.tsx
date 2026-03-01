import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'

const createAnyFileRoute = createFileRoute as any
import { useCallback, useEffect, useMemo, useState } from 'react'

import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import type { ReadingHistoryItem, WeebcentralSeriesDTO } from '#/lib/contracts'
import { weebcentralSeriesQueryOptions } from '#/lib/query-options'
import { loadReadingHistory } from '#/lib/reading-history'
import {
  absoluteUrl,
  canonicalUrl,
  DEFAULT_OG_IMAGE_PATH,
  SITE_URL,
} from '#/lib/seo'

const HOME_ONBOARDING_KEY = 'tsuki-home-onboarding-dismissed.v1'
import {
  loadSavedWeebcentralSeries,
  removeSavedWeebcentralSeries,
} from '#/lib/weebcentral-library'

const HOME_TITLE = 'Tsuki Reader | Old-School Manga Reader'
const HOME_DESCRIPTION =
  'Tsuki Reader is a fast web manga reader and image proxy with a clean interface, smooth paging, and mobile-friendly controls.'

export const Route = createAnyFileRoute('/')({
  head: () => ({
    meta: [
      { title: HOME_TITLE },
      { name: 'description', content: HOME_DESCRIPTION },
      { property: 'og:type', content: 'website' },
      { property: 'og:title', content: HOME_TITLE },
      { property: 'og:description', content: HOME_DESCRIPTION },
      { property: 'og:url', content: SITE_URL },
      { property: 'og:image', content: absoluteUrl(DEFAULT_OG_IMAGE_PATH) },
      { property: 'og:image:alt', content: 'Tsuki Reader icon' },
      { name: 'twitter:title', content: HOME_TITLE },
      { name: 'twitter:description', content: HOME_DESCRIPTION },
      { name: 'twitter:image', content: absoluteUrl(DEFAULT_OG_IMAGE_PATH) },
    ],
    links: [{ rel: 'canonical', href: canonicalUrl('/') }],
  }),
  component: LibraryPage,
})

function LibraryPage() {
  const [history, setHistory] = useState<ReadingHistoryItem[]>([])
  const [remoteInput, setRemoteInput] = useState('')
  const [isRemoteLoading, setIsRemoteLoading] = useState(false)
  const [remoteError, setRemoteError] = useState<string | null>(null)
  const [savedRemoteSeries, setSavedRemoteSeries] = useState<
    WeebcentralSeriesDTO[]
  >([])
  const [showOnboardingHint, setShowOnboardingHint] = useState(false)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const dismissOnboardingHint = useCallback(() => {
    setShowOnboardingHint(false)

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(HOME_ONBOARDING_KEY, '1')
    }
  }, [])

  const refreshSideData = useCallback(() => {
    setHistory(loadReadingHistory().filter((item) => item.readerRoute === 'weebcentral'))
    setSavedRemoteSeries(loadSavedWeebcentralSeries())
  }, [])

  useEffect(() => {
    refreshSideData()
  }, [refreshSideData])

  useEffect(() => {
    const onFocus = () => {
      refreshSideData()
    }

    window.addEventListener('focus', onFocus)

    return () => {
      window.removeEventListener('focus', onFocus)
    }
  }, [refreshSideData])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const dismissed = window.localStorage.getItem(HOME_ONBOARDING_KEY) === '1'
    setShowOnboardingHint(!dismissed)
  }, [])

  const loadRemoteSeries = useCallback(async () => {
    const inputValue = remoteInput.trim()

    if (inputValue.length === 0) {
      setRemoteError('Paste an online series link first')
      return
    }

    setIsRemoteLoading(true)
    setRemoteError(null)

    try {
      const payload = await queryClient.fetchQuery(
        weebcentralSeriesQueryOptions(inputValue),
      )
      dismissOnboardingHint()
      void navigate({
        to: '/weebcentral-series/$seriesId',
        params: { seriesId: payload.id },
      })
    } catch (requestError) {
      void requestError
      setRemoteError(
        'Could not find that series. Please check the link and try again.',
      )
    } finally {
      setIsRemoteLoading(false)
    }
  }, [dismissOnboardingHint, navigate, queryClient, remoteInput])

  const removeRemoteSeriesFromLibrary = useCallback((seriesId: string) => {
    removeSavedWeebcentralSeries(seriesId)
    setSavedRemoteSeries(loadSavedWeebcentralSeries())
  }, [])

  const recentHistory = history.slice(0, 6)
  const topHistory = recentHistory[0] ?? null
  const hasHistory = recentHistory.length > 0
  const totalSeries = savedRemoteSeries.length
  const topHistoryCoverUrl = useMemo(() => {
    if (!topHistory) {
      return null
    }
    const remoteMatch = savedRemoteSeries.find(
      (entry) => entry.id === topHistory.seriesId,
    )
    return remoteMatch?.coverUrl ?? null
  }, [savedRemoteSeries, topHistory])

  const recentSeriesCards = useMemo(() => {
    const seen = new Set<string>()

    return history
      .filter((item) => {
        if (item.readerRoute !== 'weebcentral') {
          return false
        }

        const key = item.seriesId
        if (seen.has(key)) {
          return false
        }
        seen.add(key)
        return true
      })
      .slice(0, 6)
      .map((item) => {
        const remoteMatch = savedRemoteSeries.find(
          (entry) => entry.id === item.seriesId,
        )

        return {
          key: `remote:${item.seriesId}`,
          seriesId: item.seriesId,
          seriesTitle: item.seriesTitle ?? remoteMatch?.title ?? 'Series',
          chapterTitle: item.chapterTitle,
          coverUrl: remoteMatch?.coverUrl ?? null,
        }
      })
  }, [history, savedRemoteSeries])

  return (
    <div className="space-y-5 pb-10">
      <section
        className="exp-hero animate-enter"
        style={{ animationDelay: '20ms' }}
      >
        <span className="issue-label">Library</span>
        <div className="mt-3 grid gap-4 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div>
            <h1 className="manga-title max-w-4xl text-3xl font-semibold leading-tight text-foreground md:text-5xl">
              {hasHistory
                ? 'Continue reading'
                : 'Read manga'}
            </h1>
            <p className="manga-subtitle mt-3 max-w-2xl text-sm text-muted-foreground md:text-base">
              {hasHistory
                ? 'Your recent chapters are below. You can open any saved online series anytime.'
                : 'Paste a WeebCentral or MangaDex series link and start reading.'}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {topHistory ? (
                <Link
                  to="/weebcentral/$chapterId"
                  params={{ chapterId: topHistory.chapterId }}
                  search={{
                    seriesId: topHistory.seriesId,
                    seriesTitle: topHistory.seriesTitle,
                  }}
                  className="inline-flex h-10 items-center border-2 border-primary bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-[2px_2px_0_var(--shadow)]"
                >
                  Continue reading
                </Link>
              ) : (
                <a
                  href="#proxy"
                  className="inline-flex h-10 items-center border-2 border-primary bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-[2px_2px_0_var(--shadow)]"
                >
                  Start online
                </a>
              )}
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              {totalSeries} saved series • {recentHistory.length} recent reads
            </p>
            {showOnboardingHint ? (
              <div className="mt-3 flex items-start justify-between gap-3 border border-border/70 bg-surface-soft px-3 py-2 text-sm text-muted-foreground">
                <p>
                  Start with <strong>Read online</strong>.
                </p>
                <button
                  type="button"
                  onClick={dismissOnboardingHint}
                  className="text-xs font-semibold text-foreground"
                >
                  Dismiss
                </button>
              </div>
            ) : null}
          </div>
          <div className="exp-surface space-y-2">
            {hasHistory && topHistory ? (
              <>
                <p className="exp-kicker">Your last read</p>
                <Link
                  to="/weebcentral-series/$seriesId"
                  params={{ seriesId: topHistory.seriesId }}
                  className="group flex items-start gap-3 rounded hover:bg-surface transition-colors"
                >
                  {topHistoryCoverUrl ? (
                    <img
                      src={topHistoryCoverUrl}
                      alt="Last read manga cover"
                      className="h-16 w-12 shrink-0 border border-border object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-16 w-12 shrink-0 items-center justify-center border border-border bg-surface-soft text-[10px] text-muted-foreground">
                      No
                      <br />
                      image
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                      {topHistory.chapterTitle}
                    </p>
                    {topHistory.seriesTitle ? (
                      <p className="truncate text-sm text-muted-foreground">
                        {topHistory.seriesTitle}
                      </p>
                    ) : null}
                  </div>
                </Link>
                <p className="pt-1 text-xs text-muted-foreground">
                  Continue from above, or pick another series below.
                </p>
              </>
            ) : (
              <>
                <p className="exp-kicker">Quick start</p>
                <p className="text-sm text-muted-foreground">
                  1. Open an online series
                </p>
                <p className="text-sm text-muted-foreground">
                  2. Select a chapter
                </p>
                <p className="text-sm text-muted-foreground">3. Start reading</p>
                <p className="pt-1 text-xs text-muted-foreground">
                  No account required.
                </p>
              </>
            )}
          </div>
        </div>
      </section>

      {!hasHistory ? (
        <section
          className="exp-surface-soft animate-enter"
          style={{ animationDelay: '40ms' }}
        >
          <h2 className="manga-title text-lg font-semibold text-foreground md:text-xl">
            No recent reads yet
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Start in one step: open an online series.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href="#proxy"
              className="inline-flex h-9 items-center border border-border bg-surface px-3 text-sm font-semibold text-foreground"
            >
              Read online
            </a>
          </div>
        </section>
      ) : null}

      {hasHistory ? (
        <section
          className="exp-surface animate-enter"
          style={{ animationDelay: '60ms' }}
        >
          <span className="issue-label">Continue</span>
          <div className="mt-2 flex items-center justify-between gap-3">
            <h2 className="manga-title text-xl font-semibold tracking-tight text-foreground md:text-2xl">
              Recent series
            </h2>
            <span className="text-xs text-muted-foreground">
              {recentSeriesCards.length}
            </span>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {recentSeriesCards.map((item) => (
              <Link
                key={item.key}
                to="/weebcentral-series/$seriesId"
                params={{ seriesId: item.seriesId }}
                className="exp-row h-full min-h-28 items-stretch"
              >
                {item.coverUrl ? (
                  <img
                    src={item.coverUrl}
                    alt={`${item.seriesTitle} cover`}
                    className="h-full w-20 shrink-0 self-stretch border border-border object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full w-20 shrink-0 items-center justify-center self-stretch border border-border bg-surface-soft text-[10px] text-muted-foreground">
                    No image
                  </div>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground md:text-base group-hover:text-primary transition-colors">
                    {item.seriesTitle}
                  </p>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    Last read: {item.chapterTitle}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <div className="manga-divider" aria-hidden />

      <section
        id="proxy"
        className="exp-surface animate-enter"
        style={{ animationDelay: '85ms' }}
      >
        <span className="issue-label">Online</span>
        <h2 className="manga-title mt-2 text-xl font-semibold tracking-tight text-foreground md:text-2xl">
          Read online
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Paste a WeebCentral or MangaDex series link, then pick a chapter.
        </p>

        <form
          className="mt-4 flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault()
            void loadRemoteSeries()
          }}
        >
          <Input
            value={remoteInput}
            onChange={(event) => setRemoteInput(event.target.value)}
            placeholder="Paste WeebCentral or MangaDex series link"
          />
          <Button
            type="submit"
            variant="soft"
            className="sm:w-28"
            disabled={isRemoteLoading}
          >
            {isRemoteLoading ? 'Loading…' : 'Go'}
          </Button>
        </form>

        {remoteError ? (
          <p className="mt-2 text-sm text-destructive">{remoteError}</p>
        ) : null}

        {savedRemoteSeries.length > 0 ? (
          <div className="mt-5 space-y-1.5">
            <p className="text-xs text-muted-foreground">Saved online series</p>
            {savedRemoteSeries.map((item) => (
              <article key={`remote:${item.id}`} className="exp-row">
                <Link
                  to="/weebcentral-series/$seriesId"
                  params={{ seriesId: item.id }}
                  className="group flex min-w-0 flex-1 items-center gap-3"
                >
                  {item.coverUrl ? (
                    <img
                      className="h-20 w-14 shrink-0 border border-border object-cover"
                      src={item.coverUrl}
                      alt={`${item.title} cover`}
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-20 w-14 shrink-0 items-center justify-center border border-border bg-surface-soft text-[10px] text-muted-foreground">
                      None
                    </div>
                  )}
                  <div className="min-w-0">
                    <h4 className="truncate text-sm font-semibold text-foreground transition-colors group-hover:text-primary md:text-base">
                      {item.title}
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      {item.chapters.length} chapters
                    </p>
                  </div>
                </Link>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => {
                    if (window.confirm(`Are you sure you want to remove ${item.title}?`)) {
                      removeRemoteSeriesFromLibrary(item.id)
                    }
                  }}
                >
                  Remove series
                </Button>
              </article>
            ))}
          </div>
        ) : null}
      </section>

      <section
        className="exp-surface-soft animate-enter space-y-3"
        style={{ animationDelay: '105ms' }}
      >
        <h2 className="manga-title text-lg font-semibold text-foreground md:text-xl">
          About Tsuki Reader
        </h2>
        <p className="text-sm text-muted-foreground">
          Tsuki is a web manga reader focused on fast page turns, clean typography,
          and a minimal old-school reading layout.
        </p>
        <p className="text-sm text-muted-foreground">
          This website is an image proxy and reading interface. It does not host
          manga files.
        </p>
      </section>
    </div>
  )
}
