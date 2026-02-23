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
interface RemotePageDimension {
  width: number
  height: number
}
const remotePageDimensionsCache = new Map<
  string,
  Record<number, RemotePageDimension>
>()
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
  pageDimensions: Record<number, RemotePageDimension> = {},
): ChapterPageManifest[] {
  return chapter.pages.map((_, pageIndex) => {
    const measured = pageDimensions[pageIndex]
    const width = measured?.width ?? 1200
    const height = measured?.height ?? 1800

    return {
      id: `${chapter.chapterId}:${pageIndex}`,
      chapterId: chapter.chapterId,
      pageIndex,
      width,
      height,
      aspect: width / Math.max(height, 1),
      autoIsSpread: width > height * 1.02,
      splitSpread: null,
    }
  })
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
  const [settingsTab, setSettingsTab] = useState<'basic' | 'advanced'>('basic')
  const [preloadAhead, setPreloadAhead] = useState<number>(
    () => loadReaderUiPrefs(REMOTE_READER_UI_PREFS_KEY)?.preloadAhead ?? 8,
  )
  const [preloadBehind, setPreloadBehind] = useState<number>(
    () => loadReaderUiPrefs(REMOTE_READER_UI_PREFS_KEY)?.preloadBehind ?? 4,
  )
  const [prefetchConcurrency, setPrefetchConcurrency] = useState<number>(
    () =>
      loadReaderUiPrefs(REMOTE_READER_UI_PREFS_KEY)?.prefetchConcurrency ?? 2,
  )
  const [nextChapterPrefetchThreshold, setNextChapterPrefetchThreshold] =
    useState<number>(
      () =>
        loadReaderUiPrefs(REMOTE_READER_UI_PREFS_KEY)
          ?.nextChapterPrefetchThreshold ?? 8,
    )
  const [nextChapterWarmPages, setNextChapterWarmPages] = useState<number>(
    () =>
      loadReaderUiPrefs(REMOTE_READER_UI_PREFS_KEY)?.nextChapterWarmPages ?? 4,
  )
  const [uiAutoHideMs, setUiAutoHideMs] = useState<number>(
    () => loadReaderUiPrefs(REMOTE_READER_UI_PREFS_KEY)?.uiAutoHideMs ?? 1400,
  )
  const [magnifierEnabled, setMagnifierEnabled] = useState(false)
  const [magnifierSize, setMagnifierSize] = useState<number>(
    () => loadReaderUiPrefs(REMOTE_READER_UI_PREFS_KEY)?.magnifierSize ?? 220,
  )
  const [magnifierZoom, setMagnifierZoom] = useState<number>(
    () => loadReaderUiPrefs(REMOTE_READER_UI_PREFS_KEY)?.magnifierZoom ?? 2.4,
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
  const [pageDimensions, setPageDimensions] = useState<
    Record<number, RemotePageDimension>
  >({})
  const [currentPageIndex, setCurrentPageIndex] = useState(0)
  const [currentStepIndex, setCurrentStepIndex] = useState(0)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [showPageHud, setShowPageHud] = useState(false)

  const viewportRef = useRef<HTMLDivElement>(null)
  const readerStageRef = useRef<HTMLElement>(null)
  const pageHudTimeoutRef = useRef<number | null>(null)
  const readerUiTimeoutRef = useRef<number | null>(null)
  const dragStateRef = useRef<{
    active: boolean
    startX: number
    startY: number
    scrollLeft: number
    scrollTop: number
  } | null>(null)

  const pages = useMemo(
    () => (chapter ? createPlaceholderPages(chapter, pageDimensions) : []),
    [chapter, pageDimensions],
  )

  const pageUrlMap = useMemo(() => {
    const map = new Map<number, string>()
    chapter?.pages.forEach((page, index) => {
      map.set(index, page.url)
    })
    return map
  }, [chapter])

  const rememberPageDimension = useCallback(
    (pageIndex: number, width: number, height: number) => {
      if (!chapter || width <= 0 || height <= 0) {
        return
      }

      setPageDimensions((current) => {
        const existing = current[pageIndex]
        if (
          existing &&
          existing.width === width &&
          existing.height === height
        ) {
          return current
        }

        const next = {
          ...current,
          [pageIndex]: { width, height },
        }
        remotePageDimensionsCache.set(chapter.chapterId, next)
        return next
      })
    },
    [chapter],
  )

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

  const orderedSeriesChapters = useMemo(
    () => series?.chapters ?? [],
    [series?.chapters],
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
        completed: pageIndex >= maxPageIndex,
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
    setPageDimensions({})
    setCurrentPageIndex(0)
    setCurrentStepIndex(0)

    const applyChapterState = (chapterPayload: WeebcentralChapterDTO) => {
      setChapter(chapterPayload)

      const cachedDimensions =
        remotePageDimensionsCache.get(chapterPayload.chapterId) ?? {}
      setPageDimensions(cachedDimensions)

      const chapterPages = createPlaceholderPages(
        chapterPayload,
        cachedDimensions,
      )

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
            chapterPages.map(asPairingPage),
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
  }, [params.chapterId, search.seriesId])

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
    void loadRemoteChapter()
  }, [loadRemoteChapter])

  useEffect(() => {
    saveReaderUiPrefs(REMOTE_READER_UI_PREFS_KEY, {
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
      completed: currentTargetPageIndex >= maxPageIndex,
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
    const start = Math.max(0, currentTargetPageIndex - preloadBehind)
    const end = Math.min(
      (chapter?.pages.length ?? 1) - 1,
      currentTargetPageIndex + preloadAhead,
    )
    const pagesToWarm = chapter?.pages
      .slice(start, end + 1)
      .map((page, offset) => ({
        url: page.url,
        pageIndex: start + offset,
      }))
      .filter((entry) => entry.pageIndex !== currentTargetPageIndex)

    if (!pagesToWarm || pagesToWarm.length === 0) {
      return
    }

    const images = pagesToWarm.map(({ url, pageIndex }) => {
      const image = new Image()
      image.decoding = 'async'
      image.addEventListener('load', () => {
        rememberPageDimension(
          pageIndex,
          image.naturalWidth,
          image.naturalHeight,
        )
      })
      image.src = url
      return image
    })

    return () => {
      images.forEach((image) => {
        image.src = ''
      })
    }
  }, [
    chapter,
    currentTargetPageIndex,
    preloadAhead,
    preloadBehind,
    rememberPageDimension,
  ])

  useEffect(() => {
    if (!nextChapterId || pages.length === 0) {
      return
    }

    const shouldPrefetchNextChapter =
      currentTargetPageIndex >= maxPageIndex - nextChapterPrefetchThreshold
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

        const warmCount = Math.min(nextChapterWarmPages, payload.pages.length)
        const workerCount = Math.max(
          1,
          Math.min(prefetchConcurrency, warmCount),
        )
        let cursor = 0

        const warmWorker = async () => {
          while (cursor < warmCount && !controller.signal.aborted) {
            const pageIndex = cursor
            cursor += 1
            const page = payload.pages[pageIndex]
            if (!page) {
              continue
            }

            try {
              await fetch(page.url, {
                signal: controller.signal,
                cache: 'force-cache',
              })
            } catch {
              // Ignore warm failures.
            }

            const image = new Image()
            image.decoding = 'async'
            image.addEventListener('load', () => {
              const current = remotePageDimensionsCache.get(nextChapterId) ?? {}
              const existing = current[pageIndex]
              if (
                existing &&
                existing.width === image.naturalWidth &&
                existing.height === image.naturalHeight
              ) {
                return
              }

              remotePageDimensionsCache.set(nextChapterId, {
                ...current,
                [pageIndex]: {
                  width: image.naturalWidth,
                  height: image.naturalHeight,
                },
              })
            })
            image.src = page.url
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
    nextChapterId,
    nextChapterPrefetchThreshold,
    nextChapterWarmPages,
    pages.length,
    prefetchConcurrency,
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
    goToChapter,
    magnifierEnabled,
    nextChapterId,
    previousChapterId,
    revealReaderUi,
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
                options={[
                  { value: 'fit-height', label: 'Fit Height' },
                  { value: 'fit-width', label: 'Fit Width' },
                  { value: 'actual', label: 'Actual' },
                ]}
              />

              {orderedSeriesChapters.length ? (
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
                  options={orderedSeriesChapters.map((entry) => ({
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
          <div className="relative" onMouseMove={handleReaderMouseMove}>
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
            <div className="flex h-full items-center justify-center gap-0">
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
                    chapterId={chapter.chapterId}
                    unit={unit}
                    page={page}
                    imageUrl={pageUrlMap.get(page.pageIndex)}
                    zoomPreset={zoomPreset}
                    loading="eager"
                    testId="reader-page-container"
                    onImageMeasure={rememberPageDimension}
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
