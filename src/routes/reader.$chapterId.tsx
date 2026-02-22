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
  ChapterProgress,
  ChapterPayload,
  ReaderMode,
  SeriesDetail,
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
import { useImagePrefetch } from '#/hooks/use-image-prefetch'

export const Route = createAnyFileRoute('/reader/$chapterId')({
  component: ReaderPage,
})

const prefetchedLocalChapterPayloads = new Map<string, ChapterPayload>()
const prefetchedLocalSeriesDetails = new Map<string, SeriesDetail>()
const optimisticLocalProgress = new Map<string, ChapterProgress>()
const LOCAL_READER_UI_PREFS_KEY = 'suki-local-reader-ui.v1'

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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
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

function asPairingPage(page: ChapterPageManifest): PairingPage {
  return {
    index: page.pageIndex,
    width: page.width,
    height: page.height,
    autoIsSpread: page.autoIsSpread,
    splitSpread: page.splitSpread,
  }
}

function resolveAdjacentChapterIds(series: SeriesDetail, chapterId: string) {
  const chapterIndex = series.chapters.findIndex(
    (chapter) => chapter.id === chapterId,
  )

  return {
    previousChapterId:
      chapterIndex >= 0
        ? (series.chapters[chapterIndex + 1]?.id ?? null)
        : null,
    nextChapterId:
      chapterIndex > 0 ? (series.chapters[chapterIndex - 1]?.id ?? null) : null,
  }
}

function ReaderPage() {
  const params = Route.useParams()
  const navigate = useNavigate()

  const [chapterPayload, setChapterPayload] = useState<ChapterPayload | null>(
    null,
  )
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nextChapterId, setNextChapterId] = useState<string | null>(null)
  const [previousChapterId, setPreviousChapterId] = useState<string | null>(
    null,
  )
  const [seriesChapters, setSeriesChapters] = useState<
    SeriesDetail['chapters']
  >([])

  const [mode, setMode] = useState<ReaderMode>(
    () => loadReaderUiPrefs(LOCAL_READER_UI_PREFS_KEY)?.mode ?? 'single',
  )
  const [zoomPreset, setZoomPreset] = useState<ZoomPreset>(
    () =>
      loadReaderUiPrefs(LOCAL_READER_UI_PREFS_KEY)?.zoomPreset ?? 'fit-height',
  )
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(
    () => loadReaderUiPrefs(LOCAL_READER_UI_PREFS_KEY)?.sidebarOpen ?? false,
  )
  const [doublePageOffset, setDoublePageOffset] = useState<boolean>(
    () =>
      loadReaderUiPrefs(LOCAL_READER_UI_PREFS_KEY)?.doublePageOffset ?? false,
  )

  const [currentPageIndex, setCurrentPageIndex] = useState(0)
  const [currentStepIndex, setCurrentStepIndex] = useState(0)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [showPageHud, setShowPageHud] = useState(false)

  const viewportRef = useRef<HTMLDivElement>(null)
  const readerStageRef = useRef<HTMLElement>(null)
  const chapterTransitionRef = useRef(false)
  const pageHudTimeoutRef = useRef<number | null>(null)
  const dragStateRef = useRef<{
    active: boolean
    startX: number
    startY: number
    scrollLeft: number
    scrollTop: number
  } | null>(null)

  const pages = chapterPayload?.manifest.pages ?? []
  const chapterId = chapterPayload?.manifest.chapterId ?? params.chapterId

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

  useImagePrefetch({
    chapterId,
    startPageIndex: currentTargetPageIndex,
    totalPages: pages.length,
    enabled: pages.length > 0,
  })

  useEffect(() => {
    if (!nextChapterId || pages.length === 0) {
      return
    }

    const shouldPrefetchNextChapter = currentTargetPageIndex >= maxPageIndex - 8
    if (!shouldPrefetchNextChapter) {
      return
    }

    if (prefetchedLocalChapterPayloads.has(nextChapterId)) {
      return
    }

    const controller = new AbortController()

    void (async () => {
      try {
        const payload = await fetchJson<ChapterPayload>(
          `/api/chapter/${nextChapterId}`,
          { signal: controller.signal },
        )

        prefetchedLocalChapterPayloads.set(nextChapterId, payload)

        const warmCount = Math.min(4, payload.manifest.pages.length)
        for (let index = 0; index < warmCount; index += 1) {
          const image = new Image()
          image.decoding = 'async'
          image.src = `/api/image/${nextChapterId}/${index}`
        }
      } catch {
        // Ignore prefetch failures; regular navigation still works.
      }
    })()

    return () => {
      controller.abort()
    }
  }, [currentTargetPageIndex, maxPageIndex, nextChapterId, pages.length])

  const loadChapter = useCallback(async () => {
    const cachedPayload = prefetchedLocalChapterPayloads.get(params.chapterId)
    if (cachedPayload) {
      prefetchedLocalChapterPayloads.delete(params.chapterId)
    }

    setIsLoading(!cachedPayload)
    setError(null)
    setNextChapterId(null)
    setPreviousChapterId(null)

    const applyPayloadState = (payload: ChapterPayload) => {
      setChapterPayload(payload)

      const savedProgress =
        optimisticLocalProgress.get(payload.manifest.chapterId) ??
        payload.progress
      const nextPage = clamp(
        savedProgress?.pageIndex ?? 0,
        0,
        payload.manifest.pageCount - 1,
      )

      setCurrentPageIndex(nextPage)
      setCurrentStepIndex(
        findStepIndexByPageIndex(
          buildDoublePageStepsWithOffset(
            payload.manifest.pages.map(asPairingPage),
            doublePageOffset,
          ),
          nextPage,
        ),
      )
    }

    if (cachedPayload) {
      applyPayloadState(cachedPayload)
    } else {
      setChapterPayload(null)
      setCurrentPageIndex(0)
      setCurrentStepIndex(0)
    }

    chapterTransitionRef.current = false

    try {
      const payload =
        cachedPayload ??
        (await fetchJson<ChapterPayload>(`/api/chapter/${params.chapterId}`))
      if (!cachedPayload) {
        applyPayloadState(payload)
      }

      const cachedSeries = prefetchedLocalSeriesDetails.get(
        payload.manifest.seriesId,
      )

      if (cachedSeries) {
        const adjacent = resolveAdjacentChapterIds(
          cachedSeries,
          payload.manifest.chapterId,
        )
        setNextChapterId(adjacent.nextChapterId)
        setPreviousChapterId(adjacent.previousChapterId)
        setSeriesChapters(cachedSeries.chapters)
      }

      void (async () => {
        try {
          const series =
            cachedSeries ??
            (await fetchJson<SeriesDetail>(
              `/api/series/${payload.manifest.seriesId}`,
            ))
          prefetchedLocalSeriesDetails.set(payload.manifest.seriesId, series)

          const adjacent = resolveAdjacentChapterIds(
            series,
            payload.manifest.chapterId,
          )
          setNextChapterId(adjacent.nextChapterId)
          setPreviousChapterId(adjacent.previousChapterId)
          setSeriesChapters(series.chapters)
        } catch {
          setNextChapterId(null)
          setPreviousChapterId(null)
          setSeriesChapters([])
        }
      })()
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Failed to load chapter',
      )
    } finally {
      setIsLoading(false)
    }
  }, [doublePageOffset, params.chapterId])

  useEffect(() => {
    void loadChapter()
  }, [loadChapter])

  useEffect(() => {
    saveReaderUiPrefs(LOCAL_READER_UI_PREFS_KEY, {
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
    if (!chapterPayload) {
      return
    }

    const timeout = setTimeout(() => {
      optimisticLocalProgress.set(chapterId, {
        chapterId,
        pageIndex: currentTargetPageIndex,
        stepIndex: currentStepIndex,
        mode,
        direction: 'rtl',
        zoomPreset,
        updatedAt: Date.now(),
      })

      void fetch(`/api/chapter/${chapterId}/progress`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chapterId,
          pageIndex: currentTargetPageIndex,
          stepIndex: currentStepIndex,
          mode,
          direction: 'rtl',
          zoomPreset,
        }),
      })

      upsertReadingHistory({
        chapterId,
        seriesId: chapterPayload.manifest.seriesId,
        chapterTitle: chapterPayload.manifest.title,
        pageIndex: currentTargetPageIndex,
        mode,
      })
    }, 220)

    return () => {
      clearTimeout(timeout)
    }
  }, [
    chapterId,
    chapterPayload,
    currentStepIndex,
    currentTargetPageIndex,
    mode,
    zoomPreset,
  ])

  const goToPage = useCallback(
    (nextPageIndex: number) => {
      const safeIndex = clamp(nextPageIndex, 0, maxPageIndex)
      setCurrentPageIndex(safeIndex)
      setCurrentStepIndex(findStepIndexByPageIndex(twoPageSteps, safeIndex))
    },
    [maxPageIndex, twoPageSteps],
  )

  const persistProgressNow = useCallback(
    (pageIndex: number, stepIndex: number) => {
      if (!chapterPayload) {
        return
      }

      void fetch(`/api/chapter/${chapterId}/progress`, {
        keepalive: true,
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chapterId,
          pageIndex,
          stepIndex,
          mode,
          direction: 'rtl',
          zoomPreset,
        }),
      })

      optimisticLocalProgress.set(chapterId, {
        chapterId,
        pageIndex,
        stepIndex,
        mode,
        direction: 'rtl',
        zoomPreset,
        updatedAt: Date.now(),
      })

      upsertReadingHistory({
        chapterId,
        seriesId: chapterPayload.manifest.seriesId,
        chapterTitle: chapterPayload.manifest.title,
        pageIndex,
        mode,
      })
    },
    [chapterId, chapterPayload, mode, zoomPreset],
  )

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

  const goToNextChapter = useCallback(() => {
    if (!nextChapterId || chapterTransitionRef.current) {
      return
    }

    chapterTransitionRef.current = true
    setShowPageHud(false)
    persistProgressNow(maxPageIndex, maxStepIndex)
    void navigate({
      to: '/reader/$chapterId',
      params: { chapterId: nextChapterId },
    })
  }, [maxPageIndex, maxStepIndex, navigate, nextChapterId, persistProgressNow])

  const goToPreviousChapter = useCallback(() => {
    if (!previousChapterId || chapterTransitionRef.current) {
      return
    }

    chapterTransitionRef.current = true
    setShowPageHud(false)
    persistProgressNow(currentTargetPageIndex, currentStepIndex)
    void navigate({
      to: '/reader/$chapterId',
      params: { chapterId: previousChapterId },
    })
  }, [
    currentStepIndex,
    currentTargetPageIndex,
    navigate,
    persistProgressNow,
    previousChapterId,
  ])

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
        goToNextChapter()
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
      goToNextChapter()
      return
    }

    goToPage(currentPageIndex + 1)
  }, [
    currentPageIndex,
    currentStepIndex,
    goToNextChapter,
    goToPage,
    maxPageIndex,
    maxStepIndex,
    mode,
    twoPageSteps,
  ])

  const goPrevious = useCallback(() => {
    if (mode === 'double') {
      const previous = clamp(currentStepIndex - 1, 0, maxStepIndex)
      setCurrentStepIndex(previous)
      setCurrentPageIndex(
        twoPageSteps[previous]?.anchorPageIndex ?? currentPageIndex,
      )
      return
    }

    goToPage(currentPageIndex - 1)
  }, [
    currentPageIndex,
    currentStepIndex,
    goToPage,
    maxStepIndex,
    mode,
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
        goToNextChapter()
        return
      }

      if (event.key === ']') {
        event.preventDefault()
        blurReaderFocusTarget()
        goToPreviousChapter()
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
    goToNextChapter,
    goToPreviousChapter,
    toggleFullscreen,
  ])

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
    if (isFullscreen) {
      showPageHudForMoment()
    }
  }, [
    currentStepIndex,
    currentTargetPageIndex,
    isFullscreen,
    showPageHudForMoment,
  ])

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

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-surface p-6 text-muted-foreground">
        Loading reader…
      </div>
    )
  }

  if (error || !chapterPayload) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-destructive">
        {error ?? 'Chapter failed to load'}
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
            <Link
              to="/series/$seriesId"
              params={{ seriesId: chapterPayload.manifest.seriesId }}
              className="inline-flex hover:text-foreground"
            >
              Back
            </Link>
            <p className="truncate text-sm font-medium text-foreground">
              {chapterPayload.manifest.title}
            </p>
            <p>
              Ch {chapterPayload.manifest.chapterNumber} ·{' '}
              {chapterPayload.manifest.pageCount}p
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
              data-testid="zoom-select"
              options={[
                { value: 'fit-height', label: 'Fit Height' },
                { value: 'fit-width', label: 'Fit Width' },
                { value: 'actual', label: 'Actual' },
              ]}
            />

            {seriesChapters.length > 0 ? (
              <SelectField
                value={chapterPayload.manifest.chapterId}
                onChange={(event) => {
                  const nextId = event.target.value
                  if (nextId === chapterPayload.manifest.chapterId) {
                    return
                  }
                  persistProgressNow(currentTargetPageIndex, currentStepIndex)
                  void navigate({
                    to: '/reader/$chapterId',
                    params: { chapterId: nextId },
                  })
                }}
                className="h-9"
                options={seriesChapters.map((chapter) => ({
                  value: chapter.id,
                  label: `Ch ${chapter.chapterNumber}`,
                }))}
              />
            ) : null}

            <Link
              to="/series/$seriesId"
              params={{ seriesId: chapterPayload.manifest.seriesId }}
              className="inline-flex h-9 items-center justify-center border border-border bg-surface-soft text-xs text-muted-foreground hover:text-foreground"
            >
              Go to series
            </Link>

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
                data-testid="page-scrubber"
              />
            </label>
          </div>

          <div className="mt-3 flex items-center justify-between gap-2">
            <Button
              variant="soft"
              className="w-full"
              onClick={goPrevious}
              data-testid="nav-prev"
            >
              Previous
            </Button>
            <Button
              variant="soft"
              className="w-full"
              onClick={goNext}
              data-testid="nav-next"
            >
              Next
            </Button>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Button
              variant="ghost"
              className="w-full border border-border"
              onClick={goToPreviousChapter}
              disabled={!previousChapterId}
            >
              ] Prev chapter
            </Button>
            <Button
              variant="ghost"
              className="w-full border border-border"
              onClick={goToNextChapter}
              disabled={!nextChapterId}
            >
              [ Next chapter
            </Button>
          </div>
          <p
            className="mt-3 text-sm text-muted-foreground"
            data-testid="position-label"
          >
            {mode === 'double'
              ? `Spread ${currentStepIndex + 1} / ${Math.max(twoPageSteps.length, 1)}`
              : `Page ${currentTargetPageIndex + 1} / ${Math.max(pages.length, 1)}`}
          </p>
        </aside>
      ) : null}

      <section className={isFullscreen ? '' : 'h-full'} ref={readerStageRef}>
        {mode === 'scroll' ? (
          <div className="relative" onMouseMove={showPageHudForMoment}>
            <ContinuousScroll
              chapterId={chapterId}
              pages={pages}
              zoomPreset={zoomPreset}
              isFullscreen={isFullscreen}
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
            <div
              className="flex h-full items-center justify-center gap-0"
              data-testid="reader-paging-container"
            >
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
                    chapterId={chapterId}
                    unit={unit}
                    page={page}
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
