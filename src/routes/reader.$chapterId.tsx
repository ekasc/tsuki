import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'

const createAnyFileRoute = createFileRoute as any
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from 'react'

import { ContinuousScroll } from '#/components/reader/continuous-scroll'
import { PagePane } from '#/components/reader/page-pane'
import { Button } from '#/components/ui/button'
import {
  ReaderEdgeArrowButton,
  ReaderTapZone,
} from '#/components/ui/reader-overlay-controls'
import { Input } from '#/components/ui/input'
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
  preloadAhead: number
  preloadBehind: number
  prefetchConcurrency: number
  nextChapterPrefetchThreshold: number
  nextChapterWarmPages: number
  uiAutoHideMs: number
  magnifierSize: number
  magnifierZoom: number
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
      preloadAhead:
        typeof parsed.preloadAhead === 'number'
          ? Math.max(1, Math.min(24, Math.floor(parsed.preloadAhead)))
          : 8,
      preloadBehind:
        typeof parsed.preloadBehind === 'number'
          ? Math.max(0, Math.min(12, Math.floor(parsed.preloadBehind)))
          : 4,
      prefetchConcurrency:
        typeof parsed.prefetchConcurrency === 'number'
          ? Math.max(1, Math.min(8, Math.floor(parsed.prefetchConcurrency)))
          : 2,
      nextChapterPrefetchThreshold:
        typeof parsed.nextChapterPrefetchThreshold === 'number'
          ? Math.max(
              1,
              Math.min(24, Math.floor(parsed.nextChapterPrefetchThreshold)),
            )
          : 8,
      nextChapterWarmPages:
        typeof parsed.nextChapterWarmPages === 'number'
          ? Math.max(1, Math.min(16, Math.floor(parsed.nextChapterWarmPages)))
          : 4,
      uiAutoHideMs:
        typeof parsed.uiAutoHideMs === 'number'
          ? Math.max(400, Math.min(5000, Math.floor(parsed.uiAutoHideMs)))
          : 1400,
      magnifierSize:
        typeof parsed.magnifierSize === 'number'
          ? Math.max(120, Math.min(420, Math.floor(parsed.magnifierSize)))
          : 220,
      magnifierZoom:
        typeof parsed.magnifierZoom === 'number'
          ? Math.max(2, Math.min(5, parsed.magnifierZoom))
          : 2.4,
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

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min
  }

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
  const [settingsTab, setSettingsTab] = useState<'basic' | 'advanced'>('basic')
  const [preloadAhead, setPreloadAhead] = useState<number>(
    () => loadReaderUiPrefs(LOCAL_READER_UI_PREFS_KEY)?.preloadAhead ?? 8,
  )
  const [preloadBehind, setPreloadBehind] = useState<number>(
    () => loadReaderUiPrefs(LOCAL_READER_UI_PREFS_KEY)?.preloadBehind ?? 4,
  )
  const [prefetchConcurrency, setPrefetchConcurrency] = useState<number>(
    () =>
      loadReaderUiPrefs(LOCAL_READER_UI_PREFS_KEY)?.prefetchConcurrency ?? 2,
  )
  const [nextChapterPrefetchThreshold, setNextChapterPrefetchThreshold] =
    useState<number>(
      () =>
        loadReaderUiPrefs(LOCAL_READER_UI_PREFS_KEY)
          ?.nextChapterPrefetchThreshold ?? 8,
    )
  const [nextChapterWarmPages, setNextChapterWarmPages] = useState<number>(
    () =>
      loadReaderUiPrefs(LOCAL_READER_UI_PREFS_KEY)?.nextChapterWarmPages ?? 4,
  )
  const [uiAutoHideMs, setUiAutoHideMs] = useState<number>(
    () => loadReaderUiPrefs(LOCAL_READER_UI_PREFS_KEY)?.uiAutoHideMs ?? 1400,
  )
  const [magnifierEnabled, setMagnifierEnabled] = useState(false)
  const [magnifierSize, setMagnifierSize] = useState<number>(
    () => loadReaderUiPrefs(LOCAL_READER_UI_PREFS_KEY)?.magnifierSize ?? 220,
  )
  const [magnifierZoom, setMagnifierZoom] = useState<number>(
    () => loadReaderUiPrefs(LOCAL_READER_UI_PREFS_KEY)?.magnifierZoom ?? 2.4,
  )
  const [showReaderChrome, setShowReaderChrome] = useState(false)
  const [magnifierFrame, setMagnifierFrame] = useState<{
    x: number
    y: number
    src: string
    relX: number
    relY: number
    width: number
    height: number
  } | null>(null)

  const [currentPageIndex, setCurrentPageIndex] = useState(0)
  const [currentStepIndex, setCurrentStepIndex] = useState(0)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [showPageHud, setShowPageHud] = useState(false)

  const viewportRef = useRef<HTMLDivElement>(null)
  const readerStageRef = useRef<HTMLElement>(null)
  const chapterTransitionRef = useRef(false)
  const pageHudTimeoutRef = useRef<number | null>(null)
  const readerUiTimeoutRef = useRef<number | null>(null)
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

  const displayUnits = useMemo(() => {
    if (mode !== 'double' || renderedUnits.length <= 1) {
      return renderedUnits
    }

    const spreadUnit = renderedUnits.find((unit) => {
      const page = pages.find((entry) => entry.pageIndex === unit.pageIndex)
      if (!page) {
        return false
      }

      return page.autoIsSpread || page.aspect >= 0.95
    })

    return spreadUnit ? [spreadUnit] : renderedUnits
  }, [mode, pages, renderedUnits])

  const hudPageLabel = useMemo(() => {
    if (pages.length === 0) {
      return 'Page 0 / 0'
    }

    if (mode !== 'double') {
      return `Page ${currentTargetPageIndex + 1} / ${pages.length}`
    }

    const visibleIndexes = displayUnits
      .map((unit) => unit.pageIndex)
      .sort((left, right) => left - right)

    if (visibleIndexes.length <= 1) {
      const safeIndex = visibleIndexes[0] ?? currentTargetPageIndex
      return `Page ${safeIndex + 1} / ${pages.length}`
    }

    const first = visibleIndexes[0]!
    const last = visibleIndexes[visibleIndexes.length - 1]!
    return `Pages ${first + 1}-${last + 1} / ${pages.length}`
  }, [currentTargetPageIndex, displayUnits, mode, pages.length])

  const orderedSeriesChapters = useMemo(
    () =>
      [...seriesChapters].sort((left, right) => {
        if (left.chapterNumber !== right.chapterNumber) {
          return left.chapterNumber - right.chapterNumber
        }

        return left.sortIndex - right.sortIndex
      }),
    [seriesChapters],
  )

  useImagePrefetch({
    chapterId,
    startPageIndex: currentTargetPageIndex,
    totalPages: pages.length,
    enabled: pages.length > 0,
    lookahead: preloadAhead,
    lookbehind: preloadBehind,
    concurrency: prefetchConcurrency,
  })

  useEffect(() => {
    if (!nextChapterId || pages.length === 0) {
      return
    }

    const shouldPrefetchNextChapter =
      currentTargetPageIndex >= maxPageIndex - nextChapterPrefetchThreshold
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

        const warmCount = Math.min(
          nextChapterWarmPages,
          payload.manifest.pages.length,
        )
        const workerCount = Math.max(
          1,
          Math.min(prefetchConcurrency, warmCount),
        )
        let cursor = 0

        const warmWorker = async () => {
          while (cursor < warmCount && !controller.signal.aborted) {
            const index = cursor
            cursor += 1

            try {
              await fetch(`/api/image/${nextChapterId}/${index}`, {
                signal: controller.signal,
                cache: 'force-cache',
              })
            } catch {
              // Ignore warm failures.
            }
          }
        }

        await Promise.all(Array.from({ length: workerCount }, warmWorker))
      } catch {
        // Ignore prefetch failures; regular navigation still works.
      }
    })()

    return () => {
      controller.abort()
    }
  }, [
    currentTargetPageIndex,
    maxPageIndex,
    nextChapterPrefetchThreshold,
    nextChapterWarmPages,
    nextChapterId,
    pages.length,
    prefetchConcurrency,
  ])

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
  }, [params.chapterId])

  useEffect(() => {
    if (mode !== 'double') {
      return
    }

    const nextStepIndex = findStepIndexByPageIndex(
      twoPageSteps,
      currentTargetPageIndex,
    )

    setCurrentStepIndex((current) =>
      current === nextStepIndex ? current : nextStepIndex,
    )
  }, [currentTargetPageIndex, mode, twoPageSteps])

  useEffect(() => {
    void loadChapter()
  }, [loadChapter])

  useEffect(() => {
    saveReaderUiPrefs(LOCAL_READER_UI_PREFS_KEY, {
      mode,
      zoomPreset,
      sidebarOpen,
      doublePageOffset,
      preloadAhead,
      preloadBehind,
      prefetchConcurrency,
      nextChapterPrefetchThreshold,
      nextChapterWarmPages,
      uiAutoHideMs,
      magnifierSize,
      magnifierZoom,
    })
  }, [
    doublePageOffset,
    magnifierSize,
    magnifierZoom,
    mode,
    nextChapterPrefetchThreshold,
    nextChapterWarmPages,
    prefetchConcurrency,
    preloadAhead,
    preloadBehind,
    sidebarOpen,
    uiAutoHideMs,
    zoomPreset,
  ])

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
        completed: currentTargetPageIndex >= maxPageIndex,
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
    maxPageIndex,
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
        completed: pageIndex >= maxPageIndex,
      })
    },
    [chapterId, chapterPayload, maxPageIndex, mode, zoomPreset],
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

  const revealReaderUi = useCallback(() => {
    setShowReaderChrome(true)

    if (readerUiTimeoutRef.current !== null) {
      window.clearTimeout(readerUiTimeoutRef.current)
      readerUiTimeoutRef.current = null
    }

    if (sidebarOpen) {
      return
    }

    readerUiTimeoutRef.current = window.setTimeout(() => {
      setShowReaderChrome(false)
      readerUiTimeoutRef.current = null
    }, uiAutoHideMs)
  }, [sidebarOpen, uiAutoHideMs])

  const updateMagnifierFrame = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (!magnifierEnabled) {
        return
      }

      const element = document.elementFromPoint(
        event.clientX,
        event.clientY,
      ) as HTMLElement | null
      const image = element?.closest('img') as HTMLImageElement | null

      if (!image) {
        setMagnifierFrame(null)
        return
      }

      const rect = image.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) {
        setMagnifierFrame(null)
        return
      }

      const relX = clampNumber(event.clientX - rect.left, 0, rect.width)
      const relY = clampNumber(event.clientY - rect.top, 0, rect.height)

      setMagnifierFrame({
        x: event.clientX,
        y: event.clientY,
        src: image.currentSrc || image.src,
        relX,
        relY,
        width: rect.width,
        height: rect.height,
      })
    },
    [magnifierEnabled],
  )

  const handleReaderMouseMove = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      revealReaderUi()
      showPageHudForMoment()
      updateMagnifierFrame(event)
    },
    [revealReaderUi, showPageHudForMoment, updateMagnifierFrame],
  )

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

      if (event.code === 'KeyZ' || event.key === 'z' || event.key === 'Z') {
        event.preventDefault()
        event.stopPropagation()
        blurReaderFocusTarget()
        setMagnifierEnabled((value) => !value)
        if (magnifierEnabled) {
          setMagnifierFrame(null)
        }
        revealReaderUi()
        return
      }
    }

    const suppressOKeypress = (event: KeyboardEvent) => {
      if (event.key === 'o' || event.key === 'O') {
        event.preventDefault()
        event.stopPropagation()
      }
    }

    window.addEventListener('keydown', handler, true)
    window.addEventListener('keypress', suppressOKeypress, true)

    return () => {
      window.removeEventListener('keydown', handler, true)
      window.removeEventListener('keypress', suppressOKeypress, true)
    }
  }, [
    cycleMode,
    goNext,
    goPrevious,
    goToNextChapter,
    goToPreviousChapter,
    magnifierEnabled,
    revealReaderUi,
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

  useEffect(() => {
    if (sidebarOpen) {
      setShowReaderChrome(true)
      if (readerUiTimeoutRef.current !== null) {
        window.clearTimeout(readerUiTimeoutRef.current)
        readerUiTimeoutRef.current = null
      }
      return
    }

    setShowReaderChrome(false)
  }, [sidebarOpen])

  useEffect(
    () => () => {
      if (pageHudTimeoutRef.current !== null) {
        window.clearTimeout(pageHudTimeoutRef.current)
      }

      if (readerUiTimeoutRef.current !== null) {
        window.clearTimeout(readerUiTimeoutRef.current)
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
      onMouseMove={handleReaderMouseMove}
      onMouseLeave={() => {
        setMagnifierFrame(null)
      }}
    >
      {!isFullscreen ? (
        <Button
          variant="ghost"
          size="icon"
          className={`absolute top-4 z-50 size-10 border border-white/25 bg-black/35 text-white backdrop-blur transition-transform duration-200 ${sidebarOpen ? 'left-[292px]' : 'left-3'} ${showReaderChrome || sidebarOpen ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
          onClick={() => setSidebarOpen((current) => !current)}
          type="button"
        >
          {sidebarOpen ? '\u2039' : '\u203a'}
        </Button>
      ) : null}

      {!isFullscreen ? (
        <aside
          className={`animate-enter absolute inset-y-0 left-0 z-40 w-[280px] overflow-y-auto border-r border-border bg-surface p-3 shadow-[0_20px_40px_-30px_var(--shadow)] transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
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

          <div className="mt-3 flex gap-2">
            <Button
              type="button"
              variant={settingsTab === 'basic' ? 'default' : 'soft'}
              className="h-8 w-full"
              onClick={() => setSettingsTab('basic')}
            >
              Basic
            </Button>
            <Button
              type="button"
              variant={settingsTab === 'advanced' ? 'default' : 'soft'}
              className="h-8 w-full"
              onClick={() => setSettingsTab('advanced')}
            >
              Advanced
            </Button>
          </div>

          {settingsTab === 'basic' ? (
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

              <Button
                type="button"
                variant={magnifierEnabled ? 'default' : 'soft'}
                className="h-9 justify-between px-3"
                onClick={() => setMagnifierEnabled((value) => !value)}
              >
                <span>Magnifier (Z)</span>
                <span>{magnifierEnabled ? 'On' : 'Off'}</span>
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
                  options={orderedSeriesChapters.map((chapter) => ({
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
          ) : (
            <div className="mt-3 grid gap-2 text-xs text-muted-foreground">
              <label>
                Preload ahead pages
                <Input
                  type="number"
                  min={1}
                  max={24}
                  value={preloadAhead}
                  onChange={(event) =>
                    setPreloadAhead(
                      clampNumber(
                        Number.parseInt(event.target.value, 10),
                        1,
                        24,
                      ),
                    )
                  }
                  className="mt-1 h-8"
                />
              </label>
              <label>
                Preload behind pages
                <Input
                  type="number"
                  min={0}
                  max={12}
                  value={preloadBehind}
                  onChange={(event) =>
                    setPreloadBehind(
                      clampNumber(
                        Number.parseInt(event.target.value, 10),
                        0,
                        12,
                      ),
                    )
                  }
                  className="mt-1 h-8"
                />
              </label>
              <label>
                Parallel preloads
                <Input
                  type="number"
                  min={1}
                  max={8}
                  value={prefetchConcurrency}
                  onChange={(event) =>
                    setPrefetchConcurrency(
                      clampNumber(
                        Number.parseInt(event.target.value, 10),
                        1,
                        8,
                      ),
                    )
                  }
                  className="mt-1 h-8"
                />
              </label>
              <label>
                Next chapter prefetch trigger (remaining pages)
                <Input
                  type="number"
                  min={1}
                  max={24}
                  value={nextChapterPrefetchThreshold}
                  onChange={(event) =>
                    setNextChapterPrefetchThreshold(
                      clampNumber(
                        Number.parseInt(event.target.value, 10),
                        1,
                        24,
                      ),
                    )
                  }
                  className="mt-1 h-8"
                />
              </label>
              <label>
                Next chapter warm pages
                <Input
                  type="number"
                  min={1}
                  max={16}
                  value={nextChapterWarmPages}
                  onChange={(event) =>
                    setNextChapterWarmPages(
                      clampNumber(
                        Number.parseInt(event.target.value, 10),
                        1,
                        16,
                      ),
                    )
                  }
                  className="mt-1 h-8"
                />
              </label>
              <label>
                UI hide delay (ms)
                <Input
                  type="number"
                  min={400}
                  max={5000}
                  step={100}
                  value={uiAutoHideMs}
                  onChange={(event) =>
                    setUiAutoHideMs(
                      clampNumber(
                        Number.parseInt(event.target.value, 10),
                        400,
                        5000,
                      ),
                    )
                  }
                  className="mt-1 h-8"
                />
              </label>
              <label>
                Magnifier size (px)
                <Input
                  type="number"
                  min={120}
                  max={420}
                  value={magnifierSize}
                  onChange={(event) =>
                    setMagnifierSize(
                      clampNumber(
                        Number.parseInt(event.target.value, 10),
                        120,
                        420,
                      ),
                    )
                  }
                  className="mt-1 h-8"
                />
              </label>
              <label>
                Magnifier zoom
                <Input
                  type="number"
                  min={2}
                  max={5}
                  step={0.1}
                  value={magnifierZoom}
                  onChange={(event) =>
                    setMagnifierZoom(
                      clampNumber(Number.parseFloat(event.target.value), 2, 5),
                    )
                  }
                  className="mt-1 h-8"
                />
              </label>
            </div>
          )}

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
          <div className="relative" onMouseMove={handleReaderMouseMove}>
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
            onMouseMove={handleReaderMouseMove}
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
                : displayUnits
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
            {!isFullscreen && showReaderChrome ? (
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

      {magnifierEnabled && magnifierFrame ? (
        <div
          className="pointer-events-none fixed z-[90] overflow-hidden border border-white/50 bg-black/25 backdrop-blur-[1px]"
          style={{
            width: magnifierSize,
            height: magnifierSize,
            left: magnifierFrame.x - magnifierSize / 2,
            top: magnifierFrame.y - magnifierSize / 2,
          }}
        >
          <img
            src={magnifierFrame.src}
            alt=""
            className="absolute max-w-none select-none"
            draggable={false}
            style={{
              width: magnifierFrame.width * magnifierZoom,
              height: magnifierFrame.height * magnifierZoom,
              left: magnifierSize / 2 - magnifierFrame.relX * magnifierZoom,
              top: magnifierSize / 2 - magnifierFrame.relY * magnifierZoom,
            }}
          />
          <div className="absolute inset-0 border border-white/20" />
        </div>
      ) : null}
    </div>
  )
}
