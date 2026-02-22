import { createFileRoute, Link } from '@tanstack/react-router'

const createAnyFileRoute = createFileRoute as any
import { useCallback, useEffect, useMemo, useState } from 'react'

import type {
  LibrarySeries,
  ReadingHistoryItem,
  WeebcentralSeriesDTO,
} from '#/lib/contracts'
import { Button, buttonVariants } from '#/components/ui/button'
import { FilePickerButton } from '#/components/ui/file-picker-button'
import { Input } from '#/components/ui/input'
import { fetchJson } from '#/lib/http-client'
import { loadReadingHistory } from '#/lib/reading-history'
import { cn } from '#/lib/utils'
import {
  loadSavedWeebcentralSeries,
  removeSavedWeebcentralSeries,
  upsertSavedWeebcentralSeries,
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
  const [remoteSeries, setRemoteSeries] = useState<WeebcentralSeriesDTO | null>(
    null,
  )
  const [isRemoteLoading, setIsRemoteLoading] = useState(false)
  const [remoteError, setRemoteError] = useState<string | null>(null)
  const [removingSeriesId, setRemovingSeriesId] = useState<string | null>(null)
  const [savedRemoteSeries, setSavedRemoteSeries] = useState<
    WeebcentralSeriesDTO[]
  >([])

  const loadSeries = useCallback(async () => {
    setIsLoading(true)

    try {
      const payload = await fetchJson<LibrarySeries[]>('/api/series')
      setSeries(payload)
      setError(null)
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Failed to load library',
      )
    } finally {
      setIsLoading(false)
    }
  }, [])

  const refreshHistory = useCallback(() => {
    setHistory(loadReadingHistory())
    setSavedRemoteSeries(loadSavedWeebcentralSeries())
  }, [])

  useEffect(() => {
    void loadSeries()
    refreshHistory()
  }, [loadSeries, refreshHistory])

  useEffect(() => {
    const onFocus = () => {
      refreshHistory()
    }

    window.addEventListener('focus', onFocus)

    return () => {
      window.removeEventListener('focus', onFocus)
    }
  }, [refreshHistory])

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
      } catch (uploadError) {
        setError(
          uploadError instanceof Error ? uploadError.message : 'Upload failed',
        )
      } finally {
        setIsUploading(false)
      }
    },
    [loadSeries],
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
      setRemoteSeries(null)
      setRemoteError('Enter a WeebCentral URL or id')
      return
    }

    setIsRemoteLoading(true)
    setRemoteError(null)

    try {
      const payload = await fetchJson<WeebcentralSeriesDTO>(
        `/v1/weebcentral/series?url=${encodeURIComponent(inputValue)}`,
      )
      setRemoteSeries(payload)
    } catch (requestError) {
      setRemoteSeries(null)
      setRemoteError(
        requestError instanceof Error
          ? requestError.message
          : 'Failed to load WeebCentral series',
      )
    } finally {
      setIsRemoteLoading(false)
    }
  }, [remoteInput])

  const removeSeries = useCallback(
    async (seriesId: string, title: string) => {
      const confirmed = window.confirm(`Remove "${title}" from your library?`)
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
        setError(
          removeError instanceof Error
            ? removeError.message
            : 'Failed to remove series',
        )
      } finally {
        setRemovingSeriesId(null)
      }
    },
    [loadSeries],
  )

  const saveRemoteSeriesToLibrary = useCallback(
    (seriesToSave: WeebcentralSeriesDTO) => {
      upsertSavedWeebcentralSeries(seriesToSave)
      setSavedRemoteSeries(loadSavedWeebcentralSeries())
    },
    [],
  )

  const removeRemoteSeriesFromLibrary = useCallback((seriesId: string) => {
    removeSavedWeebcentralSeries(seriesId)
    setSavedRemoteSeries(loadSavedWeebcentralSeries())
  }, [])

  return (
    <div className="minimal-layout grid gap-4 lg:grid-cols-[320px_1fr]">
      <aside
        className="animate-enter rounded-2xl border border-border bg-surface/95 p-5 shadow-[0_16px_30px_-26px_var(--shadow)]"
        style={{ animationDelay: '20ms' }}
      >
        <h2 className="text-lg font-semibold tracking-wide text-foreground">
          Import
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Drag a CBZ/ZIP file here or choose one.
        </p>

        <div
          className={`mt-4 rounded-2xl border-2 border-dashed p-5 text-center transition ${
            isDragging
              ? 'border-primary bg-primary/10'
              : 'border-border-strong bg-surface-soft'
          }`}
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
          <p className="text-sm text-muted-foreground">Drop archive</p>
          <FilePickerButton
            variant="soft"
            className="mt-3 rounded-full"
            accept=".cbz,.zip"
            onFileSelect={(file) => {
              void uploadArchive(file)
            }}
            disabled={isUploading}
          >
            {isUploading ? 'Importing…' : 'Choose file'}
          </FilePickerButton>
        </div>

        {history.length > 0 ? (
          <div className="mt-6">
            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              History
            </h3>
            <div className="mt-2 space-y-2">
              {history.slice(0, 6).map((item) => (
                <Link
                  key={`${item.readerRoute ?? 'local'}:${item.chapterId}`}
                  to={
                    item.readerRoute === 'weebcentral'
                      ? '/weebcentral/$chapterId'
                      : '/reader/$chapterId'
                  }
                  params={{ chapterId: item.chapterId }}
                  search={
                    item.readerRoute === 'weebcentral'
                      ? {
                          seriesId: item.seriesId,
                          seriesTitle: item.seriesTitle,
                        }
                      : undefined
                  }
                  className="animate-enter group block rounded-xl border border-border bg-surface px-3 py-2 transition-colors duration-200 hover:border-primary/50 hover:bg-primary/5"
                  style={{ animationDelay: `${80 + item.pageIndex * 20}ms` }}
                >
                  <p className="truncate text-sm font-medium text-foreground group-hover:text-primary">
                    {item.chapterTitle}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {item.readerRoute === 'weebcentral' ? 'WeebCentral · ' : ''}
                    Page {item.pageIndex + 1} · {item.mode}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        ) : null}

        {error ? (
          <p className="mt-4 text-sm text-destructive">{error}</p>
        ) : null}
      </aside>

      <section className="space-y-4">
        <div
          className="animate-enter rounded-2xl border border-border bg-surface/95 p-4 shadow-[0_16px_30px_-26px_var(--shadow)]"
          style={{ animationDelay: '50ms' }}
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-2xl font-semibold text-foreground">Library</h2>
            <p className="rounded-full border border-border bg-surface-soft px-3 py-1 text-xs text-muted-foreground">
              {libraryStats.seriesCount} series · {libraryStats.chapterCount}{' '}
              chapters
            </p>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Dive in from right to left.
          </p>
        </div>

        <div
          className="animate-enter rounded-2xl border border-border bg-surface/95 p-4 shadow-[0_16px_30px_-26px_var(--shadow)]"
          style={{ animationDelay: '90ms' }}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">
                WeebCentral Proxy
              </p>
              <h3 className="mt-1 text-xl font-semibold text-foreground">
                Load Remote Series
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Paste a series/chapter URL or id, then read chapters through the
                secure proxy.
              </p>
            </div>
          </div>

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
              placeholder="https://weebcentral.com/... or chapter/series id"
            />
            <Button
              type="submit"
              variant="soft"
              className="border-primary/45 text-primary hover:bg-primary/20"
              disabled={isRemoteLoading}
            >
              {isRemoteLoading ? 'Loading…' : 'Load'}
            </Button>
          </form>

          {remoteError ? (
            <p className="mt-2 text-sm text-destructive">{remoteError}</p>
          ) : null}

          {remoteSeries ? (
            <div className="mt-4 grid gap-4 lg:grid-cols-[220px_1fr]">
              <div className="rounded-xl border border-border bg-surface-soft p-3">
                {remoteSeries.coverUrl ? (
                  <img
                    src={remoteSeries.coverUrl}
                    alt={`${remoteSeries.title} cover`}
                    className="h-64 w-full rounded-xl border border-border object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
                    No cover
                  </div>
                )}
                <h4 className="mt-3 text-lg font-semibold text-foreground">
                  {remoteSeries.title}
                </h4>
                {remoteSeries.author ? (
                  <p className="text-sm text-muted-foreground">
                    by {remoteSeries.author}
                  </p>
                ) : null}
                <Button
                  variant="soft"
                  className="mt-3 w-full border-primary/45 text-primary hover:bg-primary/20"
                  onClick={() => saveRemoteSeriesToLibrary(remoteSeries)}
                >
                  Add to library
                </Button>
                {remoteSeries.description ? (
                  <p className="mt-2 line-clamp-5 text-sm text-muted-foreground">
                    {remoteSeries.description}
                  </p>
                ) : null}
              </div>

              <div className="rounded-xl border border-border bg-surface-soft p-3">
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Chapters
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    {remoteSeries.chapters.length} total
                  </p>
                </div>
                <div className="max-h-[26rem] space-y-2 overflow-auto pr-1">
                  {remoteSeries.chapters.map((chapter) => (
                    <div
                      key={chapter.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-3 py-2"
                    >
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          Ch. {chapter.number} · {chapter.title}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {chapter.date ? chapter.date : 'Unknown release date'}
                        </p>
                      </div>
                      <Link
                        to="/weebcentral/$chapterId"
                        params={{ chapterId: chapter.id }}
                        search={{
                          seriesId: remoteSeries.id,
                          seriesTitle: remoteSeries.title,
                        }}
                        className="inline-flex shrink-0 items-center justify-center rounded-full border border-border bg-surface-soft px-3 py-1.5 text-xs font-medium transition hover:border-primary/60 hover:bg-primary/10"
                      >
                        Read
                      </Link>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {isLoading ? (
          <div className="rounded-xl border border-border bg-surface p-5 text-muted-foreground">
            Loading library…
          </div>
        ) : null}

        {!isLoading && series.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface p-5 text-muted-foreground">
            No series yet. Import a CBZ/ZIP to begin.
          </div>
        ) : null}

        {savedRemoteSeries.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {savedRemoteSeries.map((item) => {
              const latestChapter = item.chapters[0]

              return (
                <article
                  key={`remote:${item.id}`}
                  className="group rounded-xl border border-border bg-surface p-3 shadow-[0_12px_24px_-24px_var(--shadow)] transition-colors duration-200 hover:border-primary/40"
                >
                  {item.coverUrl ? (
                    <img
                      className="h-44 w-full rounded-xl border border-border object-cover"
                      src={item.coverUrl}
                      alt={`${item.title} cover`}
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-44 items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
                      No cover
                    </div>
                  )}

                  <h3 className="mt-3 text-base font-semibold text-foreground">
                    {item.title}
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    WeebCentral saved series
                  </p>

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {latestChapter ? (
                      <Link
                        to="/weebcentral/$chapterId"
                        params={{ chapterId: latestChapter.id }}
                        search={{
                          seriesId: item.id,
                          seriesTitle: item.title,
                        }}
                        className={cn(
                          buttonVariants({ variant: 'soft' }),
                          'w-full',
                        )}
                      >
                        Read
                      </Link>
                    ) : (
                      <span className="inline-flex w-full items-center justify-center border border-border bg-surface-soft px-3 py-2 text-sm text-muted-foreground">
                        No chapters
                      </span>
                    )}
                    <Button
                      variant="soft"
                      className="w-full border-destructive/35 text-destructive hover:bg-destructive/10"
                      onClick={() => removeRemoteSeriesFromLibrary(item.id)}
                    >
                      Remove
                    </Button>
                  </div>
                </article>
              )
            })}
          </div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {series.map((item) => (
            <article
              key={item.id}
              className="animate-enter group rounded-xl border border-border bg-surface p-3 shadow-[0_12px_24px_-24px_var(--shadow)] transition-colors duration-200 hover:border-primary/40"
              style={{
                animationDelay: `${120 + (item.chapterCount % 8) * 22}ms`,
              }}
            >
              {item.coverChapterId !== null && item.coverPageIndex !== null ? (
                <img
                  className="h-44 w-full rounded-xl border border-border object-cover"
                  src={`/api/image/${item.coverChapterId}/${item.coverPageIndex}?thumb=1`}
                  alt={`${item.title} cover`}
                  loading="lazy"
                />
              ) : (
                <div className="flex h-44 items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
                  No cover
                </div>
              )}

              <h3 className="mt-3 text-base font-semibold text-foreground">
                {item.title}
              </h3>
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                {item.description ?? 'No description'}
              </p>

              <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                <span>{item.source}</span>
                <span>{item.chapterCount} chapters</span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <Link
                  to="/series/$seriesId"
                  params={{ seriesId: item.id }}
                  className={cn(
                    buttonVariants({ variant: 'soft' }),
                    'w-full rounded-full',
                  )}
                >
                  Open
                </Link>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="w-full rounded-full border border-destructive/35 bg-destructive/10 text-destructive hover:bg-destructive/20"
                  onClick={() => removeSeries(item.id, item.title)}
                  disabled={removingSeriesId === item.id}
                >
                  {removingSeriesId === item.id ? 'Removing...' : 'Remove'}
                </Button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
