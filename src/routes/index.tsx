import { createFileRoute, Link } from '@tanstack/react-router'

const createAnyFileRoute = createFileRoute as any
import { useCallback, useEffect, useMemo, useState } from 'react'

import type {
  LibrarySeries,
  ReadingHistoryItem,
  WeebcentralSeriesDTO,
} from '#/lib/contracts'
import { Button } from '#/components/ui/button'
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
    <div className="minimal-layout grid gap-4 lg:grid-cols-[300px_1fr]">
      <aside
        className="animate-enter ui-panel p-5"
        style={{ animationDelay: '20ms' }}
      >
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
          Import
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Drag a CBZ/ZIP file here or choose one.
        </p>

        <div
          className={`mt-4 border border-dashed p-5 text-center transition-colors duration-150 ${
            isDragging
              ? 'border-border-strong bg-surface'
              : 'border-border bg-surface-soft'
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
          <p className="ui-kicker">Drop archive</p>
          <FilePickerButton
            variant="soft"
            className="mt-3"
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
            <h3 className="ui-kicker">History</h3>
            <div className="mt-2 space-y-1.5">
              {history.slice(0, 8).map((item) => (
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
                  className="ui-link-card group flex items-center gap-2 px-3 py-2"
                >
                  <span
                    className={cn(
                      'inline-flex size-4 shrink-0 items-center justify-center border text-[10px] font-semibold',
                      item.completed
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border bg-surface-soft text-muted-foreground',
                    )}
                    aria-hidden
                  >
                    {item.completed ? '✓' : ''}
                  </span>
                  <span className="truncate text-sm text-foreground group-hover:text-primary">
                    {item.chapterTitle}
                  </span>
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
          className="animate-enter ui-panel p-4"
          style={{ animationDelay: '50ms' }}
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-2xl font-semibold text-foreground">Library</h2>
            <p className="ui-pill">
              {libraryStats.seriesCount} series · {libraryStats.chapterCount}{' '}
              chapters
            </p>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Dive in from right to left.
          </p>
        </div>

        <div
          className="animate-enter ui-panel p-4"
          style={{ animationDelay: '90ms' }}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="ui-kicker text-primary">WeebCentral Proxy</p>
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
              <div className="ui-panel-soft p-3">
                {remoteSeries.coverUrl ? (
                  <img
                    src={remoteSeries.coverUrl}
                    alt={`${remoteSeries.title} cover`}
                    className="h-64 w-full border border-border object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-64 items-center justify-center border border-dashed border-border text-sm text-muted-foreground">
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

              <div className="ui-panel-soft p-3">
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="ui-kicker">Chapters</h4>
                  <p className="text-xs text-muted-foreground">
                    {remoteSeries.chapters.length} total
                  </p>
                </div>
                <div className="max-h-[26rem] space-y-2 overflow-auto pr-1">
                  {remoteSeries.chapters.map((chapter) => (
                    <Link
                      key={chapter.id}
                      to="/weebcentral/$chapterId"
                      params={{ chapterId: chapter.id }}
                      search={{
                        seriesId: remoteSeries.id,
                        seriesTitle: remoteSeries.title,
                      }}
                      className="ui-link-card group flex items-center justify-between gap-3 px-3 py-2"
                    >
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          Ch. {chapter.number} · {chapter.title}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {chapter.date ? chapter.date : 'Unknown release date'}
                        </p>
                      </div>
                      <span className="ui-kicker shrink-0 transition-colors group-hover:text-foreground">
                        Read
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {isLoading ? (
          <div className="ui-panel p-5 text-muted-foreground">
            Loading library…
          </div>
        ) : null}

        {!isLoading && series.length === 0 ? (
          <div className="ui-panel p-5 text-muted-foreground">
            No series yet. Import a CBZ/ZIP to begin.
          </div>
        ) : null}

        {savedRemoteSeries.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {savedRemoteSeries.map((item) => {
              return (
                <article
                  key={`remote:${item.id}`}
                  className="ui-panel p-3 transition-colors duration-150 hover:border-border-strong"
                >
                  <Link
                    to="/weebcentral-series/$seriesId"
                    params={{ seriesId: item.id }}
                    className="group block"
                  >
                    {item.coverUrl ? (
                      <img
                        className="h-44 w-full border border-border object-cover"
                        src={item.coverUrl}
                        alt={`${item.title} cover`}
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-44 items-center justify-center border border-dashed border-border text-sm text-muted-foreground">
                        No cover
                      </div>
                    )}

                    <h3 className="mt-3 text-base font-semibold text-foreground transition-colors group-hover:text-primary">
                      {item.title}
                    </h3>
                    <p className="ui-kicker mt-1">WeebCentral saved series</p>
                  </Link>

                  <Button
                    variant="soft"
                    size="sm"
                    className="mt-3 w-full border-destructive/35 text-destructive hover:bg-destructive/10"
                    onClick={() => removeRemoteSeriesFromLibrary(item.id)}
                  >
                    Remove
                  </Button>
                </article>
              )
            })}
          </div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {series.map((item) => (
            <article
              key={item.id}
              className="animate-enter ui-panel p-3 transition-colors duration-150 hover:border-border-strong"
              style={{
                animationDelay: `${120 + (item.chapterCount % 8) * 22}ms`,
              }}
            >
              <Link
                to="/series/$seriesId"
                params={{ seriesId: item.id }}
                className="group block"
              >
                {item.coverChapterId !== null &&
                item.coverPageIndex !== null ? (
                  <img
                    className="h-44 w-full border border-border object-cover"
                    src={`/api/image/${item.coverChapterId}/${item.coverPageIndex}?thumb=1`}
                    alt={`${item.title} cover`}
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-44 items-center justify-center border border-dashed border-border text-sm text-muted-foreground">
                    No cover
                  </div>
                )}

                <h3 className="mt-3 text-base font-semibold text-foreground transition-colors group-hover:text-primary">
                  {item.title}
                </h3>
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                  {item.description ?? 'No description'}
                </p>

                <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{item.source}</span>
                  <span>{item.chapterCount} chapters</span>
                </div>
              </Link>

              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="mt-3 w-full"
                onClick={() => removeSeries(item.id, item.title)}
                disabled={removingSeriesId === item.id}
              >
                {removingSeriesId === item.id ? 'Removing...' : 'Remove'}
              </Button>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
