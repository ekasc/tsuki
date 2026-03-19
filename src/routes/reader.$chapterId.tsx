import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import readerCss from '../reader.css?url'

import {
  useCallback,
  useEffect,
  useMemo,
  type PointerEvent as ReactPointerEvent,
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
import { setBoundedMapEntry } from '#/lib/bounded-cache'
import { resolveApiUrl } from '#/lib/http-client'
import { isLocalSessionChapterAllowed } from '#/lib/local-upload-session'
import {
  localChapterQueryOptions,
  localSeriesQueryOptions,
} from '#/lib/query-options'
import type { AppRouterContext } from '#/lib/router-context'
import { upsertReadingHistory } from '#/lib/reading-history'
import {
  buildTwoPageSteps,
  findStepIndexByPageIndex,
  inferAutoSpreadFlags,
  type PairingPage,
  type PairingStep,
  type RenderUnit,
} from '#/lib/reader/pairing'
import { useImagePrefetch } from '#/hooks/use-image-prefetch'
import { useTouchDevice, useTouchPortrait } from '#/hooks/use-touch-portrait'

export const Route = createFileRoute('/reader/$chapterId')({
  headers: () => ({
    'X-Robots-Tag': 'noindex, nofollow',
  }),
  head: () => ({
    meta: [
      { title: 'Tsuki reader' },
      { name: 'robots', content: 'noindex,nofollow' },
    ],
    links: [{ rel: 'stylesheet', href: readerCss }],
  }),
  loader: async ({
    params,
    context,
  }: {
    params: { chapterId: string }
    context: AppRouterContext
  }) => {
    if (typeof window === 'undefined') {
      return null
    }

    return context.queryClient.ensureQueryData(
      localChapterQueryOptions(params.chapterId),
    )
  },
  staleTime: 120_000,
  preloadStaleTime: 240_000,
  gcTime: 15 * 60_000,
  component: ReaderPage,
})

const prefetchedLocalChapterPayloads = new Map<string, ChapterPayload>()
const prefetchedLocalSeriesDetails = new Map<string, SeriesDetail>()
const inFlightLocalChapterPrefetches = new Set<string>()
const optimisticLocalProgress = new Map<string, ChapterProgress>()
const PREFETCHED_LOCAL_CHAPTER_LIMIT = 48
const PREFETCHED_LOCAL_SERIES_LIMIT = 48
const OPTIMISTIC_PROGRESS_LIMIT = 240
const LOCAL_READER_UI_PREFS_KEY = 'tsuki-local-reader-ui.v1'
const LEGACY_LOCAL_READER_UI_PREFS_KEY = 'suki-local-reader-ui.v1'
const LOCAL_READER_SERIES_PRESETS_KEY = 'tsuki-local-reader-series-presets.v1'
const LEGACY_LOCAL_READER_SERIES_PRESETS_KEY =
  'suki-local-reader-series-presets.v1'
const LOCAL_READER_OPENING_LINES = [
  'Warming up page turns…',
  'Restoring your place…',
  'Aligning spread edges…',
] as const

function readStorageWithLegacy(key: string, legacyKey: string): string | null {
  const value = window.localStorage.getItem(key)
  if (value) {
    return value
  }

  const legacyValue = window.localStorage.getItem(legacyKey)
  if (!legacyValue) {
    return null
  }

  window.localStorage.setItem(key, legacyValue)
  return legacyValue
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

const DEFAULT_LOCAL_READER_UI_PREFS: ReaderUiPrefs = {
  mode: 'single',
  zoomPreset: 'fit-width',
  sidebarOpen: false,
  doublePageOffset: false,
  preloadAhead: 8,
  preloadBehind: 4,
  prefetchConcurrency: 2,
  nextChapterPrefetchThreshold: 8,
  nextChapterWarmPages: 4,
  uiAutoHideMs: 1400,
  magnifierSize: 220,
  magnifierZoom: 2.4,
}

interface ReaderSeriesPreset {
  mode: ReaderMode
  zoomPreset: ZoomPreset
  doublePageOffset: boolean
  magnifierEnabled: boolean
  focusMode: boolean
}

function loadReaderSeriesPreset(seriesId: string): ReaderSeriesPreset | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const raw = readStorageWithLegacy(
      LOCAL_READER_SERIES_PRESETS_KEY,
      LEGACY_LOCAL_READER_SERIES_PRESETS_KEY,
    )
    if (!raw) {
      return null
    }

    const payload = JSON.parse(raw) as Record<
      string,
      Partial<ReaderSeriesPreset>
    >
    const preset = payload[seriesId]
    if (!preset) {
      return null
    }

    return {
      mode:
        preset.mode === 'double' || preset.mode === 'scroll'
          ? preset.mode
          : 'single',
      zoomPreset:
        preset.zoomPreset === 'fit-width' || preset.zoomPreset === 'actual'
          ? preset.zoomPreset
          : 'fit-width',
      doublePageOffset: Boolean(preset.doublePageOffset),
      magnifierEnabled: Boolean(preset.magnifierEnabled),
      focusMode: Boolean(preset.focusMode),
    }
  } catch {
    return null
  }
}

function saveReaderSeriesPreset(seriesId: string, preset: ReaderSeriesPreset) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    const raw = readStorageWithLegacy(
      LOCAL_READER_SERIES_PRESETS_KEY,
      LEGACY_LOCAL_READER_SERIES_PRESETS_KEY,
    )
    const payload = raw
      ? (JSON.parse(raw) as Record<string, ReaderSeriesPreset>)
      : {}

    payload[seriesId] = preset
    window.localStorage.setItem(
      LOCAL_READER_SERIES_PRESETS_KEY,
      JSON.stringify(payload),
    )
  } catch {
    // Ignore localStorage persistence failures.
  }
}

function loadReaderUiPrefs(
  storageKey: string,
  legacyKey?: string,
): ReaderUiPrefs | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const raw = legacyKey
      ? readStorageWithLegacy(storageKey, legacyKey)
      : window.localStorage.getItem(storageKey)
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
          : 'fit-width',
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

function expandStepsForPortraitSingle(
  steps: PairingStep[],
  pages: ChapterPageManifest[],
): PairingStep[] {
  if (steps.length === 0) {
    return []
  }

  const inferredFlags = inferAutoSpreadFlags(
    pages.map((page) => ({
      width: page.width,
      height: page.height,
    })),
  )
  const inferredByPageIndex = new Map<number, boolean>()
  pages.forEach((page, index) => {
    inferredByPageIndex.set(page.pageIndex, Boolean(inferredFlags[index]))
  })

  return steps.flatMap((step) => {
    return step.units.flatMap((unit) => {
      if (unit.type === 'page') {
        const page = pages.find((entry) => entry.pageIndex === unit.pageIndex)
        const isSpread = page
          ? page.autoIsSpread ||
            page.splitSpread === true ||
            page.aspect >= 0.95 ||
            inferredByPageIndex.get(unit.pageIndex) === true
          : inferredByPageIndex.get(unit.pageIndex) === true

        if (isSpread) {
          // Split spread into two CSS-cropped halves
          return [
            {
              kind: 'single' as const,
              anchorPageIndex: unit.pageIndex,
              units: [
                {
                  type: 'page' as const,
                  pageIndex: unit.pageIndex,
                  crop: 'right' as const,
                },
              ],
            },
            {
              kind: 'single' as const,
              anchorPageIndex: unit.pageIndex,
              units: [
                {
                  type: 'page' as const,
                  pageIndex: unit.pageIndex,
                  crop: 'left' as const,
                },
              ],
            },
          ]
        }
      }

      return [
        {
          kind: 'single' as const,
          anchorPageIndex: unit.pageIndex,
          units: [unit],
        },
      ]
    })
  })
}

function buildSinglePageSteps(
  pages: ChapterPageManifest[],
  splitSpreads: boolean,
): PairingStep[] {
  if (pages.length === 0) {
    return []
  }

  if (!splitSpreads) {
    return pages.map((page) => ({
      kind: 'single',
      anchorPageIndex: page.pageIndex,
      units: [{ type: 'page', pageIndex: page.pageIndex }],
    }))
  }

  const inferredFlags = inferAutoSpreadFlags(
    pages.map((page) => ({
      width: page.width,
      height: page.height,
    })),
  )

  const steps: PairingStep[] = []

  pages.forEach((page, index) => {
    const isSpread =
      page.autoIsSpread ||
      page.splitSpread === true ||
      page.aspect >= 0.95 ||
      inferredFlags[index] === true

    if (!isSpread) {
      steps.push({
        kind: 'single',
        anchorPageIndex: page.pageIndex,
        units: [{ type: 'page', pageIndex: page.pageIndex }],
      })
      return
    }

    // Split spread into two CSS-cropped halves (right half shown first in RTL)
    steps.push({
      kind: 'single',
      anchorPageIndex: page.pageIndex,
      units: [
        { type: 'page', pageIndex: page.pageIndex, crop: 'right' as const },
      ],
    })
    steps.push({
      kind: 'single',
      anchorPageIndex: page.pageIndex,
      units: [
        { type: 'page', pageIndex: page.pageIndex, crop: 'left' as const },
      ],
    })
  })

  return steps
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
  const current = series.chapters.find((c) => c.id === chapterId)
  if (!current) {
    return { previousChapterId: null, nextChapterId: null }
  }

  const sorted = [...series.chapters].sort((a, b) => {
    if (a.chapterNumber !== b.chapterNumber) {
      return a.chapterNumber - b.chapterNumber
    }
    return a.sortIndex - b.sortIndex
  })

  const index = sorted.findIndex((c) => c.id === chapterId)

  return {
    previousChapterId: index > 0 ? (sorted[index - 1]?.id ?? null) : null,
    nextChapterId: index >= 0 ? (sorted[index + 1]?.id ?? null) : null,
  }
}

function ReaderPage() {
  const params = Route.useParams()
  const navigate = useNavigate()
  const loaderChapterPayload = Route.useLoaderData() as ChapterPayload | undefined
  const queryClient = useQueryClient()
  const openingLine = useMemo(() => {
    const seed =
      params.chapterId.length + (params.chapterId.charCodeAt(0) || 0)
    return LOCAL_READER_OPENING_LINES[seed % LOCAL_READER_OPENING_LINES.length]
  }, [params.chapterId])

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
  const initialUiPrefs = useMemo(
    () =>
      loadReaderUiPrefs(
        LOCAL_READER_UI_PREFS_KEY,
        LEGACY_LOCAL_READER_UI_PREFS_KEY,
      ) ?? DEFAULT_LOCAL_READER_UI_PREFS,
    [],
  )

  const [mode, setMode] = useState<ReaderMode>(initialUiPrefs.mode)
  const [zoomPreset, setZoomPreset] = useState<ZoomPreset>(
    initialUiPrefs.zoomPreset,
  )
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(
    initialUiPrefs.sidebarOpen,
  )
  const [doublePageOffset, setDoublePageOffset] = useState<boolean>(
    initialUiPrefs.doublePageOffset,
  )
  const [mobileSettingsMinimized, setMobileSettingsMinimized] = useState(false)
  const [preloadAhead, setPreloadAhead] = useState<number>(
    initialUiPrefs.preloadAhead,
  )
  const [preloadBehind, setPreloadBehind] = useState<number>(
    initialUiPrefs.preloadBehind,
  )
  const [prefetchConcurrency, setPrefetchConcurrency] = useState<number>(
    initialUiPrefs.prefetchConcurrency,
  )
  const [nextChapterPrefetchThreshold, setNextChapterPrefetchThreshold] =
    useState<number>(initialUiPrefs.nextChapterPrefetchThreshold)
  const [nextChapterWarmPages, setNextChapterWarmPages] = useState<number>(
    initialUiPrefs.nextChapterWarmPages,
  )
  const [uiAutoHideMs, setUiAutoHideMs] = useState<number>(
    initialUiPrefs.uiAutoHideMs,
  )
  const [magnifierEnabled, setMagnifierEnabled] = useState(false)
  const [magnifierSize, setMagnifierSize] = useState<number>(
    initialUiPrefs.magnifierSize,
  )
  const [magnifierZoom, setMagnifierZoom] = useState<number>(
    initialUiPrefs.magnifierZoom,
  )
  const [showReaderChrome, setShowReaderChrome] = useState(false)
  const [focusMode, setFocusMode] = useState(false)
  const [showShortcutHelp, setShowShortcutHelp] = useState(false)
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
  const [currentSingleStepIndex, setCurrentSingleStepIndex] = useState(0)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [inlineFullscreen, setInlineFullscreen] = useState(false)
  const [showPageHud, setShowPageHud] = useState(false)
  const [pendingBoundaryDirection, setPendingBoundaryDirection] = useState<
    'next' | 'prev' | null
  >(null)
  const [boundaryNotice, setBoundaryNotice] = useState<string | null>(null)
  const [pageMotion, setPageMotion] = useState<'next' | 'prev' | null>(null)

  const viewportRef = useRef<HTMLDivElement>(null)
  const readerStageRef = useRef<HTMLElement>(null)
  const chapterTransitionRef = useRef(false)
  const pageHudTimeoutRef = useRef<number | null>(null)
  const readerUiTimeoutRef = useRef<number | null>(null)
  const boundaryNoticeTimeoutRef = useRef<number | null>(null)
  const pageMotionTimeoutRef = useRef<number | null>(null)
  const dragStateRef = useRef<{
    active: boolean
    startX: number
    startY: number
    scrollLeft: number
    scrollTop: number
  } | null>(null)
  const touchGestureRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    startTime: number
    lock: 'x' | 'y' | null
  } | null>(null)
  const suppressTapRef = useRef(false)
  const swipeTrackRef = useRef<HTMLDivElement>(null)
  const swipeOffsetRef = useRef(0)
  const swipeDraggingRef = useRef(false)
  const chapterJumpInteractionRef = useRef(false)
  const isTouchDevice = useTouchDevice()
  const isTouchPortrait = useTouchPortrait()

  const pages = chapterPayload?.manifest.pages ?? []
  const pageByIndex = useMemo(
    () => new Map(pages.map((page) => [page.pageIndex, page] as const)),
    [pages],
  )
  const chapterId = chapterPayload?.manifest.chapterId ?? params.chapterId

  const twoPageSteps = useMemo(
    () =>
      buildDoublePageStepsWithOffset(
        pages.map(asPairingPage),
        doublePageOffset,
      ),
    [doublePageOffset, pages],
  )
  const portraitSingleSteps = useMemo(
    () => expandStepsForPortraitSingle(twoPageSteps, pages),
    [pages, twoPageSteps],
  )
  const singlePageSteps = useMemo(
    () => buildSinglePageSteps(pages, isTouchPortrait),
    [isTouchPortrait, pages],
  )
  const activeDoubleSteps = isTouchPortrait ? portraitSingleSteps : twoPageSteps
  const isSinglePageTouchView =
    isTouchDevice && isTouchPortrait && (mode === 'single' || mode === 'double')
  const fullscreenActive = isFullscreen || inlineFullscreen

  const maxPageIndex = Math.max(pages.length - 1, 0)
  const maxStepIndex = Math.max(activeDoubleSteps.length - 1, 0)
  const maxSingleStepIndex = Math.max(singlePageSteps.length - 1, 0)

  const currentTargetPageIndex =
    mode === 'double'
      ? (activeDoubleSteps[currentStepIndex]?.anchorPageIndex ??
        currentPageIndex)
      : mode === 'single'
        ? (singlePageSteps[currentSingleStepIndex]?.anchorPageIndex ??
          currentPageIndex)
        : currentPageIndex
  const scrubberMax = Math.max(0, pages.length - 1)
  const scrubberValue = currentTargetPageIndex

  const activeStep = activeDoubleSteps[currentStepIndex] ?? null
  const stepUnits = activeStep?.units ?? []
  const normalizedStepUnits =
    stepUnits.length > 2 ? stepUnits.slice(0, 2) : stepUnits
  const renderedUnits =
    normalizedStepUnits.length === 2
      ? [...normalizedStepUnits].reverse()
      : normalizedStepUnits

  const displayUnits = useMemo(() => {
    if (
      mode !== 'double' ||
      renderedUnits.length <= 1 ||
      isTouchPortrait ||
      activeStep?.kind === 'split-spread'
    ) {
      return renderedUnits
    }

    const spreadUnit = renderedUnits.find((unit) => {
      const page = pageByIndex.get(unit.pageIndex)
      if (!page) {
        return false
      }

      return page.autoIsSpread || page.aspect >= 0.95
    })

    return spreadUnit ? [spreadUnit] : renderedUnits
  }, [activeStep?.kind, isTouchPortrait, mode, pageByIndex, renderedUnits])

  const currentRenderUnits = useMemo(
    () =>
      mode === 'single'
        ? (singlePageSteps[currentSingleStepIndex]?.units ??
          ([{ type: 'page', pageIndex: currentPageIndex }] as const))
        : displayUnits,
    [
      currentPageIndex,
      currentSingleStepIndex,
      displayUnits,
      mode,
      singlePageSteps,
    ],
  )
  const currentProgressPageIndex = useMemo(() => {
    const visibleIndexes = currentRenderUnits
      .map((unit) => unit.pageIndex)
      .filter((index) => Number.isFinite(index))

    if (visibleIndexes.length === 0) {
      return currentTargetPageIndex
    }

    return Math.max(...visibleIndexes)
  }, [currentRenderUnits, currentTargetPageIndex])

  const hudPageLabel = useMemo(() => {
    if (pages.length === 0) {
      return 'Page 0 / 0'
    }

    if (mode === 'single') {
      return `Page ${currentSingleStepIndex + 1} / ${Math.max(singlePageSteps.length, 1)}`
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
  }, [
    currentSingleStepIndex,
    currentTargetPageIndex,
    displayUnits,
    mode,
    pages.length,
    singlePageSteps.length,
  ])

  const rtlSpreadNumbers = useMemo(() => {
    const currentNumber = currentTargetPageIndex + 1
    const rightNumber =
      currentNumber % 2 === 1 ? currentNumber : currentNumber - 1
    const leftNumber =
      rightNumber > 0 && rightNumber + 1 <= pages.length
        ? rightNumber + 1
        : null

    return {
      right: rightNumber > 0 ? rightNumber : null,
      left: leftNumber,
    }
  }, [currentTargetPageIndex, pages.length])

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

  const activeSeriesId = chapterPayload?.manifest.seriesId ?? null

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

    const remainingPages = maxPageIndex - currentTargetPageIndex
    const shouldPrefetchNextChapter =
      remainingPages <= nextChapterPrefetchThreshold
    if (!shouldPrefetchNextChapter) {
      return
    }

    if (
      prefetchedLocalChapterPayloads.has(nextChapterId) ||
      inFlightLocalChapterPrefetches.has(nextChapterId)
    ) {
      return
    }

    const controller = new AbortController()
    inFlightLocalChapterPrefetches.add(nextChapterId)

    void (async () => {
      try {
        const chapterOptions = localChapterQueryOptions(nextChapterId)
        const payload =
          queryClient.getQueryData<ChapterPayload>(chapterOptions.queryKey) ??
          (await queryClient.fetchQuery(chapterOptions))

        setBoundedMapEntry(
          prefetchedLocalChapterPayloads,
          nextChapterId,
          payload,
          PREFETCHED_LOCAL_CHAPTER_LIMIT,
        )

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
              await fetch(resolveApiUrl(`/api/image/${nextChapterId}/${index}`), {
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
      } finally {
        inFlightLocalChapterPrefetches.delete(nextChapterId)
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
    queryClient,
  ])

  useEffect(() => {
    if (!loaderChapterPayload) {
      return
    }

    if (loaderChapterPayload.manifest.chapterId !== params.chapterId) {
      return
    }

    setBoundedMapEntry(
      prefetchedLocalChapterPayloads,
      params.chapterId,
      loaderChapterPayload,
      PREFETCHED_LOCAL_CHAPTER_LIMIT,
    )
  }, [loaderChapterPayload, params.chapterId])

  const loadChapter = useCallback(async () => {
    if (
      typeof window !== 'undefined' &&
      !isLocalSessionChapterAllowed(params.chapterId)
    ) {
      setIsLoading(false)
      setChapterPayload(null)
      setError('Session expired. Please upload the file again from Home.')
      return
    }

    const chapterOptions = localChapterQueryOptions(params.chapterId)
    const prefetchedPayload = prefetchedLocalChapterPayloads.get(params.chapterId)
    const cachedPayload =
      prefetchedPayload ??
      queryClient.getQueryData<ChapterPayload>(chapterOptions.queryKey)

    if (prefetchedPayload) {
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
      setCurrentSingleStepIndex(
        findStepIndexByPageIndex(
          buildSinglePageSteps(payload.manifest.pages, false),
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
      setCurrentSingleStepIndex(0)
    }

    chapterTransitionRef.current = false

    try {
      const payload =
        cachedPayload ?? (await queryClient.fetchQuery(chapterOptions))
      if (!cachedPayload) {
        applyPayloadState(payload)
      }

      const seriesOptions = localSeriesQueryOptions(payload.manifest.seriesId)
      const cachedSeries =
        prefetchedLocalSeriesDetails.get(payload.manifest.seriesId) ??
        queryClient.getQueryData<SeriesDetail>(seriesOptions.queryKey)

      if (cachedSeries) {
        setBoundedMapEntry(
          prefetchedLocalSeriesDetails,
          payload.manifest.seriesId,
          cachedSeries,
          PREFETCHED_LOCAL_SERIES_LIMIT,
        )

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
            (await queryClient.fetchQuery(seriesOptions))
          setBoundedMapEntry(
            prefetchedLocalSeriesDetails,
            payload.manifest.seriesId,
            series,
            PREFETCHED_LOCAL_SERIES_LIMIT,
          )

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
      void requestError
      setError('Could not open this chapter.')
    } finally {
      setIsLoading(false)
    }
  }, [params.chapterId, queryClient])

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

  useEffect(() => {
    if (!activeSeriesId) {
      return
    }

    const preset = loadReaderSeriesPreset(activeSeriesId)
    if (!preset) {
      return
    }

    setMode(preset.mode)
    setZoomPreset(preset.zoomPreset)
    setDoublePageOffset(preset.doublePageOffset)
    setMagnifierEnabled(preset.magnifierEnabled)
    setFocusMode(preset.focusMode)
  }, [activeSeriesId])

  useEffect(() => {
    if (!activeSeriesId) {
      return
    }

    saveReaderSeriesPreset(activeSeriesId, {
      mode,
      zoomPreset,
      doublePageOffset,
      magnifierEnabled,
      focusMode,
    })
  }, [
    activeSeriesId,
    doublePageOffset,
    focusMode,
    magnifierEnabled,
    mode,
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
          findStepIndexByPageIndex(activeDoubleSteps, currentTargetPageIndex),
        )
      } else if (next === 'single') {
        setCurrentSingleStepIndex(
          findStepIndexByPageIndex(singlePageSteps, currentTargetPageIndex),
        )
        setCurrentPageIndex(currentTargetPageIndex)
      } else {
        setCurrentPageIndex(currentTargetPageIndex)
      }

      return next
    })
  }, [activeDoubleSteps, currentTargetPageIndex, singlePageSteps])

  useEffect(() => {
    if (!chapterPayload) {
      return
    }

    const timeout = setTimeout(() => {
      setBoundedMapEntry(
        optimisticLocalProgress,
        chapterId,
        {
          chapterId,
          pageIndex: currentProgressPageIndex,
          stepIndex: currentStepIndex,
          mode,
          direction: 'rtl',
          zoomPreset,
          updatedAt: Date.now(),
        },
        OPTIMISTIC_PROGRESS_LIMIT,
      )

      void fetch(resolveApiUrl(`/api/chapter/${chapterId}/progress`), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chapterId,
          pageIndex: currentProgressPageIndex,
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
        pageIndex: currentProgressPageIndex,
        mode,
        completed: currentProgressPageIndex >= maxPageIndex,
      })
    }, 220)

    return () => {
      clearTimeout(timeout)
    }
  }, [
    chapterId,
    chapterPayload,
    currentProgressPageIndex,
    currentStepIndex,
    maxPageIndex,
    mode,
    zoomPreset,
  ])

  const goToPage = useCallback(
    (nextPageIndex: number) => {
      const safeIndex = clamp(nextPageIndex, 0, maxPageIndex)
      setCurrentPageIndex(safeIndex)
      setCurrentStepIndex(
        findStepIndexByPageIndex(activeDoubleSteps, safeIndex),
      )
      setCurrentSingleStepIndex(
        findStepIndexByPageIndex(singlePageSteps, safeIndex),
      )
    },
    [activeDoubleSteps, maxPageIndex, singlePageSteps],
  )

  const persistProgressNow = useCallback(
    (pageIndex: number, stepIndex: number) => {
      if (!chapterPayload) {
        return
      }

      void fetch(resolveApiUrl(`/api/chapter/${chapterId}/progress`), {
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

      setBoundedMapEntry(
        optimisticLocalProgress,
        chapterId,
        {
          chapterId,
          pageIndex,
          stepIndex,
          mode,
          direction: 'rtl',
          zoomPreset,
          updatedAt: Date.now(),
        },
        OPTIMISTIC_PROGRESS_LIMIT,
      )

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
    if (!fullscreenActive) {
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
  }, [fullscreenActive])

  const revealReaderUi = useCallback(() => {
    if (focusMode || isTouchDevice) {
      setShowReaderChrome(false)
      return
    }

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
  }, [focusMode, isTouchDevice, sidebarOpen, uiAutoHideMs])

  const triggerPageMotion = useCallback((direction: 'next' | 'prev') => {
    setPageMotion(direction)

    if (pageMotionTimeoutRef.current !== null) {
      window.clearTimeout(pageMotionTimeoutRef.current)
    }

    pageMotionTimeoutRef.current = window.setTimeout(() => {
      setPageMotion(null)
      pageMotionTimeoutRef.current = null
    }, 180)
  }, [])

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
    setPendingBoundaryDirection(null)
    setBoundaryNotice(null)
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
    setPendingBoundaryDirection(null)
    setBoundaryNotice(null)
    setShowPageHud(false)
    persistProgressNow(currentProgressPageIndex, currentStepIndex)
    void navigate({
      to: '/reader/$chapterId',
      params: { chapterId: previousChapterId },
    })
  }, [
    currentProgressPageIndex,
    currentStepIndex,
    navigate,
    persistProgressNow,
    previousChapterId,
  ])

  const toggleFullscreen = useCallback(async () => {
    if (inlineFullscreen) {
      setInlineFullscreen(false)
      return
    }

    const targetElement = readerStageRef.current
    if (!targetElement) {
      return
    }

    const supportsFullscreen =
      typeof document !== 'undefined' &&
      typeof targetElement.requestFullscreen === 'function'

    if (!supportsFullscreen) {
      setInlineFullscreen(true)
      return
    }

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
        return
      }

      await targetElement.requestFullscreen()
    } catch {
      setInlineFullscreen(true)
    }
  }, [inlineFullscreen])

  const goNext = useCallback(() => {
    const armBoundaryNotice = (direction: 'next' | 'prev') => {
      const hasAdjacent =
        direction === 'next'
          ? Boolean(nextChapterId)
          : Boolean(previousChapterId)

      const message =
        direction === 'next'
          ? hasAdjacent
            ? 'Chapter ended. Press next again for next chapter.'
            : 'Chapter ended.'
          : hasAdjacent
            ? 'At first page. Press previous again for previous chapter.'
            : 'At first page.'

      setPendingBoundaryDirection(direction)
      setBoundaryNotice(message)

      if (boundaryNoticeTimeoutRef.current !== null) {
        window.clearTimeout(boundaryNoticeTimeoutRef.current)
      }

      boundaryNoticeTimeoutRef.current = window.setTimeout(() => {
        setBoundaryNotice(null)
        setPendingBoundaryDirection((value) =>
          value === direction ? null : value,
        )
      }, 1800)
    }

    if (mode === 'double') {
      if (currentStepIndex >= maxStepIndex) {
        if (pendingBoundaryDirection === 'next' && nextChapterId) {
          goToNextChapter()
        } else {
          armBoundaryNotice('next')
        }
        return
      }

      triggerPageMotion('next')
      setCurrentStepIndex((prev) => {
        const next = Math.min(prev + 1, maxStepIndex)
        setCurrentPageIndex(
          activeDoubleSteps[next]?.anchorPageIndex ?? currentPageIndex,
        )
        return next
      })
      setPendingBoundaryDirection(null)
      setBoundaryNotice(null)
      return
    }

    if (mode === 'single') {
      if (currentSingleStepIndex >= maxSingleStepIndex) {
        if (pendingBoundaryDirection === 'next' && nextChapterId) {
          goToNextChapter()
        } else {
          armBoundaryNotice('next')
        }
        return
      }

      triggerPageMotion('next')
      setCurrentSingleStepIndex((prev) => {
        const next = Math.min(prev + 1, maxSingleStepIndex)
        setCurrentPageIndex(
          singlePageSteps[next]?.anchorPageIndex ?? currentPageIndex,
        )
        return next
      })
      setPendingBoundaryDirection(null)
      setBoundaryNotice(null)
      return
    }

    if (currentPageIndex >= maxPageIndex) {
      if (pendingBoundaryDirection === 'next' && nextChapterId) {
        goToNextChapter()
      } else {
        armBoundaryNotice('next')
      }
      return
    }

    setPendingBoundaryDirection(null)
    setBoundaryNotice(null)
    triggerPageMotion('next')
    goToPage(currentPageIndex + 1)
  }, [
    currentPageIndex,
    currentStepIndex,
    currentSingleStepIndex,
    goToNextChapter,
    goToPage,
    maxPageIndex,
    maxSingleStepIndex,
    maxStepIndex,
    mode,
    nextChapterId,
    pendingBoundaryDirection,
    previousChapterId,
    activeDoubleSteps,
    singlePageSteps,
    triggerPageMotion,
  ])

  const goPrevious = useCallback(() => {
    const armBoundaryNotice = (direction: 'next' | 'prev') => {
      const hasAdjacent =
        direction === 'next'
          ? Boolean(nextChapterId)
          : Boolean(previousChapterId)

      const message =
        direction === 'next'
          ? hasAdjacent
            ? 'Chapter ended. Press next again for next chapter.'
            : 'Chapter ended.'
          : hasAdjacent
            ? 'At first page. Press previous again for previous chapter.'
            : 'At first page.'

      setPendingBoundaryDirection(direction)
      setBoundaryNotice(message)

      if (boundaryNoticeTimeoutRef.current !== null) {
        window.clearTimeout(boundaryNoticeTimeoutRef.current)
      }

      boundaryNoticeTimeoutRef.current = window.setTimeout(() => {
        setBoundaryNotice(null)
        setPendingBoundaryDirection((value) =>
          value === direction ? null : value,
        )
      }, 1800)
    }

    if (mode === 'double') {
      if (currentStepIndex <= 0) {
        if (pendingBoundaryDirection === 'prev' && previousChapterId) {
          goToPreviousChapter()
        } else {
          armBoundaryNotice('prev')
        }
        return
      }

      triggerPageMotion('prev')
      setCurrentStepIndex((prev) => {
        const next = Math.max(prev - 1, 0)
        setCurrentPageIndex(
          activeDoubleSteps[next]?.anchorPageIndex ?? currentPageIndex,
        )
        return next
      })
      setPendingBoundaryDirection(null)
      setBoundaryNotice(null)
      return
    }

    if (mode === 'single') {
      if (currentSingleStepIndex <= 0) {
        if (pendingBoundaryDirection === 'prev' && previousChapterId) {
          goToPreviousChapter()
        } else {
          armBoundaryNotice('prev')
        }
        return
      }

      triggerPageMotion('prev')
      setCurrentSingleStepIndex((prev) => {
        const next = Math.max(prev - 1, 0)
        setCurrentPageIndex(
          singlePageSteps[next]?.anchorPageIndex ?? currentPageIndex,
        )
        return next
      })
      setPendingBoundaryDirection(null)
      setBoundaryNotice(null)
      return
    }

    if (currentPageIndex <= 0) {
      if (pendingBoundaryDirection === 'prev' && previousChapterId) {
        goToPreviousChapter()
      } else {
        armBoundaryNotice('prev')
      }
      return
    }

    setPendingBoundaryDirection(null)
    setBoundaryNotice(null)
    triggerPageMotion('prev')
    goToPage(currentPageIndex - 1)
  }, [
    currentPageIndex,
    currentStepIndex,
    currentSingleStepIndex,
    goToPage,
    goToPreviousChapter,
    maxSingleStepIndex,
    maxStepIndex,
    mode,
    nextChapterId,
    pendingBoundaryDirection,
    previousChapterId,
    activeDoubleSteps,
    singlePageSteps,
    triggerPageMotion,
  ])

  const handleReaderTouchStart = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!isTouchDevice || event.pointerType !== 'touch') {
        return
      }

      touchGestureRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startTime: Date.now(),
        lock: null,
      }

      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // Ignore unsupported pointer capture on some browsers.
      }

      swipeDraggingRef.current = false
      swipeOffsetRef.current = 0

      if (swipeTrackRef.current) {
        swipeTrackRef.current.style.transition = 'none'
        swipeTrackRef.current.style.transform = 'translate3d(0px, 0, 0)'
      }
    },
    [isTouchDevice],
  )

  const handleReaderTouchMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!isTouchDevice || event.pointerType !== 'touch') {
        return
      }

      if (mode === 'scroll') {
        return
      }

      const gesture = touchGestureRef.current
      if (!gesture || gesture.pointerId !== event.pointerId) {
        return
      }

      const deltaX = event.clientX - gesture.startX
      const deltaY = event.clientY - gesture.startY
      const absX = Math.abs(deltaX)
      const absY = Math.abs(deltaY)

      if (!gesture.lock) {
        if (absX < 8 && absY < 8) {
          return
        }

        gesture.lock = absX > absY ? 'x' : 'y'
      }

      if (gesture.lock !== 'x') {
        return
      }

      const maxDrag =
        (viewportRef.current?.clientWidth ?? window.innerWidth) * 0.9
      suppressTapRef.current = absX > 10
      swipeDraggingRef.current = true
      swipeOffsetRef.current = clamp(deltaX, -maxDrag, maxDrag)

      if (swipeTrackRef.current) {
        swipeTrackRef.current.style.transition = 'none'
        swipeTrackRef.current.style.transform = `translate3d(${swipeOffsetRef.current}px, 0, 0)`
      }
    },
    [isTouchDevice, mode],
  )

  const handleReaderTouchEnd = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!isTouchDevice || event.pointerType !== 'touch') {
        return
      }

      const gesture = touchGestureRef.current
      touchGestureRef.current = null

      try {
        event.currentTarget.releasePointerCapture(event.pointerId)
      } catch {
        // Ignore unsupported pointer capture release.
      }

      if (!gesture || gesture.pointerId !== event.pointerId) {
        return
      }

      if (mode === 'scroll') {
        return
      }

      // Non-swipe-track path: simple swipe detection without visual drag
      if (!swipeDraggingRef.current) {
        const deltaX = event.clientX - gesture.startX
        const deltaY = event.clientY - gesture.startY
        const absX = Math.abs(deltaX)
        const absY = Math.abs(deltaY)
        if (absX < 26 || absX <= absY) {
          return
        }
        suppressTapRef.current = true
        if (deltaX > 0) {
          goNext()
        } else {
          goPrevious()
        }
        return
      }

      if (gesture.lock !== 'x') {
        swipeDraggingRef.current = false
        swipeOffsetRef.current = 0
        if (swipeTrackRef.current) {
          swipeTrackRef.current.style.transition =
            'transform 180ms cubic-bezier(0.22, 0.78, 0.16, 1)'
          swipeTrackRef.current.style.transform = 'translate3d(0px, 0, 0)'
        }
        return
      }

      const width = viewportRef.current?.clientWidth ?? window.innerWidth
      const elapsed = Math.max(1, Date.now() - gesture.startTime)
      const velocity = Math.abs(swipeOffsetRef.current) / elapsed // px/ms
      const distanceThreshold = Math.max(30, width * 0.1)
      const velocityThreshold = 0.4 // px/ms — a quick flick
      const meetsThreshold =
        Math.abs(swipeOffsetRef.current) > distanceThreshold ||
        velocity > velocityThreshold
      const commit = meetsThreshold
        ? swipeOffsetRef.current > 0
          ? 'next'
          : 'prev'
        : null

      swipeDraggingRef.current = false

      if (!commit) {
        swipeOffsetRef.current = 0
        if (swipeTrackRef.current) {
          swipeTrackRef.current.style.transition =
            'transform 180ms cubic-bezier(0.22, 0.78, 0.16, 1)'
          swipeTrackRef.current.style.transform = 'translate3d(0px, 0, 0)'
        }
        return
      }

      swipeOffsetRef.current = 0
      if (swipeTrackRef.current) {
        swipeTrackRef.current.style.transition = 'none'
        swipeTrackRef.current.style.transform = 'translate3d(0px, 0, 0)'
      }

      // Commit immediately and let page-motion animate content swap.
      if (commit === 'next') {
        goNext()
      } else {
        goPrevious()
      }
    },
    [goNext, goPrevious, isTouchDevice, mode],
  )

  const handleReaderTouchCancel = useCallback(() => {
    touchGestureRef.current = null
    swipeDraggingRef.current = false
    swipeOffsetRef.current = 0
    if (swipeTrackRef.current) {
      swipeTrackRef.current.style.transition =
        'transform 180ms cubic-bezier(0.22, 0.78, 0.16, 1)'
      swipeTrackRef.current.style.transform = 'translate3d(0px, 0, 0)'
    }
  }, [])

  const renderUnitsForPaging = useCallback(
    (units: ReadonlyArray<RenderUnit>, keyPrefix: string) =>
      units.map((unit, slotIndex) => {
        const page = pageByIndex.get(unit.pageIndex)
        if (!page) {
          return null
        }

        return (
          <PagePane
            key={`${keyPrefix}-${slotIndex}`}
            chapterId={chapterId}
            unit={unit}
            page={page}
            zoomPreset={zoomPreset}
            loading="eager"
            testId="reader-page-container"
            forceFullWidth={isSinglePageTouchView}
          />
        )
      }),
    [chapterId, isSinglePageTouchView, pageByIndex, zoomPreset],
  )

  useEffect(() => {
    swipeDraggingRef.current = false
    swipeOffsetRef.current = 0

    if (swipeTrackRef.current) {
      swipeTrackRef.current.style.transition = 'none'
      swipeTrackRef.current.style.transform = 'translate3d(0px, 0, 0)'
    }
  }, [currentPageIndex, currentSingleStepIndex, currentStepIndex, mode])

  const handleTouchTapNavigate = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (!isTouchDevice || mode === 'scroll') {
        return
      }

      if (suppressTapRef.current) {
        suppressTapRef.current = false
        return
      }

      if (swipeDraggingRef.current || Math.abs(swipeOffsetRef.current) > 2) {
        return
      }

      const rect = event.currentTarget.getBoundingClientRect()
      const tapX = event.clientX - rect.left

      if (tapX < rect.width / 2) {
        goNext()
        return
      }

      goPrevious()
    },
    [goNext, goPrevious, isTouchDevice, mode],
  )

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.tagName === 'SELECT') {
        if (
          event.code === 'ArrowRight' ||
          event.code === 'ArrowLeft' ||
          event.code === 'KeyD' ||
          event.code === 'KeyA'
        ) {
          event.preventDefault()
          event.stopPropagation()
        }
        return
      }

      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) {
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

      if (event.code === 'KeyS') {
        event.preventDefault()
        blurReaderFocusTarget()
        setSidebarOpen((value) => !value)
        return
      }

      if (event.code === 'KeyX') {
        event.preventDefault()
        blurReaderFocusTarget()
        setFocusMode((value) => !value)
        return
      }

      if (event.code === 'Digit0') {
        event.preventDefault()
        blurReaderFocusTarget()
        setZoomPreset('fit-width')
        return
      }

      if (event.key === '?') {
        event.preventDefault()
        blurReaderFocusTarget()
        setShowShortcutHelp((value) => !value)
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
    if (!focusMode) {
      return
    }

    setSidebarOpen(false)
    setShowReaderChrome(false)
    setShowShortcutHelp(false)
  }, [focusMode])

  useEffect(() => {
    const onFullscreenChange = () => {
      const active = Boolean(document.fullscreenElement)
      setIsFullscreen(active)
      if (active) {
        setInlineFullscreen(false)
      }
    }

    document.addEventListener('fullscreenchange', onFullscreenChange)

    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange)
    }
  }, [])

  useEffect(() => {
    if (!fullscreenActive) {
      setShowPageHud(false)
      if (pageHudTimeoutRef.current !== null) {
        window.clearTimeout(pageHudTimeoutRef.current)
        pageHudTimeoutRef.current = null
      }
      return
    }

    showPageHudForMoment()
  }, [fullscreenActive, showPageHudForMoment])

  useEffect(() => {
    if (sidebarOpen && !focusMode) {
      setShowReaderChrome(true)
      if (readerUiTimeoutRef.current !== null) {
        window.clearTimeout(readerUiTimeoutRef.current)
        readerUiTimeoutRef.current = null
      }
      return
    }

    setShowReaderChrome(false)
  }, [focusMode, sidebarOpen])

  useEffect(
    () => () => {
      if (pageHudTimeoutRef.current !== null) {
        window.clearTimeout(pageHudTimeoutRef.current)
      }

      if (readerUiTimeoutRef.current !== null) {
        window.clearTimeout(readerUiTimeoutRef.current)
      }

      if (boundaryNoticeTimeoutRef.current !== null) {
        window.clearTimeout(boundaryNoticeTimeoutRef.current)
      }

      if (pageMotionTimeoutRef.current !== null) {
        window.clearTimeout(pageMotionTimeoutRef.current)
      }
    },
    [],
  )

  useEffect(() => {
    if (isTouchDevice && magnifierEnabled) {
      setMagnifierEnabled(false)
    }
  }, [isTouchDevice, magnifierEnabled])

  useEffect(() => {
    setPendingBoundaryDirection(null)
    setBoundaryNotice(null)
  }, [params.chapterId])

  useEffect(() => {
    if (fullscreenActive) {
      showPageHudForMoment()
    }
  }, [
    currentStepIndex,
    currentTargetPageIndex,
    fullscreenActive,
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
      <div
        className="border-2 border-border bg-surface p-6 text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        <p className="delight-loading-note">{openingLine}</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="border-2 border-destructive/30 bg-destructive/10 p-6 text-destructive">
        We could not open this chapter. Please go back and try another one.
      </div>
    )
  }

  if (!chapterPayload) {
    return (
      <div className="reader-stage-bg flex h-[100dvh] flex-col items-center justify-center gap-4">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
          <p className="text-sm text-white/60" role="status" aria-live="polite">
            {openingLine}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div
      className={
        fullscreenActive
          ? 'reader-stage-bg fixed inset-0 z-[120] h-[100dvh] overflow-hidden'
          : isTouchDevice
            ? `reader-stage-bg relative min-h-[100dvh] overflow-x-hidden overflow-y-auto ${focusMode ? 'reader-focus-mode' : ''} reader-touch-root`
            : `reader-stage-bg relative h-[100dvh] overflow-hidden ${focusMode ? 'reader-focus-mode' : ''}`
      }
      onMouseMove={isTouchDevice ? undefined : handleReaderMouseMove}
      onMouseLeave={() => {
        setMagnifierFrame(null)
      }}
    >
      {!fullscreenActive ? (
        <Button
          variant="ghost"
          size="icon"
          className={`reader-shell-toggle absolute ui-left-safe-offset ui-top-safe-offset z-50 size-12 text-2xl transition-transform duration-200 md:size-10 ${showReaderChrome || sidebarOpen ? 'opacity-100' : 'pointer-events-none opacity-0'} ${isTouchDevice ? 'hidden' : ''} ${sidebarOpen ? 'md:left-[calc(min(88vw,360px)+12px)]' : ''}`}
          onClick={() => setSidebarOpen((current) => !current)}
          type="button"
          aria-label={sidebarOpen ? 'Close settings panel' : 'Open settings panel'}
          title={sidebarOpen ? 'Close settings panel' : 'Open settings panel'}
        >
          {sidebarOpen ? '\u2039' : '\u203a'}
        </Button>
      ) : null}

      {fullscreenActive && isTouchDevice ? (
        <Button
          type="button"
          variant="soft"
          size="sm"
          className="absolute ui-right-safe-offset ui-top-safe-offset z-40 h-8 px-2 text-xs"
          onClick={() => {
            void toggleFullscreen()
          }}
        >
          Exit
        </Button>
      ) : null}

      {!fullscreenActive ? (
        <aside
          className={
            isTouchDevice
              ? `reader-shell-panel reader-settings-panel animate-enter relative z-30 w-full overflow-visible ${isTouchPortrait ? 'p-3' : 'px-3 py-1.5'}`
              : `reader-shell-panel reader-settings-panel animate-enter absolute inset-y-0 left-0 z-40 w-[min(88vw,360px)] overflow-y-auto p-3 transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`
          }
          style={{
            animationDelay: '20ms',
            paddingTop: isTouchDevice
              ? 'max(0.75rem, calc(var(--safe-top) + 0.5rem))'
              : undefined,
          }}
        >
          {isTouchDevice && isTouchPortrait ? (
            <div className="reader-settings-bar mb-2 flex items-center justify-between border border-border bg-surface-soft px-2 py-1.5">
              <span className="text-xs font-semibold text-foreground">
                Settings
              </span>
              <Button
                type="button"
                variant="soft"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() =>
                  setMobileSettingsMinimized((current) => !current)
                }
              >
                {mobileSettingsMinimized ? 'Show' : 'Minimize'}
              </Button>
            </div>
          ) : null}

          {/* Landscape touch: single compact toolbar row */}
          {isTouchDevice && !isTouchPortrait ? (
            <div className="reader-settings-toolbar flex items-center gap-1.5 overflow-x-auto text-xs">
              <Link
                to="/series/$seriesId"
                params={{ seriesId: chapterPayload.manifest.seriesId }}
                className="reader-settings-action inline-flex h-8 shrink-0 items-center border border-border bg-surface-soft px-2 text-muted-foreground hover:bg-surface"
              >
                Series
              </Link>
              <div className="flex shrink-0 gap-0.5">
                <Button
                  type="button"
                  variant={mode === 'single' ? 'default' : 'soft'}
                  className="h-8 px-2 text-xs"
                  aria-label="Switch to single-page mode"
                  onClick={() => {
                    setMode('single')
                    setCurrentSingleStepIndex(
                      findStepIndexByPageIndex(
                        singlePageSteps,
                        currentTargetPageIndex,
                      ),
                    )
                    setCurrentPageIndex(currentTargetPageIndex)
                  }}
                >
                  1
                </Button>
                <Button
                  type="button"
                  variant={mode === 'double' ? 'default' : 'soft'}
                  className="h-8 px-2 text-xs"
                  aria-label="Switch to two-page mode"
                  onClick={() => {
                    setMode('double')
                    setCurrentStepIndex(
                      findStepIndexByPageIndex(
                        activeDoubleSteps,
                        currentTargetPageIndex,
                      ),
                    )
                  }}
                >
                  2
                </Button>
                <Button
                  type="button"
                  variant={mode === 'scroll' ? 'default' : 'soft'}
                  className="h-8 px-2 text-xs"
                  aria-label="Switch to scroll mode"
                  onClick={() => {
                    setMode('scroll')
                    setCurrentPageIndex(currentTargetPageIndex)
                  }}
                >
                  ∞
                </Button>
              </div>
              <span className="shrink-0 text-muted-foreground">
                {currentTargetPageIndex + 1}/{pages.length}
              </span>
              <RangeSlider
                min={0}
                max={scrubberMax}
                value={scrubberValue}
                onChange={(event) =>
                  goToPage(Number.parseInt(event.target.value, 10))
                }
                className="min-w-[80px] flex-1 accent-primary"
                style={{ transform: 'scaleX(-1)' }}
                data-testid="page-scrubber-landscape"
              />
              <Button
                type="button"
                variant="soft"
                className="h-8 shrink-0 px-2 text-xs"
                onClick={() => void toggleFullscreen()}
                aria-label="Toggle fullscreen"
                title="Toggle fullscreen"
              >
                ⛶
              </Button>
            </div>
          ) : null}

          {/* Portrait touch / desktop: full settings */}
          {!(isTouchDevice && !isTouchPortrait) ? (
            <div
              className={
                isTouchDevice && mobileSettingsMinimized ? 'hidden' : ''
              }
            >
              <div className="reader-settings-surface space-y-2 text-xs text-muted-foreground">
                <Link
                  to="/series/$seriesId"
                  params={{ seriesId: chapterPayload.manifest.seriesId }}
                  className="reader-settings-action inline-flex border border-border bg-surface-soft px-2 py-1 hover:bg-surface"
                >
                  Back to series
                </Link>
                <Link
                  to="/series/$seriesId"
                  params={{ seriesId: chapterPayload.manifest.seriesId }}
                  className="block truncate text-sm font-semibold leading-snug text-foreground underline-offset-2 hover:underline"
                >
                  {prefetchedLocalSeriesDetails.get(
                    chapterPayload.manifest.seriesId,
                  )?.title ?? 'Open series page'}
                </Link>
                <p>
                  Ch {chapterPayload.manifest.chapterNumber} ·{' '}
                  {chapterPayload.manifest.pageCount}p
                </p>
              </div>

              <div
                className={
                  isTouchDevice
                    ? 'reader-settings-grid mt-3 grid grid-cols-2 gap-2'
                    : 'reader-settings-grid mt-3 grid gap-2'
                }
              >
                {isTouchDevice ? (
                  <div className="col-span-2 grid grid-cols-3 gap-2">
                    <Button
                      type="button"
                      variant={mode === 'single' ? 'default' : 'soft'}
                      className="h-9"
                      onClick={() => {
                        setMode('single')
                        setCurrentSingleStepIndex(
                          findStepIndexByPageIndex(
                            singlePageSteps,
                            currentTargetPageIndex,
                          ),
                        )
                        setCurrentPageIndex(currentTargetPageIndex)
                      }}
                    >
                      Single
                    </Button>
                    <Button
                      type="button"
                      variant={mode === 'double' ? 'default' : 'soft'}
                      className="h-9"
                      onClick={() => {
                        setMode('double')
                        setCurrentStepIndex(
                          findStepIndexByPageIndex(
                            activeDoubleSteps,
                            currentTargetPageIndex,
                          ),
                        )
                      }}
                    >
                      Double
                    </Button>
                    <Button
                      type="button"
                      variant={mode === 'scroll' ? 'default' : 'soft'}
                      className="h-9"
                      onClick={() => {
                        setMode('scroll')
                        setCurrentPageIndex(currentTargetPageIndex)
                      }}
                    >
                      Scroll
                    </Button>
                  </div>
                ) : (
                  <SelectField
                    value={mode}
                    aria-label="Display mode"
                    onChange={(event) => {
                      const nextMode = event.target.value as ReaderMode
                      setMode(nextMode)

                      if (nextMode === 'double') {
                        setCurrentStepIndex(
                          findStepIndexByPageIndex(
                            activeDoubleSteps,
                            currentTargetPageIndex,
                          ),
                        )
                      } else if (nextMode === 'single') {
                        setCurrentSingleStepIndex(
                          findStepIndexByPageIndex(
                            singlePageSteps,
                            currentTargetPageIndex,
                          ),
                        )
                        setCurrentPageIndex(currentTargetPageIndex)
                      } else {
                        setCurrentPageIndex(currentTargetPageIndex)
                      }
                    }}
                    options={[
                      { value: 'single', label: 'Single page' },
                      { value: 'double', label: 'Two-page spread' },
                      { value: 'scroll', label: 'Continuous scroll' },
                    ]}
                  />
                )}
                {!isTouchDevice ? (
                  <p className="reader-settings-heading">Display mode</p>
                ) : null}
                {mode === 'double' && isTouchPortrait ? (
                  <p className="col-span-2 px-1 text-xs text-muted-foreground">
                    Portrait on touch screens uses one page at a time.
                  </p>
                ) : null}

                <Button
                  type="button"
                  variant={doublePageOffset ? 'default' : 'soft'}
                  className="h-9 w-full px-3"
                  onClick={() => setDoublePageOffset((value) => !value)}
                >
                  Offset: {doublePageOffset ? 'On' : 'Off'}
                </Button>

                <SelectField
                  value={zoomPreset}
                  aria-label="Zoom preset"
                  onChange={(event) =>
                    setZoomPreset(event.target.value as ZoomPreset)
                  }
                  className="h-9"
                  data-testid="zoom-select"
                  options={[
                    { value: 'fit-height', label: 'Fit to screen' },
                    { value: 'fit-width', label: 'Fit to width' },
                    { value: 'actual', label: 'Actual size' },
                  ]}
                />

                {seriesChapters.length > 0 ? (
                  <>
                    <p
                      className={`reader-settings-heading ${isTouchDevice ? 'col-span-2' : ''}`}
                    >
                      Chapter jump
                    </p>
                    {orderedSeriesChapters.length > 0 ? (
                      <SelectField
                        value={chapterPayload.manifest.chapterId}
                        aria-label="Chapter jump"
                        onPointerDown={() => {
                          chapterJumpInteractionRef.current = true
                        }}
                        onKeyDown={(event) => {
                          if (
                            event.key === 'ArrowLeft' ||
                            event.key === 'ArrowRight'
                          ) {
                            chapterJumpInteractionRef.current = false
                            event.preventDefault()
                            event.stopPropagation()
                            return
                          }
                          chapterJumpInteractionRef.current = true
                        }}
                        onChange={(event) => {
                          if (!chapterJumpInteractionRef.current) {
                            return
                          }
                          chapterJumpInteractionRef.current = false
                          const nextId = event.target.value
                          if (nextId === chapterPayload.manifest.chapterId) {
                            return
                          }
                          persistProgressNow(
                            currentProgressPageIndex,
                            currentStepIndex,
                          )
                          void navigate({
                            to: '/reader/$chapterId',
                            params: { chapterId: nextId },
                          })
                        }}
                        className={`h-9 min-w-0 ${isTouchDevice ? 'col-span-2' : ''}`}
                        options={orderedSeriesChapters.map((chapter) => ({
                          value: chapter.id,
                          label: `Chapter ${chapter.chapterNumber}`,
                        }))}
                      />
                    ) : (
                      <p className="col-span-2 px-1 text-xs text-muted-foreground">
                        No chapter found. Try a different number.
                      </p>
                    )}
                  </>
                ) : null}

                <label
                  className={`reader-settings-label text-xs text-muted-foreground ${isTouchDevice ? 'col-span-2' : ''}`}
                >
                  <span>
                    Page {currentTargetPageIndex + 1} of {pages.length}
                  </span>
                  <RangeSlider
                    min={0}
                    max={scrubberMax}
                    value={scrubberValue}
                    onChange={(event) =>
                      goToPage(Number.parseInt(event.target.value, 10))
                    }
                    className="mt-2 w-full accent-primary"
                    style={{ transform: 'scaleX(-1)' }}
                    data-testid="page-scrubber"
                  />
                </label>
              </div>

              <details className="reader-settings-advanced mt-3 text-xs text-muted-foreground">
                <summary className="font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Advanced tuning
                </summary>
                <div className="mt-2 grid gap-2">
                  {!isTouchDevice ? (
                    <div className="grid gap-2">
                      <Button
                        type="button"
                        variant={magnifierEnabled ? 'default' : 'soft'}
                        className="h-9 w-full px-3"
                        onClick={() => setMagnifierEnabled((value) => !value)}
                      >
                        Magnifier: {magnifierEnabled ? 'On' : 'Off'}
                      </Button>
                      <Button
                        type="button"
                        variant={focusMode ? 'default' : 'soft'}
                        className="h-9 w-full px-3"
                        onClick={() => setFocusMode((value) => !value)}
                      >
                        Distraction-free mode: {focusMode ? 'On' : 'Off'}
                      </Button>
                    </div>
                  ) : null}
                  <label className="reader-settings-label">
                    Pages to preload ahead
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
                  <label className="reader-settings-label">
                    Pages to preload behind
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
                  <label className="reader-settings-label">
                    Max parallel preloads
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
                  <label className="reader-settings-label">
                    Start next chapter warm-up when this many pages remain
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
                  <label className="reader-settings-label">
                    Warm pages in the next chapter
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
                  <label className="reader-settings-label">
                    Hide reader controls after (ms)
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
                  <label className="reader-settings-label">
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
                  <label className="reader-settings-label">
                    Magnifier zoom level
                    <Input
                      type="number"
                      min={2}
                      max={5}
                      step={0.1}
                      value={magnifierZoom}
                      onChange={(event) =>
                        setMagnifierZoom(
                          clampNumber(
                            Number.parseFloat(event.target.value),
                            2,
                            5,
                          ),
                        )
                      }
                      className="mt-1 h-8"
                    />
                  </label>
                </div>
              </details>

              <div className="mt-3 flex items-center justify-between gap-2">
                <Button
                  variant="soft"
                  className="w-full"
                  onClick={goNext}
                  data-testid="nav-next"
                >
                  Next page
                </Button>
                <Button
                  variant="soft"
                  className="w-full"
                  onClick={goPrevious}
                  data-testid="nav-prev"
                >
                  Previous page
                </Button>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Button
                  variant="ghost"
                  className="w-full border border-border"
                  onClick={goToNextChapter}
                  disabled={!nextChapterId}
                >
                  Next chapter
                </Button>
                <Button
                  variant="ghost"
                  className="w-full border border-border disabled:!bg-surface-soft disabled:!text-foreground/70 disabled:!opacity-100"
                  onClick={goToPreviousChapter}
                  disabled={!previousChapterId}
                >
                  Previous chapter
                </Button>
              </div>
              <p
                className="mt-3 text-sm text-muted-foreground"
                data-testid="position-label"
              >
                {mode === 'double'
                  ? `Spread ${currentStepIndex + 1} / ${Math.max(activeDoubleSteps.length, 1)}`
                  : mode === 'single'
                    ? `Page ${currentSingleStepIndex + 1} / ${Math.max(singlePageSteps.length, 1)}`
                    : `Page ${currentTargetPageIndex + 1} / ${Math.max(pages.length, 1)}`}
              </p>
              {!isTouchDevice ? (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    className="reader-shortcut-trigger mt-2 h-8 w-full border border-border text-xs"
                    onClick={() => setShowShortcutHelp((value) => !value)}
                  >
                    {showShortcutHelp
                      ? 'Hide keyboard shortcuts'
                      : 'Keyboard shortcuts'}
                  </Button>
                  {showShortcutHelp ? (
                    <div className="reader-shortcut-sheet mt-2 text-xs">
                      <p>Nav: A/D or arrows, Space, [ ]</p>
                      <p>View: Q mode, 0 reset zoom, F fullscreen</p>
                      <p>UI: S sidebar, X focus, Z magnifier</p>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}
        </aside>
      ) : null}

      {!fullscreenActive && !focusMode && showReaderChrome && !isTouchDevice ? (
        <div className="reader-key-hints absolute bottom-4 left-1/2 z-20 -translate-x-1/2 text-xs">
          Tip: click/tap sides to turn pages. Press ? for shortcuts.
        </div>
      ) : null}

      {pages.length > 0 ? (
        mode === 'double' && !isTouchPortrait ? (
          <>
            <div className="pointer-events-none absolute ui-bottom-safe-offset ui-left-safe-offset z-20 text-[10px] font-medium text-white/55">
              {rtlSpreadNumbers.left ?? ''}
            </div>
            {rtlSpreadNumbers.right ? (
              <div className="pointer-events-none absolute ui-bottom-safe-offset ui-right-safe-offset z-20 text-[10px] font-medium text-white/55">
                {rtlSpreadNumbers.right}
              </div>
            ) : null}
          </>
        ) : (
          <div className="pointer-events-none absolute ui-bottom-safe-offset ui-right-safe-offset z-20 text-[10px] font-medium text-white/55">
            {currentTargetPageIndex + 1} / {pages.length}
          </div>
        )
      ) : null}

      {boundaryNotice ? (
        <div className="pointer-events-none absolute ui-bottom-safe-stack left-4 right-4 z-30 flex items-center justify-center gap-2 rounded-sm border border-white/20 bg-black/85 px-4 py-3 text-center text-sm text-white/90 shadow-lg backdrop-blur-sm md:bottom-20 md:left-1/2 md:right-auto md:-translate-x-1/2 md:px-6">
          <span>{boundaryNotice}</span>
        </div>
      ) : null}

      {mode !== 'scroll' ? (
        <div className="pointer-events-none absolute ui-bottom-safe-progress left-0 right-0 z-20 h-[3px] bg-white/10">
          <div
            className="h-full bg-white/40 transition-[width] duration-200 ease-out"
            style={{
              width: `${pages.length > 1 ? (currentTargetPageIndex / (pages.length - 1)) * 100 : 100}%`,
            }}
          />
        </div>
      ) : null}

      {!fullscreenActive && focusMode ? (
        <Button
          type="button"
          variant="soft"
          className="absolute ui-right-safe-offset ui-top-safe-offset z-30 h-10 px-3 text-xs"
          onClick={() => setFocusMode(false)}
        >
          Exit distraction-free mode
        </Button>
      ) : null}

      <section
        className={
          fullscreenActive ? '' : isTouchDevice ? 'min-h-[100dvh]' : 'h-full'
        }
        ref={readerStageRef}
      >
        {mode === 'scroll' ? (
          <div
            className="relative"
            onMouseMove={isTouchDevice ? undefined : handleReaderMouseMove}
            onPointerDown={handleReaderTouchStart}
            onPointerUp={handleReaderTouchEnd}
            onPointerCancel={() => {
              touchGestureRef.current = null
            }}
          >
            <ContinuousScroll
              chapterId={chapterId}
              pages={pages}
              zoomPreset={zoomPreset}
              isFullscreen={fullscreenActive}
              onVisiblePageChange={(pageIndex) =>
                setCurrentPageIndex(pageIndex)
              }
            />
            {fullscreenActive && showPageHud ? (
              <div className="reader-hud pointer-events-none absolute ui-bottom-safe-hud left-1/2 -translate-x-1/2 px-3 py-1 text-sm">
                {hudPageLabel}
              </div>
            ) : null}
          </div>
        ) : (
          <div
            className={`reader-stage-bg relative ${!fullscreenActive && isTouchDevice ? 'h-[100dvh]' : 'h-full'} ${focusMode ? 'reader-focus-mode' : ''}`}
            ref={viewportRef}
            onMouseMove={isTouchDevice ? undefined : handleReaderMouseMove}
            onClick={handleTouchTapNavigate}
            onPointerDown={(event) => {
              handleReaderTouchStart(event)

              if (
                event.pointerType !== 'mouse' ||
                zoomPreset !== 'actual' ||
                !viewportRef.current
              ) {
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
            onPointerUp={handleReaderTouchEnd}
            onPointerMove={handleReaderTouchMove}
            onPointerCancel={handleReaderTouchCancel}
            style={{
              cursor: zoomPreset === 'actual' ? 'grab' : 'default',
              overflow: zoomPreset === 'actual' ? 'auto' : 'hidden',
              touchAction: isTouchDevice ? 'pan-y' : 'auto',
              overscrollBehavior: isTouchDevice ? 'contain' : undefined,
            }}
          >
            <div
              ref={swipeTrackRef}
              className={`flex h-full items-center justify-center gap-0 overflow-hidden ${isSinglePageTouchView ? 'px-4' : ''} ${pageMotion ? `reader-page-motion-${pageMotion}` : ''}`}
              data-testid="reader-paging-container"
            >
              {renderUnitsForPaging(currentRenderUnits, 'current')}
            </div>

            {!isTouchDevice &&
            !magnifierEnabled &&
            zoomPreset !== 'actual' ? (
              <ReaderTapZone side="left" onActivate={goNext} />
            ) : null}
            {!isTouchDevice &&
            !magnifierEnabled &&
            zoomPreset !== 'actual' ? (
              <ReaderTapZone side="right" onActivate={goPrevious} />
            ) : null}
            {!fullscreenActive &&
            showReaderChrome &&
            !isTouchDevice &&
            !sidebarOpen ? (
              <>
                <ReaderEdgeArrowButton side="left" onActivate={goNext} />
                <ReaderEdgeArrowButton side="right" onActivate={goPrevious} />
              </>
            ) : null}
            {fullscreenActive && showPageHud ? (
              <div className="reader-hud pointer-events-none absolute ui-bottom-safe-hud left-1/2 -translate-x-1/2 px-3 py-1 text-sm">
                {hudPageLabel}
              </div>
            ) : null}
          </div>
        )}
      </section>

      {magnifierEnabled && magnifierFrame ? (
        <div
          className="pointer-events-none fixed z-[90] overflow-hidden border border-border bg-surface/80"
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
          <div className="absolute inset-0 border border-border/70" />
        </div>
      ) : null}
    </div>
  )
}
