import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'

const createAnyFileRoute = createFileRoute as any
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { ContinuousScroll } from '#/components/reader/continuous-scroll'
import { PagePane } from '#/components/reader/page-pane'
import { Button } from '#/components/ui/button'
import {
  ReaderEdgeArrowButton,
  ReaderTapZone,
} from '#/components/ui/reader-overlay-controls'
import { RangeSlider } from '#/components/ui/range-slider'
import { SelectField } from '#/components/ui/select'
import type {
  ChapterPageManifest,
  ReaderMode,
  WeebcentralChapterDTO,
  WeebcentralSeriesDTO,
  ZoomPreset,
} from '#/lib/contracts'
import { fetchJson } from '#/lib/http-client'
import { upsertReadingHistory } from '#/lib/reading-history'
import {
  buildTwoPageSteps,
  findStepIndexByPageIndex,
  type PairingPage,
  type PairingStep,
} from '#/lib/reader/pairing'

export const Route = createAnyFileRoute('/weebcentral/$chapterId')({
  component: WeebcentralReaderPage,
})

const REMOTE_PROGRESS_STORAGE_KEY = 'suki-remote-progress.v1'
const prefetchedRemoteChapters = new Map<string, WeebcentralChapterDTO>()
const prefetchedRemoteSeries = new Map<string, WeebcentralSeriesDTO>()
const REMOTE_READER_UI_PREFS_KEY = 'suki-remote-reader-ui.v1'

interface StoredRemoteProgress {
  pageIndex: number
  mode: ReaderMode
  zoomPreset: ZoomPreset
}

interface ReaderUiPrefs {
  mode: ReaderMode
  zoomPreset: ZoomPreset
  sidebarOpen: boolean
  doublePageOffset: boolean
}

function loadReaderUiPrefs(storageKey: string): ReaderUiPrefs | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as Partial<ReaderUiPrefs>
    if (!parsed) {
      return null
    }

    return {
      mode:
        parsed.mode === 'double' || parsed.mode === 'scroll'
          ? parsed.mode
          : 'single',
      zoomPreset:
        parsed.zoomPreset === 'fit-width' || parsed.zoomPreset === 'actual'
          ? parsed.zoomPreset
          : 'fit-height',
      sidebarOpen: Boolean(parsed.sidebarOpen),
      doublePageOffset: Boolean(parsed.doublePageOffset),
    }
  } catch {
    return null
  }
}

function saveReaderUiPrefs(storageKey: string, prefs: ReaderUiPrefs) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(storageKey, JSON.stringify(prefs))
}

function buildDoublePageStepsWithOffset(
  pages: PairingPage[],
  offsetEnabled: boolean,
): PairingStep[] {
  if (!offsetEnabled || pages.length === 0) {
    return buildTwoPageSteps(pages)
  }

  const first = pages[0]
  if (!first || first.autoIsSpread || first.splitSpread) {
    return buildTwoPageSteps(pages)
  }

  const rest = pages.slice(1)
  const restSteps = buildTwoPageSteps(rest)

  return [
    {
      kind: 'single',
      anchorPageIndex: first.index,
      units: [{ type: 'page', pageIndex: first.index }],
    },
    ...restSteps,
  ]
}

async function fetchJsonWith429Retry<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const delays = [220, 520]

  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      return await fetchJson<T>(input, init)
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      const isRateLimited = message.includes('429')
      if (!isRateLimited || attempt >= delays.length) {
        throw error
      }

      await new Promise((resolve) => {
        window.setTimeout(resolve, delays[attempt])
      })
    }
  }

  throw new Error('Failed to fetch resource')
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function asPairingPage(page: ChapterPageManifest): PairingPage {
  return {
    index: page.pageIndex,
    width: page.width,
    height: page.height,
    autoIsSpread: page.autoIsSpread,
    splitSpread: page.splitSpread,
  }
}

function blurReaderFocusTarget() {
  const activeElement = document.activeElement
  if (activeElement instanceof HTMLElement) {
    const tagName = activeElement.tagName
    if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(tagName)) {
      activeElement.blur()
    }
  }
}

function loadRemoteProgress(chapterId: string): StoredRemoteProgress | null {
  try {
    const raw = window.localStorage.getItem(REMOTE_PROGRESS_STORAGE_KEY)
    if (!raw) {
      return null
    }

    const payload = JSON.parse(raw) as Record<string, StoredRemoteProgress>
    const item = payload[chapterId]
    if (!item) {
      return null
    }

    return item
  } catch {
    return null
  }
}

function saveRemoteProgress(chapterId: string, progress: StoredRemoteProgress) {
  try {
    const raw = window.localStorage.getItem(REMOTE_PROGRESS_STORAGE_KEY)
    const current = raw
      ? (JSON.parse(raw) as Record<string, StoredRemoteProgress>)
      : {}

    current[chapterId] = progress
    window.localStorage.setItem(
      REMOTE_PROGRESS_STORAGE_KEY,
      JSON.stringify(current),
    )
  } catch {
    // Ignore localStorage persistence failures.
  }
}

function createPlaceholderPages(
  chapter: WeebcentralChapterDTO,
): ChapterPageManifest[] {
  return chapter.pages.map((_, pageIndex) => ({
    id: `${chapter.chapterId}:${pageIndex}`,
    chapterId: chapter.chapterId,
    pageIndex,
    width: 1200,
    height: 1800,
    aspect: 1200 / 1800,
    autoIsSpread: false,
    splitSpread: null,
  }))
}

function WeebcentralReaderPage() {
  const params = Route.useParams()
  const search = Route.useSearch() as {
    seriesId?: string
    seriesTitle?: string
  }
  const navigate = useNavigate()

  const [series, setSeries] = useState<WeebcentralSeriesDTO | null>(null)
  const [chapter, setChapter] = useState<WeebcentralChapterDTO | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [mode, setMode] = useState<ReaderMode>(
    () => loadReaderUiPrefs(REMOTE_READER_UI_PREFS_KEY)?.mode ?? 'single',
  )
  const [zoomPreset, setZoomPreset] = useState<ZoomPreset>(
    () =>
      loadReaderUiPrefs(REMOTE_READER_UI_PREFS_KEY)?.zoomPreset ?? 'fit-height',
  )
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(
    () => loadReaderUiPrefs(REMOTE_READER_UI_PREFS_KEY)?.sidebarOpen ?? false,
  )
  const [doublePageOffset, setDoublePageOffset] = useState<boolean>(
    () =>
      loadReaderUiPrefs(REMOTE_READER_UI_PREFS_KEY)?.doublePageOffset ?? false,
  )
  const [currentPageIndex, setCurrentPageIndex] = useState(0)
  const [currentStepIndex, setCurrentStepIndex] = useState(0)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [showPageHud, setShowPageHud] = useState(false)

  const viewportRef = useRef<HTMLDivElement>(null)
  const readerStageRef = useRef<HTMLElement>(null)
  const pageHudTimeoutRef = useRef<number | null>(null)
  const dragStateRef = useRef<{
    active: boolean
    startX: number
    startY: number
    scrollLeft: number
    scrollTop: number
  } | null>(null)

  const pages = useMemo(
    () => (chapter ? createPlaceholderPages(chapter) : []),
    [chapter],
  )

  const pageUrlMap = useMemo(() => {
    const map = new Map<number, string>()
    chapter?.pages.forEach((page, index) => {
      map.set(index, page.url)
    })
    return map
  }, [chapter])

  const twoPageSteps = useMemo(
    () =>
      buildDoublePageStepsWithOffset(
        pages.map(asPairingPage),
        doublePageOffset,
      ),
    [doublePageOffset, pages],
  )

  const maxPageIndex = Math.max(pages.length - 1, 0)
  const maxStepIndex = Math.max(twoPageSteps.length - 1, 0)
  const currentTargetPageIndex =
    mode === 'double'
      ? (twoPageSteps[currentStepIndex]?.anchorPageIndex ?? currentPageIndex)
      : currentPageIndex
  const scrubberMax = Math.max(0, pages.length - 1)
  const scrubberValue = currentTargetPageIndex

  const currentChapterIndex = useMemo(
    () =>
      series?.chapters.findIndex((entry) => entry.id === params.chapterId) ??
      -1,
    [params.chapterId, series],
  )

  const previousChapterId =
    currentChapterIndex >= 0
      ? (series?.chapters[currentChapterIndex + 1]?.id ?? null)
      : null
  const nextChapterId =
    currentChapterIndex > 0
      ? (series?.chapters[currentChapterIndex - 1]?.id ?? null)
      : null

  const activeStep = twoPageSteps[currentStepIndex] ?? null
  const stepUnits = activeStep?.units ?? []
  const normalizedStepUnits =
    stepUnits.length > 2 ? stepUnits.slice(0, 2) : stepUnits
  const renderedUnits =
    normalizedStepUnits.length === 2
      ? [...normalizedStepUnits].reverse()
      : normalizedStepUnits

  const hudPageLabel = useMemo(() => {
    if (pages.length === 0) {
      return 'Page 0 / 0'
    }

    if (mode !== 'double') {
      return `Page ${currentTargetPageIndex + 1} / ${pages.length}`
    }

    const visibleIndexes = renderedUnits
      .map((unit) => unit.pageIndex)
      .sort((left, right) => left - right)

    if (visibleIndexes.length <= 1) {
      const safeIndex = visibleIndexes[0] ?? currentTargetPageIndex
      return `Page ${safeIndex + 1} / ${pages.length}`
    }

    const first = visibleIndexes[0]!
    const last = visibleIndexes[visibleIndexes.length - 1]!
    return `Pages ${first + 1}-${last + 1} / ${pages.length}`
  }, [currentTargetPageIndex, mode, pages.length, renderedUnits])

  const showPageHudForMoment = useCallback(() => {
    if (!isFullscreen) {
      return
    }

    setShowPageHud(true)

    if (pageHudTimeoutRef.current !== null) {
      window.clearTimeout(pageHudTimeoutRef.current)
    }

    pageHudTimeoutRef.current = window.setTimeout(() => {
      setShowPageHud(false)
      pageHudTimeoutRef.current = null
    }, 900)
  }, [isFullscreen])

  const persistRemoteProgressNow = useCallback(
    (pageIndex: number) => {
      if (!chapter) {
        return
      }

      saveRemoteProgress(chapter.chapterId, {
        pageIndex,
        mode,
        zoomPreset,
      })

      upsertReadingHistory({
        chapterId: chapter.chapterId,
        seriesId: series?.id ?? search.seriesId ?? chapter.seriesId,
        seriesTitle: series?.title ?? search.seriesTitle,
        chapterTitle:
          series?.chapters.find((entry) => entry.id === chapter.chapterId)
            ?.title ?? `Chapter ${chapter.chapterId}`,
        pageIndex,
        mode,
        readerRoute: 'weebcentral',
      })
    },
    [
      chapter,
      mode,
      search.seriesId,
      search.seriesTitle,
      series?.id,
      series?.title,
      zoomPreset,
    ],
  )

  const goToChapter = useCallback(
    (chapterId: string | null) => {
      if (!chapterId) {
        return
      }

      persistRemoteProgressNow(currentTargetPageIndex)

      void navigate({
        to: '/weebcentral/$chapterId',
        params: { chapterId },
        search: {
          seriesId: series?.id,
          seriesTitle: series?.title,
        },
      })
    },
    [
      currentTargetPageIndex,
      navigate,
      persistRemoteProgressNow,
      series?.id,
      series?.title,
    ],
  )

  const loadRemoteChapter = useCallback(async () => {
    const cachedChapter = prefetchedRemoteChapters.get(params.chapterId)
    if (cachedChapter) {
      prefetchedRemoteChapters.delete(params.chapterId)
    }

    setIsLoading(!cachedChapter)
    setError(null)
    setCurrentPageIndex(0)
    setCurrentStepIndex(0)

    const applyChapterState = (chapterPayload: WeebcentralChapterDTO) => {
      setChapter(chapterPayload)

      const savedProgress = loadRemoteProgress(chapterPayload.chapterId)
      const initialPageIndex = clamp(
        savedProgress?.pageIndex ?? 0,
        0,
        chapterPayload.pages.length - 1,
      )
      setCurrentPageIndex(initialPageIndex)
      setCurrentStepIndex(
        findStepIndexByPageIndex(
          buildDoublePageStepsWithOffset(
            createPlaceholderPages(chapterPayload).map(asPairingPage),
            doublePageOffset,
          ),
          initialPageIndex,
        ),
      )
    }

    if (cachedChapter) {
      applyChapterState(cachedChapter)
    } else {
      setChapter(null)
    }

    try {
      const chapterPayload =
        cachedChapter ??
        (await fetchJsonWith429Retry<WeebcentralChapterDTO>(
          `/v1/weebcentral/chapter?url=${encodeURIComponent(params.chapterId)}`,
        ))
      if (!cachedChapter) {
        applyChapterState(chapterPayload)
      }

      const seriesInput =
        search.seriesId?.trim() || chapterPayload.seriesId || params.chapterId
      const cachedSeries = prefetchedRemoteSeries.get(seriesInput)
      if (cachedSeries) {
        setSeries(cachedSeries)
      }

      void (async () => {
        try {
          const seriesPayload =
            cachedSeries ??
            (await fetchJsonWith429Retry<WeebcentralSeriesDTO>(
              `/v1/weebcentral/series?url=${encodeURIComponent(seriesInput)}`,
            ))
          prefetchedRemoteSeries.set(seriesInput, seriesPayload)
          prefetchedRemoteSeries.set(seriesPayload.id, seriesPayload)
          setSeries(seriesPayload)
        } catch {
          // Ignore series metadata failure; chapter can still render.
        }
      })()
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Failed to load remote chapter',
      )
    } finally {
      setIsLoading(false)
    }
  }, [doublePageOffset, params.chapterId, search.seriesId])

  useEffect(() => {
    void loadRemoteChapter()
  }, [loadRemoteChapter])

  useEffect(() => {
    saveReaderUiPrefs(REMOTE_READER_UI_PREFS_KEY, {
      mode,
      zoomPreset,
      sidebarOpen,
      doublePageOffset,
    })
  }, [doublePageOffset, mode, sidebarOpen, zoomPreset])

  const cycleMode = useCallback(() => {
    setMode((current) => {
      const next: ReaderMode =
        current === 'single'
          ? 'double'
          : current === 'double'
            ? 'scroll'
            : 'single'

      if (next === 'double') {
        setCurrentStepIndex(
          findStepIndexByPageIndex(twoPageSteps, currentTargetPageIndex),
        )
      } else {
        setCurrentPageIndex(currentTargetPageIndex)
      }

      return next
    })
  }, [currentTargetPageIndex, twoPageSteps])

  useEffect(() => {
    if (!chapter) {
      return
    }

    saveRemoteProgress(chapter.chapterId, {
      pageIndex: currentTargetPageIndex,
      mode,
      zoomPreset,
    })

    upsertReadingHistory({
      chapterId: chapter.chapterId,
      seriesId: series?.id ?? search.seriesId ?? chapter.seriesId,
      seriesTitle: series?.title ?? search.seriesTitle,
      chapterTitle:
        series?.chapters.find((entry) => entry.id === chapter.chapterId)
          ?.title ?? `Chapter ${chapter.chapterId}`,
      pageIndex: currentTargetPageIndex,
      mode,
      readerRoute: 'weebcentral',
    })
  }, [
    chapter,
    currentTargetPageIndex,
    mode,
    search.seriesId,
    search.seriesTitle,
    series?.id,
    series?.title,
    zoomPreset,
  ])

  useEffect(() => {
    const lookaheadCount = 2
    const urlsToWarm = chapter?.pages
      .slice(
        currentTargetPageIndex + 1,
        currentTargetPageIndex + 1 + lookaheadCount,
      )
      .map((page) => page.url)

    if (!urlsToWarm || urlsToWarm.length === 0) {
      return
    }

    const images = urlsToWarm.map((url) => {
      const image = new Image()
      image.decoding = 'async'
      image.src = url
      return image
    })

    return () => {
      images.forEach((image) => {
        image.src = ''
      })
    }
  }, [chapter, currentTargetPageIndex])

  useEffect(() => {
    if (!nextChapterId || pages.length === 0) {
      return
    }

    const shouldPrefetchNextChapter = currentTargetPageIndex >= maxPageIndex - 8
    if (!shouldPrefetchNextChapter) {
      return
    }

    if (prefetchedRemoteChapters.has(nextChapterId)) {
      return
    }

    const controller = new AbortController()

    void (async () => {
      try {
        const payload = await fetchJsonWith429Retry<WeebcentralChapterDTO>(
          `/v1/weebcentral/chapter?url=${encodeURIComponent(nextChapterId)}`,
          { signal: controller.signal },
        )

        prefetchedRemoteChapters.set(nextChapterId, payload)

        payload.pages.slice(0, 4).forEach((page) => {
          const image = new Image()
          image.decoding = 'async'
          image.src = page.url
        })
      } catch {
        // Ignore prefetch failures; regular navigation still works.
      }
    })()

    return () => {
      controller.abort()
    }
  }, [currentTargetPageIndex, maxPageIndex, nextChapterId, pages.length])

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement))
    }

    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange)
    }
  }, [])

  useEffect(() => {
    if (!isFullscreen) {
      setShowPageHud(false)
      if (pageHudTimeoutRef.current !== null) {
        window.clearTimeout(pageHudTimeoutRef.current)
        pageHudTimeoutRef.current = null
      }
      return
    }

    showPageHudForMoment()
  }, [isFullscreen, showPageHudForMoment])

  useEffect(
    () => () => {
      if (pageHudTimeoutRef.current !== null) {
        window.clearTimeout(pageHudTimeoutRef.current)
      }
    },
    [],
  )

  useEffect(() => {
    const viewport = viewportRef.current

    if (!viewport || zoomPreset !== 'actual') {
      return
    }

    const onPointerMove = (event: PointerEvent) => {
      const state = dragStateRef.current
      if (!state?.active) {
        return
      }

      viewport.scrollLeft = state.scrollLeft - (event.clientX - state.startX)
      viewport.scrollTop = state.scrollTop - (event.clientY - state.startY)
    }

    const onPointerUp = () => {
      if (dragStateRef.current) {
        dragStateRef.current.active = false
      }
      viewport.style.cursor = 'grab'
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)

    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [zoomPreset])

  const goToPage = useCallback(
    (nextPageIndex: number) => {
      const safeIndex = clamp(nextPageIndex, 0, maxPageIndex)
      setCurrentPageIndex(safeIndex)
      setCurrentStepIndex(findStepIndexByPageIndex(twoPageSteps, safeIndex))
    },
    [maxPageIndex, twoPageSteps],
  )

  const toggleFullscreen = useCallback(async () => {
    const targetElement = readerStageRef.current
    if (!targetElement) {
      return
    }

    if (document.fullscreenElement) {
      await document.exitFullscreen()
      return
    }

    await targetElement.requestFullscreen()
  }, [])

  const goNext = useCallback(() => {
    if (mode === 'double') {
      if (currentStepIndex >= maxStepIndex) {
        goToChapter(nextChapterId)
        return
      }

      const next = clamp(currentStepIndex + 1, 0, maxStepIndex)
      setCurrentStepIndex(next)
      setCurrentPageIndex(
        twoPageSteps[next]?.anchorPageIndex ?? currentPageIndex,
      )
      return
    }

    if (currentPageIndex >= maxPageIndex) {
      goToChapter(nextChapterId)
      return
    }

    goToPage(currentPageIndex + 1)
  }, [
    currentPageIndex,
    currentStepIndex,
    goToChapter,
    goToPage,
    maxPageIndex,
    maxStepIndex,
    mode,
    nextChapterId,
    twoPageSteps,
  ])

  const goPrevious = useCallback(() => {
    if (mode === 'double') {
      if (currentStepIndex <= 0) {
        goToChapter(previousChapterId)
        return
      }

      const previous = clamp(currentStepIndex - 1, 0, maxStepIndex)
      setCurrentStepIndex(previous)
      setCurrentPageIndex(
        twoPageSteps[previous]?.anchorPageIndex ?? currentPageIndex,
      )
      return
    }

    if (currentPageIndex <= 0) {
      goToChapter(previousChapterId)
      return
    }

    goToPage(currentPageIndex - 1)
  }, [
    currentPageIndex,
    currentStepIndex,
    goToChapter,
    goToPage,
    maxStepIndex,
    mode,
    previousChapterId,
    twoPageSteps,
  ])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
        return
      }

      if (event.code === 'ArrowRight' || event.code === 'KeyD') {
        event.preventDefault()
        blurReaderFocusTarget()
        goPrevious()
        return
      }

      if (event.code === 'ArrowLeft' || event.code === 'KeyA') {
        event.preventDefault()
        blurReaderFocusTarget()
        goNext()
        return
      }

      if (event.code === 'Space') {
        event.preventDefault()
        blurReaderFocusTarget()
        if (event.shiftKey) {
          goPrevious()
        } else {
          goNext()
        }
      }

      if (event.code === 'KeyF') {
        event.preventDefault()
        void toggleFullscreen()
        return
      }

      if (event.code === 'KeyQ') {
        event.preventDefault()
        blurReaderFocusTarget()
        cycleMode()
        return
      }

      if (event.key === '[') {
        event.preventDefault()
        blurReaderFocusTarget()
        goToChapter(nextChapterId)
        return
      }

      if (event.key === ']') {
        event.preventDefault()
        blurReaderFocusTarget()
        goToChapter(previousChapterId)
        return
      }

      if (event.code === 'KeyO' || event.key === 'o' || event.key === 'O') {
        event.preventDefault()
        event.stopPropagation()
        blurReaderFocusTarget()
        setDoublePageOffset((value) => !value)
        return
      }
    }

    window.addEventListener('keydown', handler, true)

    return () => {
      window.removeEventListener('keydown', handler, true)
    }
  }, [
    cycleMode,
    goNext,
    goPrevious,
    goToChapter,
    nextChapterId,
    previousChapterId,
    toggleFullscreen,
  ])

  const remoteSeriesTitle = series?.title ?? search.seriesTitle ?? 'WeebCentral'
  const activeChapterMetadata =
    series?.chapters.find((entry) => entry.id === params.chapterId) ?? null

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-surface p-6 text-muted-foreground">
        Loading remote chapter…
      </div>
    )
  }

  if (error || !chapter) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-destructive">
        {error ?? 'Failed to load WeebCentral chapter'}
      </div>
    )
  }

  return (
    <div
      className={
        isFullscreen ? '' : 'relative h-[100dvh] overflow-hidden bg-black'
      }
    >
      {!isFullscreen ? (
        <Button
          variant="ghost"
          size="icon"
          className={`absolute top-4 z-50 size-10 border border-white/25 bg-black/35 text-white backdrop-blur transition-transform duration-200 ${sidebarOpen ? 'left-[332px]' : 'left-3'}`}
          onClick={() => setSidebarOpen((current) => !current)}
          type="button"
        >
          {sidebarOpen ? '\u2039' : '\u203a'}
        </Button>
      ) : null}

      {!isFullscreen ? (
        <aside
          className={`animate-enter absolute inset-y-0 left-0 z-40 w-[320px] overflow-y-auto border-r border-border bg-surface p-4 shadow-[0_20px_40px_-30px_var(--shadow)] transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
          style={{ animationDelay: '20ms' }}
        >
          <div className="space-y-2 text-xs text-muted-foreground">
            <Link to="/" className="inline-flex hover:text-foreground">
              Back
            </Link>
            <p className="truncate text-sm font-medium text-foreground">
              {remoteSeriesTitle}
            </p>
            <p>
              {activeChapterMetadata
                ? `Ch ${activeChapterMetadata.number}`
                : `Ch ${chapter.chapterId}`}
            </p>
          </div>

          <div className="mt-3 grid gap-2">
            <SelectField
              value={mode}
              onChange={(event) => {
                const nextMode = event.target.value as ReaderMode
                setMode(nextMode)

                if (nextMode === 'double') {
                  setCurrentStepIndex(
                    findStepIndexByPageIndex(
                      twoPageSteps,
                      currentTargetPageIndex,
                    ),
                  )
                } else {
                  setCurrentPageIndex(currentTargetPageIndex)
                }
              }}
              options={[
                { value: 'single', label: 'Single' },
                { value: 'double', label: 'Double' },
                { value: 'scroll', label: 'Scroll' },
              ]}
            />

            <Button
              type="button"
              variant={doublePageOffset ? 'default' : 'soft'}
              className="h-9 justify-between px-3"
              onClick={() => setDoublePageOffset((value) => !value)}
            >
              <span>Offset first page</span>
              <span>{doublePageOffset ? 'On' : 'Off'}</span>
            </Button>

            <SelectField
              value={zoomPreset}
              onChange={(event) =>
                setZoomPreset(event.target.value as ZoomPreset)
              }
              className="h-9"
              options={[
                { value: 'fit-height', label: 'Fit Height' },
                { value: 'fit-width', label: 'Fit Width' },
                { value: 'actual', label: 'Actual' },
              ]}
            />

            {series?.chapters?.length ? (
              <SelectField
                value={chapter.chapterId}
                onChange={(event) => {
                  const nextId = event.target.value
                  if (nextId === chapter.chapterId) {
                    return
                  }
                  goToChapter(nextId)
                }}
                className="h-9"
                options={series.chapters.map((entry) => ({
                  value: entry.id,
                  label: `Ch ${entry.number}`,
                }))}
              />
            ) : null}

            <label className="text-xs text-muted-foreground">
              {currentTargetPageIndex + 1} / {pages.length}
              <RangeSlider
                min={0}
                max={scrubberMax}
                value={scrubberValue}
                onChange={(event) =>
                  goToPage(Number.parseInt(event.target.value, 10))
                }
                className="mt-3 w-full accent-primary"
                style={{ transform: 'scaleX(-1)' }}
              />
            </label>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <Button variant="soft" className="w-full" onClick={goPrevious}>
              Previous
            </Button>
            <Button variant="soft" className="w-full" onClick={goNext}>
              Next
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{hudPageLabel}</p>
          <div className="mt-2 flex items-center gap-2">
            <Button
              variant="ghost"
              className="w-full border border-border"
              onClick={() => goToChapter(previousChapterId)}
              disabled={!previousChapterId}
            >
              ] Prev chapter
            </Button>
            <Button
              variant="ghost"
              className="w-full border border-border"
              onClick={() => goToChapter(nextChapterId)}
              disabled={!nextChapterId}
            >
              [ Next chapter
            </Button>
          </div>
        </aside>
      ) : null}

      <section className={isFullscreen ? '' : 'h-full'} ref={readerStageRef}>
        {mode === 'scroll' ? (
          <div className="relative" onMouseMove={showPageHudForMoment}>
            <ContinuousScroll
              chapterId={chapter.chapterId}
              pages={pages}
              zoomPreset={zoomPreset}
              isFullscreen={isFullscreen}
              resolveImageUrl={(page) => pageUrlMap.get(page.pageIndex)}
              onVisiblePageChange={(pageIndex) =>
                setCurrentPageIndex(pageIndex)
              }
            />
            {isFullscreen && showPageHud ? (
              <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-sm text-white">
                {hudPageLabel}
              </div>
            ) : null}
          </div>
        ) : (
          <div
            className="relative h-[100dvh] bg-black"
            ref={viewportRef}
            onMouseMove={showPageHudForMoment}
            onPointerDown={(event) => {
              if (zoomPreset !== 'actual' || !viewportRef.current) {
                return
              }

              dragStateRef.current = {
                active: true,
                startX: event.clientX,
                startY: event.clientY,
                scrollLeft: viewportRef.current.scrollLeft,
                scrollTop: viewportRef.current.scrollTop,
              }

              viewportRef.current.style.cursor = 'grabbing'
            }}
            style={{
              cursor: zoomPreset === 'actual' ? 'grab' : 'default',
              overflow: zoomPreset === 'actual' ? 'auto' : 'hidden',
            }}
          >
            <div className="flex h-full items-center justify-center gap-0">
              {(mode === 'single'
                ? [
                    {
                      type: 'page' as const,
                      pageIndex: currentPageIndex,
                    },
                  ]
                : renderedUnits
              ).map((unit, slotIndex) => {
                const page = pages.find(
                  (entry) => entry.pageIndex === unit.pageIndex,
                )

                if (!page) {
                  return null
                }

                const paneKey =
                  mode === 'single'
                    ? 'pane-single'
                    : `pane-${slotIndex}-${unit.type === 'half' ? unit.half : 'page'}`

                return (
                  <PagePane
                    key={paneKey}
                    chapterId={chapter.chapterId}
                    unit={unit}
                    page={page}
                    imageUrl={pageUrlMap.get(page.pageIndex)}
                    zoomPreset={zoomPreset}
                    loading="eager"
                    testId="reader-page-container"
                  />
                )
              })}
            </div>

            <ReaderTapZone side="left" onActivate={goNext} />
            <ReaderTapZone side="right" onActivate={goPrevious} />
            {!isFullscreen ? (
              <>
                <ReaderEdgeArrowButton side="left" onActivate={goNext} />
                <ReaderEdgeArrowButton side="right" onActivate={goPrevious} />
              </>
            ) : null}
            {isFullscreen && showPageHud ? (
              <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-sm text-white">
                {hudPageLabel}
              </div>
            ) : null}
          </div>
        )}
      </section>
    </div>
  )
}
