import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  Download,
  EllipsisVertical,
  Monitor,
  Search,
  Share2,
  Smartphone,
  Trash2,
  X,
} from 'lucide-react'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '#/components/ui/button'
import { FadeImage } from '#/components/ui/fade-image'
import { Input } from '#/components/ui/input'
import type { ReadingHistoryItem, SavedSeriesSummary } from '#/lib/contracts'
import { weebcentralSearchQueryOptions } from '#/lib/query-options'
import { loadReadingHistory } from '#/lib/reading-history'
import {
  absoluteUrl,
  canonicalUrl,
  DEFAULT_OG_IMAGE_PATH,
  SITE_URL,
} from '#/lib/seo'
import {
  downloadExport,
  exportAllData,
  importData,
  validateImportData,
} from '#/lib/export-import'
const HOME_ONBOARDING_KEY = 'tsuki-home-onboarding-dismissed.v1'
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
  const searchInputId = 'search-series-input'
  const [history, setHistory] = useState<ReadingHistoryItem[]>([])
  const [hydrated, setHydrated] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [savedRemoteSeries, setSavedRemoteSeries] = useState<
    SavedSeriesSummary[]
  >([])
  const [showOnboardingHint, setShowOnboardingHint] = useState(false)
  const [undoToast, setUndoToast] = useState<{
    item: SavedSeriesSummary
    timer: number | null
  } | null>(null)
  const [libraryFilter, setLibraryFilter] = useState('')
  const [librarySort, setLibrarySort] = useState<'title' | 'recent' | 'chapters'>('recent')
  const [importMessage, setImportMessage] = useState<string | null>(null)
  const debounceTimer = useRef<number | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)

  const { data: searchResults, isFetching: isSearching } = useQuery({
    ...weebcentralSearchQueryOptions(debouncedQuery),
  })

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
    if (debounceTimer.current !== null) {
      window.clearTimeout(debounceTimer.current)
    }
    debounceTimer.current = window.setTimeout(() => {
      setDebouncedQuery(searchQuery.trim())
    }, 300)
    return () => {
      if (debounceTimer.current !== null) {
        window.clearTimeout(debounceTimer.current)
      }
    }
  }, [searchQuery])

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
        searchInputId,
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
  }, [searchInputId])

  const handleRemoveSeries = useCallback(
    (item: SavedSeriesSummary) => {
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
    const entries = new Map<string, SavedSeriesSummary>()
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

  const completedChaptersBySeriesId = useMemo(() => {
    const counts = new Map<string, number>()
    for (const h of history) {
      if (h.completed === true) {
        counts.set(h.seriesId, (counts.get(h.seriesId) ?? 0) + 1)
      }
    }
    return counts
  }, [history])

  const filteredLibrarySeries = useMemo(() => {
    let list = savedRemoteSeries

    const query = libraryFilter.trim().toLowerCase()
    if (query) {
      list = list.filter((s) => s.title.toLowerCase().includes(query))
    }

    const sorted = [...list]
    switch (librarySort) {
      case 'title':
        sorted.sort((a, b) => a.title.localeCompare(b.title))
        break
      case 'chapters':
        sorted.sort((a, b) => b.chapterCount - a.chapterCount)
        break
      case 'recent':
      default:
        sorted.sort((a, b) => b.savedAt - a.savedAt)
        break
    }

    return sorted
  }, [savedRemoteSeries, libraryFilter, librarySort])

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
                ? 'Resume a recent chapter or browse your saved series.'
                : 'Search for a WeebCentral series below and start reading.'}
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
                  Search for a series
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
                  Start with <strong>Search for a series</strong>, then pick a
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
                    <span>Search for a series</span>
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
            Search for a series below to get started.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href="#proxy"
              className="delight-cta inline-flex h-10 items-center border border-border bg-surface px-4 text-sm font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-koten"
            >
              Search for a series
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
        <span className="issue-label">Search</span>
        <h2 className="manga-title mt-2 text-xl font-bold tracking-tight text-foreground md:text-2xl">
          Find a series to read
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Search by title to find a WeebCentral series. Press{' '}
          <kbd className="delight-kbd">/</kbd> to focus search.
        </p>
        <div className="relative mt-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            id={searchInputId}
            type="search"
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search manga series…"
            className="h-12 pl-10 pr-4"
          />
          {searchQuery.length > 0 ? (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>

        {debouncedQuery.length >= 2 && isSearching ? (
          <div className="mt-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <div className="size-3 animate-spin rounded-full border border-current border-t-transparent" />
              Searching…
            </div>
          </div>
        ) : null}

        {debouncedQuery.length >= 2 && !isSearching && searchResults && searchResults.length > 0 ? (
          <div className="mt-3 space-y-1.5">
            <p className="text-xs text-muted-foreground">
              Found {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
            </p>
            {searchResults.map((result) => (
              <Link
                key={`search:${result.id}`}
                to="/weebcentral-series/$seriesId"
                params={{ seriesId: result.id }}
                className="exp-row group flex items-center gap-3"
              >
                {result.coverUrl ? (
                  <FadeImage
                    className="cover-hover h-20 w-14 shrink-0 border border-border object-cover"
                    src={result.coverUrl}
                    alt={`${result.title} cover`}
                    loading="lazy"
                    decoding="async"
                    fetchPriority="low"
                    style={{ viewTransitionName: `cover-${result.id}` }}
                  />
                ) : (
                  <div className="flex h-20 w-14 shrink-0 items-center justify-center border border-border bg-surface-soft text-[10px] text-muted-foreground">
                    No img
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <h4 className="truncate text-sm font-semibold text-foreground transition-colors group-hover:text-primary md:text-base">
                    {result.title}
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    {result.year ? `${result.year} · ` : ''}WeebCentral
                    {result.chapterCount ? ` · ${result.chapterCount} chapters` : ''}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        ) : null}

        {debouncedQuery.length >= 2 && !isSearching && searchResults && searchResults.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No results found for &ldquo;{debouncedQuery}&rdquo;. Try a different search term.
          </p>
        ) : null}

        {savedRemoteSeries.length > 0 ? (
          <div className="mt-5 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                Saved series
                {filteredLibrarySeries.length < savedRemoteSeries.length
                  ? ` (${filteredLibrarySeries.length} shown)`
                  : ''}
              </p>
              <div className="flex items-center gap-1.5">
                <Input
                  value={libraryFilter}
                  onChange={(e) => setLibraryFilter(e.target.value)}
                  placeholder="Filter saved…"
                  className="h-7 w-32 text-xs"
                />
                <select
                  value={librarySort}
                  onChange={(e) => setLibrarySort(e.target.value as 'title' | 'recent' | 'chapters')}
                  className="h-7 rounded border border-border bg-surface px-1.5 text-xs text-foreground"
                  aria-label="Sort order"
                >
                  <option value="recent">Recent</option>
                  <option value="title">Title</option>
                  <option value="chapters">Chapters</option>
                </select>
              </div>
            </div>
            {filteredLibrarySeries.map((item) => {
              const completedCount = completedChaptersBySeriesId.get(item.id) ?? 0
              const progress = item.chapterCount > 0 ? completedCount / item.chapterCount : 0

              return (
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
                    <div className="min-w-0 flex-1">
                      <h4 className="truncate text-sm font-semibold text-foreground transition-colors group-hover:text-primary md:text-base">
                        {item.title}
                      </h4>
                      <p className="text-xs text-muted-foreground">
                        {item.chapterCount} chapters
                        {completedCount > 0 ? ` · ${completedCount} read` : ''}
                      </p>
                      {item.chapterCount > 0 ? (
                        <div className="mt-1 h-1 w-24 rounded-full bg-border" role="progressbar" aria-valuenow={completedCount} aria-valuemin={0} aria-valuemax={item.chapterCount} aria-label={`${Math.round(progress * 100)}% read`}>
                          <div
                            className="h-full rounded-full bg-koten transition-all"
                            style={{ width: `${Math.min(100, Math.round(progress * 100))}%` }}
                          />
                        </div>
                      ) : null}
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
              )
            })}
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
        <details className="exp-details-panel px-3 py-2">
          <summary className="exp-details-summary">
            Data management
          </summary>
          <p className="mt-2 text-sm text-muted-foreground">
            Export your library, reading history, and progress as a JSON file.
            Import a backup to restore your data on another device or after
            clearing browser data.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="soft"
              size="sm"
              onClick={() => {
                const data = exportAllData()
                downloadExport(data)
              }}
            >
              Export data
            </Button>
            <input
              ref={importInputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={async (event) => {
                const file = event.target.files?.[0]
                if (!file) return
                setImportMessage(null)
                try {
                  const text = await file.text()
                  const parsed = JSON.parse(text)
                  if (!validateImportData(parsed)) {
                    setImportMessage('Invalid backup file format.')
                    return
                  }
                  const count = importData(parsed)
                  setImportMessage(
                    `Imported ${count} item${count !== 1 ? 's' : ''}. Reloading page…`,
                  )
                  refreshSideData()
                  setTimeout(() => window.location.reload(), 1500)
                } catch {
                  setImportMessage('Could not read the file. Please try again.')
                }
                event.target.value = ''
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => importInputRef.current?.click()}
            >
              Import data
            </Button>
          </div>
          {importMessage ? (
            <p className="mt-2 text-xs text-muted-foreground">{importMessage}</p>
          ) : null}
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
