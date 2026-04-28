import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import {
  Download,
  EllipsisVertical,
  Monitor,
  Share2,
  Smartphone,
  Trash2,
} from 'lucide-react'

import { useCallback, useEffect, useMemo, useState } from 'react'

import { Button } from '#/components/ui/button'
import { FadeImage } from '#/components/ui/fade-image'
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
const HOME_LOADING_LINES = [
  'Dusting off the shelves…',
  'Lining up chapter cards…',
  'Checking page turn gears…',
] as const
const HOME_READING_TIPS = [
  'Tip: press F in the reader for full-screen focus mode.',
  'Tip: double-page mode shines on landscape tablets.',
  'Tip: use keyboard arrows for quick page turns on desktop.',
  'Tip: install Tsuki to open straight into your library.',
] as const

import {
  loadSavedWeebcentralSeries,
  removeSavedWeebcentralSeries,
  upsertSavedWeebcentralSeries,
} from '#/lib/weebcentral-library'

const HOME_TITLE = 'Tsuki reader'
const HOME_DESCRIPTION =
  'Tsuki Reader is an online manga reader and image proxy built for smooth right-to-left paging on desktop, phones, and tablets.'

export const Route = createFileRoute('/')({
  head: () => ({
    meta: [
      { title: HOME_TITLE },
      { name: 'description', content: HOME_DESCRIPTION },
      {
        name: 'keywords',
        content:
          'manga reader, web manga reader, rtl manga reader, weebcentral reader, image proxy',
      },
      { property: 'og:type', content: 'website' },
      { property: 'og:title', content: HOME_TITLE },
      { property: 'og:description', content: HOME_DESCRIPTION },
      { property: 'og:url', content: SITE_URL },
      { property: 'og:locale', content: 'en_US' },
      { property: 'og:image', content: absoluteUrl(DEFAULT_OG_IMAGE_PATH) },
      { property: 'og:image:alt', content: 'Tsuki Reader icon' },
      { property: 'og:image:width', content: '512' },
      { property: 'og:image:height', content: '512' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: HOME_TITLE },
      { name: 'twitter:description', content: HOME_DESCRIPTION },
      { name: 'twitter:image', content: absoluteUrl(DEFAULT_OG_IMAGE_PATH) },
    ],
    links: [{ rel: 'canonical', href: canonicalUrl('/') }],
  }),
  component: LibraryPage,
})

function LibraryPage() {
  const remoteSeriesInputId = 'remote-series-url-input'
  const remoteSeriesHelpId = 'remote-series-url-help'
  const remoteSeriesErrorId = 'remote-series-url-error'
  const [history, setHistory] = useState<ReadingHistoryItem[]>([])
  const [hydrated, setHydrated] = useState(false)
  const [remoteInput, setRemoteInput] = useState('')
  const [isRemoteLoading, setIsRemoteLoading] = useState(false)
  const [remoteError, setRemoteError] = useState<string | null>(null)
  const [savedRemoteSeries, setSavedRemoteSeries] = useState<
    WeebcentralSeriesDTO[]
  >([])
  const [showOnboardingHint, setShowOnboardingHint] = useState(false)
  const [loadingLineIndex, setLoadingLineIndex] = useState(0)
  const [undoToast, setUndoToast] = useState<{
    item: WeebcentralSeriesDTO
    timer: number | null
  } | null>(null)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const dismissOnboardingHint = useCallback(() => {
    setShowOnboardingHint(false)

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(HOME_ONBOARDING_KEY, '1')
    }
  }, [])

  const refreshSideData = useCallback(() => {
    setHistory(
      loadReadingHistory().filter((item) => item.readerRoute === 'weebcentral'),
    )
    setSavedRemoteSeries(loadSavedWeebcentralSeries())
  }, [])

  useEffect(() => {
    refreshSideData()
    setHydrated(true)
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

  useEffect(() => {
    if (!isRemoteLoading) {
      setLoadingLineIndex(0)
      return
    }

    const timer = window.setInterval(() => {
      setLoadingLineIndex(
        (current) => (current + 1) % HOME_LOADING_LINES.length,
      )
    }, 900)

    return () => {
      window.clearInterval(timer)
    }
  }, [isRemoteLoading])

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
        remoteSeriesInputId,
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
  }, [remoteSeriesInputId])

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

  const handleRemoveSeries = useCallback(
    (item: WeebcentralSeriesDTO) => {
      if (undoToast?.timer) {
        window.clearTimeout(undoToast.timer)
      }
      removeSavedWeebcentralSeries(item.id)
      setSavedRemoteSeries(loadSavedWeebcentralSeries())
      const timer = window.setTimeout(() => setUndoToast(null), 5000)
      setUndoToast({ item, timer })
    },
    [undoToast],
  )

  const handleUndoRemove = useCallback(() => {
    if (undoToast) {
      if (undoToast.timer) {
        window.clearTimeout(undoToast.timer)
      }
      upsertSavedWeebcentralSeries(undoToast.item)
      setSavedRemoteSeries(loadSavedWeebcentralSeries())
      setUndoToast(null)
    }
  }, [undoToast])

  const recentHistory = history.slice(0, 6)
  const topHistory = recentHistory[0] ?? null
  const hasHistory = recentHistory.length > 0
  const totalSeries = savedRemoteSeries.length
  const savedRemoteSeriesById = useMemo(() => {
    const entries = new Map<string, WeebcentralSeriesDTO>()
    savedRemoteSeries.forEach((entry) => {
      entries.set(entry.id, entry)
    })
    return entries
  }, [savedRemoteSeries])
  const topHistoryCoverUrl = useMemo(() => {
    if (!topHistory) {
      return null
    }
    return savedRemoteSeriesById.get(topHistory.seriesId)?.coverUrl ?? null
  }, [savedRemoteSeriesById, topHistory])
  const homeTip = useMemo(() => {
    const now = new Date()
    const seed =
      now.getUTCFullYear() * 1000 +
      now.getUTCMonth() * 100 +
      now.getUTCDate() +
      totalSeries * 7 +
      recentHistory.length * 13
    const index = Math.abs(seed) % HOME_READING_TIPS.length
    return HOME_READING_TIPS[index]
  }, [recentHistory.length, totalSeries])

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
        const remoteMatch = savedRemoteSeriesById.get(item.seriesId)

        return {
          key: `remote:${item.seriesId}`,
          seriesId: item.seriesId,
          seriesTitle: item.seriesTitle ?? remoteMatch?.title ?? 'Series',
          chapterTitle: item.chapterTitle,
          pageIndex: item.pageIndex,
          completed: item.completed === true,
          coverUrl: remoteMatch?.coverUrl ?? null,
        }
      })
  }, [history, savedRemoteSeriesById])

  return (
    <div className="pb-10">
      <section className="exp-hero pb-8">
        <span className="issue-label">Library</span>
        <div className="mt-4 grid gap-5 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div>
            <h1 className="manga-title max-w-4xl text-3xl font-extrabold leading-tight text-foreground md:text-5xl">
              {hydrated && hasHistory
                ? 'Pick up where you left off'
                : 'Open a manga series and start reading'}
            </h1>
            <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
              {hydrated && hasHistory
                ? 'Resume a recent chapter or reopen any saved online series.'
                : 'Paste a WeebCentral or MangaDex series link to open its chapter list.'}
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {hydrated && topHistory ? (
                <Link
                  to="/weebcentral/$chapterId"
                  params={{ chapterId: topHistory.chapterId }}
                  search={{
                    seriesId: topHistory.seriesId,
                    seriesTitle: topHistory.seriesTitle,
                  }}
                  className="delight-cta inline-flex h-11 items-center bg-koten px-5 text-sm font-semibold text-[var(--active-contrast)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-koten"
                >
                  Continue reading
                </Link>
              ) : (
                <a
                  href="#proxy"
                  className="delight-cta inline-flex h-11 items-center bg-koten px-5 text-sm font-semibold text-[var(--active-contrast)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-koten"
                >
                  Open an online series
                </a>
              )}
            </div>
            <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1">
              <span className="exp-inline-stat">
                Saved series: <strong>{totalSeries}</strong>
              </span>
              <span className="exp-inline-stat">
                Recent reading sessions: <strong>{recentHistory.length}</strong>
              </span>
            </div>
            <p className="delight-tip mt-2 text-xs text-muted-foreground">
              {homeTip}
            </p>
            {showOnboardingHint ? (
              <div className="exp-note mt-3 justify-between text-sm">
                <p>
                  Start with <strong>Open an online series</strong>, then pick a
                  chapter.
                </p>
                <button
                  type="button"
                  onClick={dismissOnboardingHint}
                  className="inline-flex min-h-8 min-w-16 items-center justify-center px-2 text-xs font-semibold text-foreground underline decoration-border/60 underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-koten"
                >
                  Dismiss
                </button>
              </div>
            ) : null}
          </div>
          <div className="space-y-2">
            {hydrated && hasHistory && topHistory ? (
              <>
                <p className="exp-kicker">Your last read</p>
                <Link
                  to="/weebcentral-series/$seriesId"
                  params={{ seriesId: topHistory.seriesId }}
                  className="group flex items-start gap-3 rounded transition-colors hover:bg-washi focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-koten"
                >
                  {topHistoryCoverUrl ? (
                    <FadeImage
                      src={topHistoryCoverUrl}
                      alt="Last read manga cover"
                      className="cover-hover h-20 w-14 shrink-0 border border-border object-cover"
                      loading="lazy"
                      fetchPriority="auto"
                      decoding="async"
                      style={{
                        viewTransitionName: `cover-${topHistory.seriesId}`,
                      }}
                    />
                  ) : (
                    <div
                      className="flex h-20 w-14 shrink-0 items-center justify-center border border-border bg-surface-soft text-[10px] text-muted-foreground"
                      style={{
                        viewTransitionName: `cover-${topHistory.seriesId}`,
                      }}
                    >
                      No
                      <br />
                      image
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground group-hover:text-koten transition-colors">
                      {topHistory.chapterTitle}
                    </p>
                    {topHistory.seriesTitle ? (
                      <p className="truncate text-sm text-muted-foreground">
                        {topHistory.seriesTitle}
                      </p>
                    ) : null}
                    <p className="truncate text-xs text-muted-foreground">
                      Page {Math.max(1, topHistory.pageIndex + 1)}
                      {topHistory.completed === true ? ' · Completed' : ''}
                    </p>
                  </div>
                </Link>
                <p className="pt-1 text-xs text-muted-foreground">
                  Continue from above, or pick another series below.
                </p>
              </>
            ) : (
              <>
                <p className="exp-kicker">Quick start</p>
                <ol className="space-y-2 pt-1 text-sm text-muted-foreground">
                  <li className="flex gap-2">
                    <span className="text-koten font-semibold">1.</span>
                    <span>Open an online series</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-koten font-semibold">2.</span>
                    <span>Select a chapter</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-koten font-semibold">3.</span>
                    <span>Start reading</span>
                  </li>
                </ol>
                <p className="pt-2 text-xs text-muted-foreground">
                  No account required.
                </p>
              </>
            )}
          </div>
        </div>
      </section>

      {!hydrated || !hasHistory ? (
        <section className="deferred-section pb-8">
          <h2 className="manga-title text-lg font-bold text-foreground md:text-xl">
            No recent reads yet
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Start in one step: open an online series and choose a chapter.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href="#proxy"
              className="delight-cta inline-flex h-10 items-center border border-border bg-surface px-4 text-sm font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-koten"
            >
              Open an online series
            </a>
          </div>
        </section>
      ) : null}

      {hydrated && hasHistory ? (
        <section className="deferred-section scroll-reveal pb-10">
          <span className="issue-label">Continue</span>
          <div className="mt-2 flex items-center justify-between gap-3">
            <h2 className="manga-title text-xl font-bold tracking-tight text-foreground md:text-2xl">
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
                className="group exp-row h-full min-h-28 items-stretch"
              >
                {item.coverUrl ? (
                  <FadeImage
                    src={item.coverUrl}
                    alt={`${item.seriesTitle} cover`}
                    className="cover-hover h-full w-20 shrink-0 self-stretch border border-border object-cover"
                    loading="lazy"
                    decoding="async"
                    fetchPriority="low"
                    style={{ viewTransitionName: `cover-${item.seriesId}` }}
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
                    Last read: {item.chapterTitle} · Page{' '}
                    {Math.max(1, item.pageIndex + 1)}
                    {item.completed ? ' · Completed' : ''}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <div className="manga-divider" aria-hidden />

      <section id="proxy" className="scroll-reveal pt-6 pb-8">
        <span className="issue-label">Online</span>
        <h2 className="manga-title mt-2 text-xl font-bold tracking-tight text-foreground md:text-2xl">
          Open an online series
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Paste a WeebCentral or MangaDex series link, then choose the chapter
          you want to read.
        </p>
        <label
          htmlFor={remoteSeriesInputId}
          className="mt-4 block text-xs font-semibold uppercase tracking-[0.08em] text-foreground"
        >
          Series URL
        </label>
        <p
          id={remoteSeriesHelpId}
          className="mt-1 text-xs text-muted-foreground"
        >
          Paste the series page URL from WeebCentral or MangaDex. Press{' '}
          <kbd className="delight-kbd">/</kbd> to jump here from anywhere on the
          page.
        </p>

        <form
          className="mt-2 flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault()
            void loadRemoteSeries()
          }}
        >
          <Input
            id={remoteSeriesInputId}
            type="url"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="url"
            spellCheck={false}
            value={remoteInput}
            onChange={(event) => setRemoteInput(event.target.value)}
            placeholder="Paste WeebCentral or MangaDex series link"
            aria-invalid={remoteError ? true : undefined}
            aria-describedby={
              remoteError
                ? `${remoteSeriesHelpId} ${remoteSeriesErrorId}`
                : remoteSeriesHelpId
            }
          />
          <Button
            type="submit"
            variant="soft"
            className="delight-cta sm:w-28"
            disabled={isRemoteLoading}
          >
            {isRemoteLoading ? 'Opening…' : 'Open series'}
          </Button>
        </form>

        {isRemoteLoading ? (
          <p className="delight-loading-note mt-2 text-xs text-muted-foreground">
            {HOME_LOADING_LINES[loadingLineIndex]}
          </p>
        ) : null}

        {remoteError ? (
          <p
            id={remoteSeriesErrorId}
            role="alert"
            aria-live="assertive"
            className="mt-2 text-sm text-destructive"
          >
            {remoteError}
          </p>
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
                    <FadeImage
                      className="cover-hover h-20 w-14 shrink-0 border border-border object-cover"
                      src={item.coverUrl}
                      alt={`${item.title} cover`}
                      loading="lazy"
                      decoding="async"
                      fetchPriority="low"
                      style={{ viewTransitionName: `cover-${item.id}` }}
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
                  size="icon"
                  className="size-8 text-destructive/90 hover:text-destructive"
                  aria-label={`Remove saved series ${item.title}`}
                  title={`Remove saved series ${item.title}`}
                  onClick={() => handleRemoveSeries(item)}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </article>
            ))}
          </div>
        ) : null}
      </section>

      <section className="deferred-section scroll-reveal pt-4 pb-6 space-y-3">
        <span className="issue-label">More</span>
        <details className="exp-details-panel px-3 py-2">
          <summary className="exp-details-summary">
            Install Tsuki for faster launches
          </summary>
          <p className="mt-2 text-sm text-muted-foreground">
            Add Tsuki to your device so it opens like a focused reading app.
          </p>
          <div className="exp-details-grid mt-3">
            <article className="exp-guide-card p-3">
              <div className="mb-2 flex items-center gap-2 text-foreground">
                <Smartphone className="h-4 w-4" aria-hidden />
                <p className="text-sm font-semibold">iPhone / iPad</p>
              </div>
              <ol className="space-y-1 text-xs text-muted-foreground">
                <li>1. Open Tsuki in Safari.</li>
                <li className="inline-flex items-center gap-1">
                  2. Tap <Share2 className="h-3.5 w-3.5" aria-hidden /> Share.
                </li>
                <li>3. Tap Add to Home Screen.</li>
                <li>4. Open from your Home Screen.</li>
              </ol>
            </article>
            <article className="exp-guide-card p-3">
              <div className="mb-2 flex items-center gap-2 text-foreground">
                <Smartphone className="h-4 w-4" aria-hidden />
                <p className="text-sm font-semibold">Android</p>
              </div>
              <ol className="flex flex-col space-y-1 text-xs text-muted-foreground">
                <li>1. Open Tsuki in Chrome.</li>
                <li className="inline-flex items-center gap-1">
                  2. Tap{' '}
                  <EllipsisVertical className="h-3.5 w-3.5" aria-hidden />
                  menu.
                </li>
                <li className="inline-flex items-center gap-1">
                  3. Tap <Download className="h-3.5 w-3.5" aria-hidden />{' '}
                  Install app.
                </li>
                <li>4. Launch from your app drawer.</li>
              </ol>
            </article>
            <article className="exp-guide-card p-3">
              <div className="mb-2 flex items-center gap-2 text-foreground">
                <Monitor className="h-4 w-4" aria-hidden />
                <p className="text-sm font-semibold">Desktop (PC / Mac)</p>
              </div>
              <ol className="space-y-1 text-xs text-muted-foreground">
                <li>1. Open Tsuki in Chrome or Edge.</li>
                <li>2. Click the install icon in the address bar.</li>
                <li>3. Confirm Install.</li>
                <li>4. Open Tsuki from apps/start menu.</li>
              </ol>
            </article>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Tip: once installed, Tsuki opens without browser tabs for a cleaner
            reader view.
          </p>
        </details>
        <details className="exp-details-panel px-3 py-2">
          <summary className="exp-details-summary">
            What Tsuki is built for
          </summary>
          <p className="mt-2 text-sm text-muted-foreground">
            Tsuki is a web manga reader focused on fast page turns, clean
            typography, and a minimal old-school reading layout.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Built for keyboard and touch reading, with persistent progress and
            installable PWA support.
          </p>
        </details>
      </section>

      {undoToast ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 animate-enter"
        >
          <div className="flex items-center gap-3 rounded border border-border bg-surface px-4 py-2.5 text-sm shadow-lg">
            <span className="text-foreground">
              Removed <strong>{undoToast.item.title}</strong>
            </span>
            <button
              type="button"
              className="text-xs font-semibold text-koten underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-koten"
              onClick={handleUndoRemove}
            >
              Undo
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
