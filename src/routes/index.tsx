import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'

const createAnyFileRoute = createFileRoute as any
import { useCallback, useEffect, useMemo, useState } from 'react'

import { Button } from '#/components/ui/button'
import { FilePickerButton } from '#/components/ui/file-picker-button'
import { Input } from '#/components/ui/input'
import type {
  LibrarySeries,
  ReadingHistoryItem,
  WeebcentralSeriesDTO,
} from '#/lib/contracts'
import { fetchJson } from '#/lib/http-client'
import { loadReadingHistory } from '#/lib/reading-history'
import { cn } from '#/lib/utils'

const HOME_ONBOARDING_KEY = 'tsuki-home-onboarding-dismissed.v1'
import {
  loadSavedWeebcentralSeries,
  removeSavedWeebcentralSeries,
} from '#/lib/weebcentral-library'

export const Route = createAnyFileRoute('/')({ component: LibraryPage })

function LibraryPage() {
  const [series, setSeries] = useState<LibrarySeries[]>([])
  const [history, setHistory] = useState<ReadingHistoryItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isUploading, setIsUploading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [remoteInput, setRemoteInput] = useState('')
  const [isRemoteLoading, setIsRemoteLoading] = useState(false)
  const [remoteError, setRemoteError] = useState<string | null>(null)
  const [removingSeriesId, setRemovingSeriesId] = useState<string | null>(null)
  const [savedRemoteSeries, setSavedRemoteSeries] = useState<
    WeebcentralSeriesDTO[]
  >([])
  const [showOnboardingHint, setShowOnboardingHint] = useState(false)
  const navigate = useNavigate()

  const dismissOnboardingHint = useCallback(() => {
    setShowOnboardingHint(false)

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(HOME_ONBOARDING_KEY, '1')
    }
  }, [])

  const loadSeries = useCallback(async () => {
    setIsLoading(true)

    try {
      const payload = await fetchJson<LibrarySeries[]>('/api/series')
      setSeries(payload)
      setError(null)
    } catch (requestError) {
      void requestError
      setError('Could not load your library right now.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  const refreshSideData = useCallback(() => {
    setHistory(loadReadingHistory())
    setSavedRemoteSeries(loadSavedWeebcentralSeries())
  }, [])

  useEffect(() => {
    void loadSeries()
    refreshSideData()
  }, [loadSeries, refreshSideData])

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

  const uploadArchive = useCallback(
    async (archive: File) => {
      if (!archive) {
        return
      }

      setIsUploading(true)
      setError(null)

      try {
        const formData = new FormData()
        formData.append('archive', archive)

        const response = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
        })

        if (!response.ok) {
          const payload = (await response.json()) as { error?: string }
          throw new Error(payload.error ?? 'Upload failed')
        }

        await loadSeries()
        dismissOnboardingHint()
      } catch (uploadError) {
        void uploadError
        setError('Could not upload that file. Please try another .cbz or .zip.')
      } finally {
        setIsUploading(false)
      }
    },
    [dismissOnboardingHint, loadSeries],
  )

  const libraryStats = useMemo(() => {
    const chapterCount = series.reduce(
      (total, item) => total + item.chapterCount,
      0,
    )

    return {
      seriesCount: series.length,
      chapterCount,
    }
  }, [series])

  const loadRemoteSeries = useCallback(async () => {
    const inputValue = remoteInput.trim()

    if (inputValue.length === 0) {
      setRemoteError('Paste a WeebCentral link first')
      return
    }

    setIsRemoteLoading(true)
    setRemoteError(null)

    try {
      const payload = await fetchJson<WeebcentralSeriesDTO>(
        `/v1/weebcentral/series?url=${encodeURIComponent(inputValue)}`,
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
  }, [dismissOnboardingHint, navigate, remoteInput])

  const removeSeries = useCallback(
    async (seriesId: string, title: string) => {
      const confirmed = window.confirm(
        `Remove "${title}" from your files list?`,
      )
      if (!confirmed) {
        return
      }

      setRemovingSeriesId(seriesId)
      setError(null)

      try {
        const response = await fetch(`/api/series/${seriesId}`, {
          method: 'DELETE',
        })

        if (!response.ok) {
          const payload = (await response.json()) as { error?: string }
          throw new Error(payload.error ?? 'Failed to remove series')
        }

        await loadSeries()
      } catch (removeError) {
        void removeError
        setError('Could not remove this series right now.')
      } finally {
        setRemovingSeriesId(null)
      }
    },
    [loadSeries],
  )

  const removeRemoteSeriesFromLibrary = useCallback((seriesId: string) => {
    removeSavedWeebcentralSeries(seriesId)
    setSavedRemoteSeries(loadSavedWeebcentralSeries())
  }, [])

  const recentHistory = history.slice(0, 6)
  const topHistory = recentHistory[0] ?? null
  const hasHistory = recentHistory.length > 0
  const totalSeries = libraryStats.seriesCount + savedRemoteSeries.length
  const topHistoryCoverUrl = useMemo(() => {
    if (!topHistory) {
      return null
    }

    if (topHistory.readerRoute === 'weebcentral') {
      const remoteMatch = savedRemoteSeries.find(
        (entry) => entry.id === topHistory.seriesId,
      )
      return remoteMatch?.coverUrl ?? null
    }

    const localMatch = series.find((entry) => entry.id === topHistory.seriesId)
    if (!localMatch?.coverChapterId || localMatch.coverPageIndex === null) {
      return null
    }

    return `/api/image/${localMatch.coverChapterId}/${localMatch.coverPageIndex}?thumb=1`
  }, [savedRemoteSeries, series, topHistory])

  const recentSeriesCards = useMemo(() => {
    const seen = new Set<string>()

    return history
      .filter((item) => {
        const route = item.readerRoute ?? 'local'
        const key = `${route}:${item.seriesId}`
        if (seen.has(key)) {
          return false
        }
        seen.add(key)
        return true
      })
      .slice(0, 6)
      .map((item) => {
        const route = item.readerRoute ?? 'local'

        if (route === 'weebcentral') {
          const remoteMatch = savedRemoteSeries.find(
            (entry) => entry.id === item.seriesId,
          )

          return {
            key: `${route}:${item.seriesId}`,
            route,
            chapterId: item.chapterId,
            seriesId: item.seriesId,
            seriesTitle: item.seriesTitle ?? remoteMatch?.title ?? 'Series',
            chapterTitle: item.chapterTitle,
            coverUrl: remoteMatch?.coverUrl ?? null,
          }
        }

        const localMatch = series.find((entry) => entry.id === item.seriesId)
        const localCoverUrl =
          localMatch?.coverChapterId && localMatch.coverPageIndex !== null
            ? `/api/image/${localMatch.coverChapterId}/${localMatch.coverPageIndex}?thumb=1`
            : null

        return {
          key: `${route}:${item.seriesId}`,
          route,
          chapterId: item.chapterId,
          seriesId: item.seriesId,
          seriesTitle: item.seriesTitle ?? localMatch?.title ?? 'Series',
          chapterTitle: item.chapterTitle,
          coverUrl: localCoverUrl,
        }
      })
  }, [history, savedRemoteSeries, series])

  return (
    <div className="space-y-5 pb-10">
      <section
        className="exp-hero animate-enter"
        style={{ animationDelay: '20ms' }}
      >
        <span className="issue-label">Start here</span>
        <div className="mt-3 grid gap-4 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div>
            <h1 className="manga-title max-w-4xl text-3xl font-semibold leading-tight text-foreground md:text-5xl">
              {hasHistory
                ? 'Welcome back. Keep reading.'
                : 'Read manga without the noise'}
            </h1>
            <p className="manga-subtitle mt-3 max-w-2xl text-sm text-muted-foreground md:text-base">
              {hasHistory
                ? 'Your recent chapters are ready below. You can also switch to online or files anytime.'
                : 'Open from a link or from your files. Your place is saved automatically.'}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {topHistory ? (
                topHistory.readerRoute === 'weebcentral' ? (
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
                  <Link
                    to="/reader/$chapterId"
                    params={{ chapterId: topHistory.chapterId }}
                    className="inline-flex h-10 items-center border-2 border-primary bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-[2px_2px_0_var(--shadow)]"
                  >
                    Continue reading
                  </Link>
                )
              ) : (
                <a
                  href="#proxy"
                  className="inline-flex h-10 items-center border-2 border-primary bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-[2px_2px_0_var(--shadow)]"
                >
                  Start online
                </a>
              )}
              <a
                href="#local"
                className="inline-flex h-10 items-center border-2 border-border bg-surface px-4 text-sm font-semibold text-foreground"
              >
                Add your files
              </a>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              {totalSeries} saved series • {libraryStats.chapterCount} chapters
              • {recentHistory.length} recent reads
            </p>
            {showOnboardingHint ? (
              <div className="mt-3 flex items-start justify-between gap-3 border border-border/70 bg-surface-soft px-3 py-2 text-sm text-muted-foreground">
                <p>
                  New here? Start with <strong>Read online</strong> or{' '}
                  <strong>Add your files</strong>.
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
                <div className="flex items-start gap-3">
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
                    <p className="truncate text-sm font-medium text-foreground">
                      {topHistory.chapterTitle}
                    </p>
                    {topHistory.seriesTitle ? (
                      <p className="truncate text-sm text-muted-foreground">
                        {topHistory.seriesTitle}
                      </p>
                    ) : null}
                  </div>
                </div>
                <p className="pt-1 text-xs text-muted-foreground">
                  Tip: Continue above, or jump to a new series below.
                </p>
              </>
            ) : (
              <>
                <p className="exp-kicker">How it works</p>
                <p className="text-sm text-muted-foreground">
                  1. Choose online or files
                </p>
                <p className="text-sm text-muted-foreground">
                  2. Open any chapter
                </p>
                <p className="text-sm text-muted-foreground">3. Keep reading</p>
                <p className="pt-1 text-xs text-muted-foreground">
                  No setup, no account, no distractions.
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
            Start in one step: open an online series or add your local files.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href="#proxy"
              className="inline-flex h-9 items-center border border-border bg-surface px-3 text-sm font-semibold text-foreground"
            >
              Read online
            </a>
            <a
              href="#local"
              className="inline-flex h-9 items-center border border-border bg-surface px-3 text-sm font-semibold text-foreground"
            >
              Add file
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
                to={
                  item.route === 'weebcentral'
                    ? '/weebcentral/$chapterId'
                    : '/reader/$chapterId'
                }
                params={{ chapterId: item.chapterId }}
                search={
                  item.route === 'weebcentral'
                    ? { seriesId: item.seriesId, seriesTitle: item.seriesTitle }
                    : undefined
                }
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
                  <p className="truncate text-sm font-semibold text-foreground md:text-base">
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
          Paste a WeebCentral series link, then pick a chapter.
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
            placeholder="Paste WeebCentral series link"
          />
          <Button
            type="submit"
            variant="soft"
            className="sm:w-28"
            disabled={isRemoteLoading}
          >
            {isRemoteLoading ? 'Loading…' : 'Search'}
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
                  onClick={() => removeRemoteSeriesFromLibrary(item.id)}
                >
                  Remove series
                </Button>
              </article>
            ))}
          </div>
        ) : null}
      </section>

      <section
        id="local"
        className="exp-surface-soft animate-enter"
        style={{ animationDelay: '115ms' }}
      >
        <span className="issue-label">Files</span>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h2 className="manga-title text-xl font-semibold tracking-tight text-foreground md:text-2xl">
            Add from your files
          </h2>

          <FilePickerButton
            variant="soft"
            accept=".cbz,.zip"
            onFileSelect={(file) => {
              void uploadArchive(file)
            }}
            disabled={isUploading}
          >
            {isUploading ? 'Importing…' : 'Add file'}
          </FilePickerButton>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Drag and drop a .cbz or .zip file, or click Add file.
        </p>

        <div
          className={cn(
            'exp-dropzone mt-4 transition-colors duration-150',
            isDragging ? 'bg-surface' : '',
          )}
          onDragEnter={(event) => {
            event.preventDefault()
            setIsDragging(true)
          }}
          onDragOver={(event) => {
            event.preventDefault()
            setIsDragging(true)
          }}
          onDragLeave={(event) => {
            event.preventDefault()
            if (event.currentTarget === event.target) {
              setIsDragging(false)
            }
          }}
          onDrop={(event) => {
            event.preventDefault()
            setIsDragging(false)

            const file = event.dataTransfer.files?.[0]
            if (file) {
              void uploadArchive(file)
            }
          }}
        >
          <p className="text-sm text-muted-foreground">
            Drop a .cbz or .zip file here
          </p>
        </div>

        {error ? (
          <p className="mt-2 text-sm text-destructive">{error}</p>
        ) : null}

        {isLoading ? (
          <div className="mt-2 exp-surface px-4 py-5 text-sm text-muted-foreground">
            Loading your library…
          </div>
        ) : null}

        {!isLoading && series.length === 0 ? (
          <div className="mt-2 exp-surface px-4 py-5 text-sm text-muted-foreground">
            No manga in your files yet.
          </div>
        ) : null}

        {!isLoading ? (
          <div className="mt-2 space-y-1.5">
            {series.map((item) => (
              <article key={item.id} className="exp-row">
                <Link
                  to="/series/$seriesId"
                  params={{ seriesId: item.id }}
                  className="group flex min-w-0 flex-1 items-center gap-3"
                >
                  {item.coverChapterId !== null &&
                  item.coverPageIndex !== null ? (
                    <img
                      className="h-20 w-14 shrink-0 border border-border object-cover"
                      src={`/api/image/${item.coverChapterId}/${item.coverPageIndex}?thumb=1`}
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
                    <p className="line-clamp-1 text-sm text-muted-foreground">
                      {item.description ?? 'No summary yet.'}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.chapterCount} chapters
                    </p>
                  </div>
                </Link>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => removeSeries(item.id, item.title)}
                  disabled={removingSeriesId === item.id}
                >
                  {removingSeriesId === item.id ? 'Removing…' : 'Remove series'}
                </Button>
              </article>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  )
}
