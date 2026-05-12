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
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'

gsap.registerPlugin(useGSAP)

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
  ReaderDirection,
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

function ReaderPending() {
  return (
    <div className="reader-stage-bg flex h-[100dvh] flex-col items-center justify-center gap-4">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
        <p className="text-sm text-white/60" role="status" aria-live="polite">
          Opening chapter…
        </p>
      </div>
    </div>
  )
}

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
  pendingMs: 100,
  pendingMinMs: 300,
  component: ReaderPage,
  pendingComponent: ReaderPending,
})

const optimisticLocalProgress = new Map<string, ChapterProgress>()
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
  readingDirection: ReaderDirection
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
      readingDirection: preset.readingDirection === 'ltr' ? 'ltr' : 'rtl',
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
  readingDirection: ReaderDirection,
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
          const cropOrder =
            readingDirection === 'ltr'
              ? (['left', 'right'] as const)
              : (['right', 'left'] as const)

          return cropOrder.map((crop) => ({
            kind: 'single' as const,
            anchorPageIndex: unit.pageIndex,
            units: [
              {
                type: 'page' as const,
                pageIndex: unit.pageIndex,
                crop,
              },
            ],
          }))
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
  readingDirection: ReaderDirection,
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

    const cropOrder =
      readingDirection === 'ltr'
        ? (['left', 'right'] as const)
        : (['right', 'left'] as const)

    cropOrder.forEach((crop) => {
      steps.push({
        kind: 'single',
        anchorPageIndex: page.pageIndex,
        units: [{ type: 'page', pageIndex: page.pageIndex, crop }],
      })
    })
  })

  return steps
}

function getDisplayUnitsForStep(
  step: PairingStep | null,
  pageByIndex: ReadonlyMap<number, ChapterPageManifest>,
  isTouchPortrait: boolean,
  readingDirection: ReaderDirection,
) {
  if (!step) {
    return [] as PairingStep['units']
  }

  const normalizedUnits =
    step.units.length > 2 ? step.units.slice(0, 2) : step.units
  const renderedUnits =
    normalizedUnits.length === 2 && readingDirection === 'rtl'
      ? [...normalizedUnits].reverse()
      : normalizedUnits

  if (
    renderedUnits.length <= 1 ||
    isTouchPortrait ||
    step.kind === 'split-spread'
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

interface ReaderPageState {
  pageIndex: number
  stepIndex: number
  singleStepIndex: number
}

function derivePageIndicesForLocal(
  pageIndex: number,
  pages: ChapterPageManifest[],
  doublePageOffset: boolean,
  isTouchPortrait: boolean,
  readingDirection: ReaderDirection,
): ReaderPageState {
  const safeIdx = clamp(pageIndex, 0, Math.max(pages.length - 1, 0))
  const pairingPages = pages.map(asPairingPage)
  const doubleSteps = buildDoublePageStepsWithOffset(
    pairingPages,
    doublePageOffset,
  )
  const portraitSteps = expandStepsForPortraitSingle(
    doubleSteps,
    pages,
    readingDirection,
  )
  const activeSteps = isTouchPortrait ? portraitSteps : doubleSteps
  const singleSteps = buildSinglePageSteps(
    pages,
    isTouchPortrait,
    readingDirection,
  )
  return {
    pageIndex: safeIdx,
    stepIndex: findStepIndexByPageIndex(activeSteps, safeIdx),
    singleStepIndex: findStepIndexByPageIndex(singleSteps, safeIdx),
  }
}

const ZERO_PAGE_STATE: ReaderPageState = {
  pageIndex: 0,
  stepIndex: 0,
  singleStepIndex: 0,
}

function ReaderPage() {
  const params = Route.useParams()
  const navigate = useNavigate()
  const loaderChapterPayload = Route.useLoaderData() as
    | ChapterPayload
    | undefined
  const queryClient = useQueryClient()
  const openingLine = useMemo(() => {
    const seed = params.chapterId.length + (params.chapterId.charCodeAt(0) || 0)
    return LOCAL_READER_OPENING_LINES[seed % LOCAL_READER_OPENING_LINES.length]
  }, [params.chapterId])

  const initialCached = useMemo(() => {
    if (typeof window === 'undefined') return null
    if (loaderChapterPayload?.manifest.chapterId === params.chapterId) {
      return loaderChapterPayload
    }
    const cached = queryClient.getQueryData<ChapterPayload>(
      localChapterQueryOptions(params.chapterId).queryKey,
    )
    if (cached?.manifest.chapterId === params.chapterId) return cached
    return null
  }, [params.chapterId, loaderChapterPayload])

  const [chapterPayload, setChapterPayload] = useState<ChapterPayload | null>(
    initialCached,
  )
  const [isLoading, setIsLoading] = useState(() => !initialCached)
  const [error, setError] = useState<string | null>(null)
  const [nextChapterId, setNextChapterId] = useState<string | null>(null)
  const [previousChapterId, setPreviousChapterId] = useState<string | null>(
    null,
  )
  const [seriesChapters, setSeriesChapters] = useState<
    SeriesDetail['chapters']
  >([])
  const [seriesTitle, setSeriesTitle] = useState<string | null>(null)
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
  const [readingDirection, setReadingDirection] = useState<ReaderDirection>(
    () => {
      if (typeof window === 'undefined') return 'rtl'
      const payload = chapterPayload
      if (!payload) return 'rtl'
      const preset = loadReaderSeriesPreset(payload.manifest.seriesId)
      return preset?.readingDirection ?? 'rtl'
    },
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

  const initialPageState = useMemo(() => {
    if (!initialCached || initialCached.manifest.pages.length === 0)
      return ZERO_PAGE_STATE
    const savedProgress =
      optimisticLocalProgress.get(initialCached.manifest.chapterId) ??
      initialCached.progress
    const pageIdx = savedProgress?.pageIndex ?? 0
    return derivePageIndicesForLocal(
      pageIdx,
      initialCached.manifest.pages,
      false,
      false,
      'rtl',
    )
  }, [initialCached])

  const [pageState, setPageState] = useState<ReaderPageState>(initialPageState)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [inlineFullscreen, setInlineFullscreen] = useState(false)
  const [showPageHud, setShowPageHud] = useState(false)
  const [pendingBoundaryDirection, setPendingBoundaryDirection] = useState<
    'next' | 'prev' | null
  >(null)
  const [boundaryNotice, setBoundaryNotice] = useState<string | null>(null)

  const viewportRef = useRef<HTMLDivElement>(null)
  const readerStageRef = useRef<HTMLElement>(null)
  const chapterTransitionRef = useRef(false)
  const pageHudTimeoutRef = useRef<number | null>(null)
  const readerUiTimeoutRef = useRef<number | null>(null)
  const boundaryNoticeTimeoutRef = useRef<number | null>(null)
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
  const sidebarRef = useRef<HTMLDivElement>(null)
  const boundaryRef = useRef<HTMLDivElement>(null)
  const hudRef = useRef<HTMLDivElement>(null)
  const settingsContentRef = useRef<HTMLDivElement>(null)
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
    () => expandStepsForPortraitSingle(twoPageSteps, pages, readingDirection),
    [pages, readingDirection, twoPageSteps],
  )
  const singlePageSteps = useMemo(
    () => buildSinglePageSteps(pages, isTouchPortrait, readingDirection),
    [isTouchPortrait, pages, readingDirection],
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
      ? (activeDoubleSteps[pageState.stepIndex]?.anchorPageIndex ??
        pageState.pageIndex)
      : mode === 'single'
        ? (singlePageSteps[pageState.singleStepIndex]?.anchorPageIndex ??
          pageState.pageIndex)
        : pageState.pageIndex
  const scrubberMax = Math.max(0, pages.length - 1)
  const scrubberValue = currentTargetPageIndex

  const activeStep = activeDoubleSteps[pageState.stepIndex] ?? null

  const displayUnits = useMemo(() => {
    if (mode !== 'double') {
      return [] as PairingStep['units']
    }

    return getDisplayUnitsForStep(
      activeStep,
      pageByIndex,
      isTouchPortrait,
      readingDirection,
    )
  }, [activeStep, isTouchPortrait, mode, pageByIndex, readingDirection])

  const currentRenderUnits = useMemo(
    () =>
      mode === 'single'
        ? (singlePageSteps[pageState.singleStepIndex]?.units ??
          ([{ type: 'page', pageIndex: pageState.pageIndex }] as const))
        : displayUnits,
    [
      pageState.pageIndex,
      pageState.singleStepIndex,
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
      return `Page ${pageState.singleStepIndex + 1} / ${Math.max(singlePageSteps.length, 1)}`
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
    pageState.singleStepIndex,
    currentTargetPageIndex,
    displayUnits,
    mode,
    pages.length,
    singlePageSteps.length,
  ])

  const spreadNumbers = useMemo(
    () => ({
      left:
        typeof displayUnits[0]?.pageIndex === 'number'
          ? displayUnits[0].pageIndex + 1
          : null,
      right:
        typeof displayUnits[1]?.pageIndex === 'number'
          ? displayUnits[1].pageIndex + 1
          : null,
    }),
    [displayUnits],
  )

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

    const chapterOptions = localChapterQueryOptions(nextChapterId)
    if (queryClient.getQueryData(chapterOptions.queryKey)) {
      return
    }

    const controller = new AbortController()

    void (async () => {
      try {
        const chapterOptions = localChapterQueryOptions(nextChapterId)
        const payload =
          queryClient.getQueryData<ChapterPayload>(chapterOptions.queryKey) ??
          (await queryClient.fetchQuery(chapterOptions))

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
              await fetch(
                resolveApiUrl(`/api/image/${nextChapterId}/${index}`),
                {
                  signal: controller.signal,
                  cache: 'force-cache',
                },
              )
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
    queryClient,
  ])

  const chapterChangeRef = useRef<string | null>(null)

  useEffect(() => {
    const prev = chapterChangeRef.current
    chapterChangeRef.current = params.chapterId

    if (prev === params.chapterId) return

    if (prev !== null) {
      // Reset chapter state on chapter change to prevent stale data flash
      setChapterPayload(null)
      setNextChapterId(null)
      setPreviousChapterId(null)
      setSeriesChapters([])
      setSeriesTitle(null)
      setPageState(ZERO_PAGE_STATE)
      setIsLoading(true)
    }
  }, [params.chapterId])

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
    const cachedPayload = queryClient.getQueryData<ChapterPayload>(
      chapterOptions.queryKey,
    )

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

      setPageState(
        derivePageIndicesForLocal(
          nextPage,
          payload.manifest.pages,
          doublePageOffset,
          isTouchPortrait,
          readingDirection,
        ),
      )
    }

    if (cachedPayload) {
      applyPayloadState(cachedPayload)
    } else {
      setChapterPayload(null)
      setPageState(ZERO_PAGE_STATE)
    }

    chapterTransitionRef.current = false

    try {
      const payload =
        cachedPayload ?? (await queryClient.fetchQuery(chapterOptions))
      if (!cachedPayload) {
        applyPayloadState(payload)
      }

      const seriesOptions = localSeriesQueryOptions(payload.manifest.seriesId)
      const cachedSeries = queryClient.getQueryData<SeriesDetail>(
        seriesOptions.queryKey,
      )

      if (cachedSeries) {
        const adjacent = resolveAdjacentChapterIds(
          cachedSeries,
          payload.manifest.chapterId,
        )
        setNextChapterId(adjacent.nextChapterId)
        setPreviousChapterId(adjacent.previousChapterId)
        setSeriesChapters(cachedSeries.chapters)
        setSeriesTitle(cachedSeries.title)
      }

      void (async () => {
        try {
          const series =
            cachedSeries ?? (await queryClient.fetchQuery(seriesOptions))

          const adjacent = resolveAdjacentChapterIds(
            series,
            payload.manifest.chapterId,
          )
          setNextChapterId(adjacent.nextChapterId)
          setPreviousChapterId(adjacent.previousChapterId)
          setSeriesChapters(series.chapters)
          setSeriesTitle(series.title)
        } catch {
          setNextChapterId(null)
          setPreviousChapterId(null)
          setSeriesChapters([])
          setSeriesTitle(null)
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
    setReadingDirection(preset?.readingDirection ?? 'rtl')

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
      readingDirection,
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
    readingDirection,
    zoomPreset,
  ])

  const cycleMode = useCallback(() => {
    const next: ReaderMode =
      mode === 'single' ? 'double' : mode === 'double' ? 'scroll' : 'single'

    if (next === 'double') {
      setPageState((prev) => ({
        ...prev,
        stepIndex: findStepIndexByPageIndex(
          activeDoubleSteps,
          currentTargetPageIndex,
        ),
      }))
    } else if (next === 'single') {
      setPageState({
        pageIndex: currentTargetPageIndex,
        stepIndex: findStepIndexByPageIndex(
          activeDoubleSteps,
          currentTargetPageIndex,
        ),
        singleStepIndex: findStepIndexByPageIndex(
          singlePageSteps,
          currentTargetPageIndex,
        ),
      })
    } else {
      setPageState((prev) => ({ ...prev, pageIndex: currentTargetPageIndex }))
    }

    setMode(next)
  }, [activeDoubleSteps, currentTargetPageIndex, mode, singlePageSteps])

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
          stepIndex: pageState.stepIndex,
          mode,
          direction: readingDirection,
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
          stepIndex: pageState.stepIndex,
          mode,
          direction: readingDirection,
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
    pageState.stepIndex,
    maxPageIndex,
    mode,
    readingDirection,
    zoomPreset,
  ])

  const goToPage = useCallback(
    (nextPageIndex: number) => {
      setPageState(
        derivePageIndicesForLocal(
          nextPageIndex,
          pages,
          doublePageOffset,
          isTouchPortrait,
          readingDirection,
        ),
      )
    },
    [doublePageOffset, isTouchPortrait, pages, readingDirection],
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
          direction: readingDirection,
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
          direction: readingDirection,
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
    [
      chapterId,
      chapterPayload,
      maxPageIndex,
      mode,
      readingDirection,
      zoomPreset,
    ],
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
    persistProgressNow(currentProgressPageIndex, pageState.stepIndex)
    void navigate({
      to: '/reader/$chapterId',
      params: { chapterId: previousChapterId },
    })
  }, [
    currentProgressPageIndex,
    pageState.stepIndex,
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
      if (pageState.stepIndex >= maxStepIndex) {
        if (pendingBoundaryDirection === 'next' && nextChapterId) {
          goToNextChapter()
        } else {
          armBoundaryNotice('next')
        }
        return
      }

      setPageState((prev) => {
        const next = Math.min(prev.stepIndex + 1, maxStepIndex)
        return {
          ...prev,
          stepIndex: next,
          pageIndex: activeDoubleSteps[next]?.anchorPageIndex ?? prev.pageIndex,
        }
      })
      setPendingBoundaryDirection(null)
      setBoundaryNotice(null)
      return
    }

    if (mode === 'single') {
      if (pageState.singleStepIndex >= maxSingleStepIndex) {
        if (pendingBoundaryDirection === 'next' && nextChapterId) {
          goToNextChapter()
        } else {
          armBoundaryNotice('next')
        }
        return
      }

      setPageState((prev) => {
        const next = Math.min(prev.singleStepIndex + 1, maxSingleStepIndex)
        return {
          ...prev,
          singleStepIndex: next,
          pageIndex: singlePageSteps[next]?.anchorPageIndex ?? prev.pageIndex,
        }
      })
      setPendingBoundaryDirection(null)
      setBoundaryNotice(null)
      return
    }

    if (pageState.pageIndex >= maxPageIndex) {
      if (pendingBoundaryDirection === 'next' && nextChapterId) {
        goToNextChapter()
      } else {
        armBoundaryNotice('next')
      }
      return
    }

    setPendingBoundaryDirection(null)
    setBoundaryNotice(null)
    goToPage(pageState.pageIndex + 1)
  }, [
    pageState.pageIndex,
    pageState.stepIndex,
    pageState.singleStepIndex,
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
      if (pageState.stepIndex <= 0) {
        if (pendingBoundaryDirection === 'prev' && previousChapterId) {
          goToPreviousChapter()
        } else {
          armBoundaryNotice('prev')
        }
        return
      }

      setPageState((prev) => {
        const next = Math.max(prev.stepIndex - 1, 0)
        return {
          ...prev,
          stepIndex: next,
          pageIndex: activeDoubleSteps[next]?.anchorPageIndex ?? prev.pageIndex,
        }
      })
      setPendingBoundaryDirection(null)
      setBoundaryNotice(null)
      return
    }

    if (mode === 'single') {
      if (pageState.singleStepIndex <= 0) {
        if (pendingBoundaryDirection === 'prev' && previousChapterId) {
          goToPreviousChapter()
        } else {
          armBoundaryNotice('prev')
        }
        return
      }

      setPageState((prev) => {
        const next = Math.max(prev.singleStepIndex - 1, 0)
        return {
          ...prev,
          singleStepIndex: next,
          pageIndex: singlePageSteps[next]?.anchorPageIndex ?? prev.pageIndex,
        }
      })
      setPendingBoundaryDirection(null)
      setBoundaryNotice(null)
      return
    }

    if (pageState.pageIndex <= 0) {
      if (pendingBoundaryDirection === 'prev' && previousChapterId) {
        goToPreviousChapter()
      } else {
        armBoundaryNotice('prev')
      }
      return
    }

    setPendingBoundaryDirection(null)
    setBoundaryNotice(null)
    goToPage(pageState.pageIndex - 1)
  }, [
    pageState.pageIndex,
    pageState.stepIndex,
    pageState.singleStepIndex,
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
          if (readingDirection === 'rtl') {
            goNext()
          } else {
            goPrevious()
          }
        } else {
          if (readingDirection === 'rtl') {
            goPrevious()
          } else {
            goNext()
          }
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
          ? readingDirection === 'rtl'
            ? 'next'
            : 'prev'
          : readingDirection === 'rtl'
            ? 'prev'
            : 'next'
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
    [goNext, goPrevious, isTouchDevice, mode, readingDirection],
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
  }, [
    pageState.pageIndex,
    pageState.singleStepIndex,
    pageState.stepIndex,
    mode,
  ])

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
        if (readingDirection === 'rtl') {
          goNext()
        } else {
          goPrevious()
        }
        return
      }

      if (readingDirection === 'rtl') {
        goPrevious()
      } else {
        goNext()
      }
    },
    [goNext, goPrevious, isTouchDevice, mode, readingDirection],
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
        if (readingDirection === 'rtl') {
          goPrevious()
        } else {
          goNext()
        }
        return
      }

      if (event.code === 'ArrowLeft' || event.code === 'KeyA') {
        event.preventDefault()
        blurReaderFocusTarget()
        if (readingDirection === 'rtl') {
          goNext()
        } else {
          goPrevious()
        }
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
    readingDirection,
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
    pageState.stepIndex,
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

  useGSAP(
    () => {
      if (typeof window === 'undefined') return
      const mm = gsap.matchMedia()
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        if (sidebarRef.current) {
          gsap.fromTo(
            sidebarRef.current,
            { x: sidebarOpen ? '-100%' : '0%', autoAlpha: sidebarOpen ? 0 : 1 },
            {
              x: sidebarOpen ? '0%' : '-100%',
              autoAlpha: sidebarOpen ? 1 : 0,
              duration: 0.25,
              ease: 'power3.out',
            },
          )
        }
      })
      return () => mm.revert()
    },
    { dependencies: [sidebarOpen], scope: sidebarRef },
  )

  useGSAP(
    () => {
      if (!boundaryNotice) return
      if (typeof window === 'undefined') return
      const mm = gsap.matchMedia()
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.fromTo(
          boundaryRef.current,
          { autoAlpha: 0, y: 12, scale: 0.96 },
          {
            autoAlpha: 1,
            y: 0,
            scale: 1,
            duration: 0.22,
            ease: 'back.out(1.7)',
          },
        )
      })
      return () => mm.revert()
    },
    { dependencies: [boundaryNotice], scope: boundaryRef },
  )

  useGSAP(
    () => {
      if (!showPageHud || !hudRef.current) return
      if (typeof window === 'undefined') return
      const mm = gsap.matchMedia()
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.fromTo(
          hudRef.current,
          { autoAlpha: 0, y: 6 },
          { autoAlpha: 1, y: 0, duration: 0.15, ease: 'power2.out' },
        )
      })
      return () => mm.revert()
    },
    { dependencies: [showPageHud, pageState.pageIndex], scope: hudRef },
  )

  useGSAP(
    () => {
      if (typeof window === 'undefined') return
      const el = settingsContentRef.current
      if (!el) return
      const mm = gsap.matchMedia()
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        if (mobileSettingsMinimized) {
          gsap.to(el, { autoAlpha: 0, duration: 0.15, ease: 'power2.in' })
        } else {
          gsap.to(el, { autoAlpha: 1, duration: 0.2, ease: 'power2.out' })
        }
      })
      return () => mm.revert()
    },
    { dependencies: [mobileSettingsMinimized], scope: settingsContentRef },
  )

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
      <div className="flex min-h-[40dvh] flex-col items-center justify-center gap-4 p-6">
        <div className="flex max-w-sm flex-col items-center gap-4 rounded border border-destructive/30 bg-destructive/10 px-6 py-8 text-center">
          <p className="text-sm text-destructive">{error}</p>
          <Button
            variant="default"
            className="h-12 min-w-[140px] px-5 text-sm"
            onClick={() => {
              void loadChapter()
            }}
          >
            Try again
          </Button>
          <Link
            to="/"
            className="inline-flex min-h-11 items-center text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Go back to home
          </Link>
        </div>
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

  const advancedTuningInner = (
    <div className="mt-2 grid gap-2">
      {!isTouchDevice ? (
        <div className="grid gap-2">
          <Button
            type="button"
            variant={magnifierEnabled ? 'default' : 'soft'}
            className="h-11 w-full px-3"
            onClick={() => setMagnifierEnabled((value) => !value)}
          >
            Magnifier: {magnifierEnabled ? 'On' : 'Off'}
          </Button>
          <Button
            type="button"
            variant={focusMode ? 'default' : 'soft'}
            className="h-11 w-full px-3"
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
              clampNumber(Number.parseInt(event.target.value, 10), 1, 24),
            )
          }
          className="mt-1 min-h-11"
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
              clampNumber(Number.parseInt(event.target.value, 10), 0, 12),
            )
          }
          className="mt-1 min-h-11"
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
              clampNumber(Number.parseInt(event.target.value, 10), 1, 8),
            )
          }
          className="mt-1 min-h-11"
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
              clampNumber(Number.parseInt(event.target.value, 10), 1, 24),
            )
          }
          className="mt-1 min-h-11"
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
              clampNumber(Number.parseInt(event.target.value, 10), 1, 16),
            )
          }
          className="mt-1 min-h-11"
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
              clampNumber(Number.parseInt(event.target.value, 10), 400, 5000),
            )
          }
          className="mt-1 min-h-11"
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
              clampNumber(Number.parseInt(event.target.value, 10), 120, 420),
            )
          }
          className="mt-1 min-h-11"
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
              clampNumber(Number.parseFloat(event.target.value), 2, 5),
            )
          }
          className="mt-1 min-h-11"
        />
      </label>
    </div>
  )

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
          aria-label={
            sidebarOpen ? 'Close settings panel' : 'Open settings panel'
          }
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
          className="absolute ui-right-safe-offset ui-top-safe-offset z-40 h-11 px-3 text-xs"
          onClick={() => {
            void toggleFullscreen()
          }}
        >
          Exit
        </Button>
      ) : null}

      {!fullscreenActive ? (
        <aside
          ref={sidebarRef}
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
                className="h-11 px-3 text-xs"
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
                className="reader-settings-action inline-flex h-11 shrink-0 items-center border border-border bg-surface-soft px-3 text-muted-foreground hover:bg-surface"
              >
                Series
              </Link>
              <div className="flex shrink-0 gap-0.5">
                <Button
                  type="button"
                  variant={mode === 'single' ? 'default' : 'soft'}
                  className="h-12 px-3 text-xs"
                  aria-label="Switch to single-page mode"
                  onClick={() => {
                    setMode('single')
                    goToPage(currentTargetPageIndex)
                  }}
                >
                  1
                </Button>
                <Button
                  type="button"
                  variant={mode === 'double' ? 'default' : 'soft'}
                  className="h-12 px-3 text-xs"
                  aria-label="Switch to two-page mode"
                  onClick={() => {
                    setMode('double')
                    goToPage(currentTargetPageIndex)
                  }}
                >
                  2
                </Button>
                <Button
                  type="button"
                  variant={mode === 'scroll' ? 'default' : 'soft'}
                  className="h-12 px-3 text-xs"
                  aria-label="Switch to scroll mode"
                  onClick={() => {
                    setMode('scroll')
                    goToPage(currentTargetPageIndex)
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
                style={
                  readingDirection === 'rtl'
                    ? { transform: 'scaleX(-1)' }
                    : undefined
                }
                data-testid="page-scrubber-landscape"
              />
              <Button
                type="button"
                variant="soft"
                className="h-12 shrink-0 px-3 text-xs"
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
              ref={settingsContentRef}
              className={
                isTouchDevice && mobileSettingsMinimized ? 'invisible' : ''
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
                  {seriesTitle ?? 'Open series page'}
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
                      className="h-12"
                      onClick={() => {
                        setMode('single')
                        goToPage(currentTargetPageIndex)
                      }}
                    >
                      Single
                    </Button>
                    <Button
                      type="button"
                      variant={mode === 'double' ? 'default' : 'soft'}
                      className="h-12"
                      onClick={() => {
                        setMode('double')
                        goToPage(currentTargetPageIndex)
                      }}
                    >
                      Double
                    </Button>
                    <Button
                      type="button"
                      variant={mode === 'scroll' ? 'default' : 'soft'}
                      className="h-12"
                      onClick={() => {
                        setMode('scroll')
                        goToPage(currentTargetPageIndex)
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
                      goToPage(currentTargetPageIndex)
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

                {isTouchDevice ? (
                  <div className="col-span-2 grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant={readingDirection === 'rtl' ? 'default' : 'soft'}
                      className="h-12"
                      onClick={() => setReadingDirection('rtl')}
                    >
                      RTL
                    </Button>
                    <Button
                      type="button"
                      variant={readingDirection === 'ltr' ? 'default' : 'soft'}
                      className="h-12"
                      onClick={() => setReadingDirection('ltr')}
                    >
                      LTR
                    </Button>
                  </div>
                ) : (
                  <SelectField
                    value={readingDirection}
                    aria-label="Reading direction"
                    onChange={(event) =>
                      setReadingDirection(
                        event.target.value === 'ltr' ? 'ltr' : 'rtl',
                      )
                    }
                    className="h-12"
                    options={[
                      { value: 'rtl', label: 'Right to left' },
                      { value: 'ltr', label: 'Left to right' },
                    ]}
                  />
                )}

                {!(isTouchDevice && isTouchPortrait) ? (
                  <>
                    <Button
                      type="button"
                      variant={doublePageOffset ? 'default' : 'soft'}
                      className="h-12 w-full px-3"
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
                      className="h-12"
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
                              if (
                                nextId === chapterPayload.manifest.chapterId
                              ) {
                                return
                              }
                              persistProgressNow(
                                currentProgressPageIndex,
                                pageState.stepIndex,
                              )
                              void navigate({
                                to: '/reader/$chapterId',
                                params: { chapterId: nextId },
                              })
                            }}
                            className={`h-12 min-w-0 ${isTouchDevice ? 'col-span-2' : ''}`}
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
                    style={
                      readingDirection === 'rtl'
                        ? { transform: 'scaleX(-1)' }
                        : undefined
                    }
                    data-testid="page-scrubber"
                  />
                </label>
              </div>

              {isTouchDevice && isTouchPortrait && (
                <details
                  className="exp-details-panel mt-2 px-3 py-2 text-xs text-muted-foreground"
                  open
                >
                  <summary className="exp-details-summary">
                    More settings
                  </summary>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <SelectField
                      value={zoomPreset}
                      aria-label="Zoom preset"
                      onChange={(event) =>
                        setZoomPreset(event.target.value as ZoomPreset)
                      }
                      className="h-12"
                      data-testid="zoom-select"
                      options={[
                        { value: 'fit-height', label: 'Fit to screen' },
                        { value: 'fit-width', label: 'Fit to width' },
                        { value: 'actual', label: 'Actual size' },
                      ]}
                    />
                    <Button
                      type="button"
                      variant={doublePageOffset ? 'default' : 'soft'}
                      className="h-12 w-full px-3"
                      onClick={() => setDoublePageOffset((value) => !value)}
                    >
                      Offset: {doublePageOffset ? 'On' : 'Off'}
                    </Button>
                  </div>
                  {seriesChapters.length > 0 ? (
                    <div className="mt-2">
                      <p className="reader-settings-heading col-span-2">
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
                              pageState.stepIndex,
                            )
                            void navigate({
                              to: '/reader/$chapterId',
                              params: { chapterId: nextId },
                            })
                          }}
                          className="h-12 min-w-0 col-span-2"
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
                    </div>
                  ) : null}
                  <details className="reader-settings-advanced mt-2 text-xs text-muted-foreground">
                    <summary className="font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                      Advanced tuning
                    </summary>
                    {advancedTuningInner}
                  </details>
                </details>
              )}

              {!(isTouchDevice && isTouchPortrait) ? (
                <details className="reader-settings-advanced mt-3 text-xs text-muted-foreground">
                  <summary className="font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    Advanced tuning
                  </summary>
                  {advancedTuningInner}
                </details>
              ) : null}

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
                  ? `Spread ${pageState.stepIndex + 1} / ${Math.max(activeDoubleSteps.length, 1)}`
                  : mode === 'single'
                    ? `Page ${pageState.singleStepIndex + 1} / ${Math.max(singlePageSteps.length, 1)}`
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
              {spreadNumbers.left ?? ''}
            </div>
            {spreadNumbers.right ? (
              <div className="pointer-events-none absolute ui-bottom-safe-offset ui-right-safe-offset z-20 text-[10px] font-medium text-white/55">
                {spreadNumbers.right}
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
        <div
          ref={boundaryRef}
          className="pointer-events-none absolute ui-bottom-safe-stack left-4 right-4 z-30 flex items-center justify-center gap-2 rounded-sm border border-white/20 bg-black/85 px-4 py-3 text-center text-sm text-white/90 shadow-lg backdrop-blur-sm md:bottom-20 md:left-1/2 md:right-auto md:-translate-x-1/2 md:px-6"
        >
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
              onVisiblePageChange={(pageIndex) =>
                setPageState((prev) => ({
                  ...prev,
                  pageIndex,
                  stepIndex: 0,
                  singleStepIndex: 0,
                }))
              }
            />
            {fullscreenActive && showPageHud ? (
              <div
                ref={hudRef}
                className="reader-hud pointer-events-none absolute ui-bottom-safe-hud left-1/2 -translate-x-1/2 px-3 py-1 text-sm"
              >
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
              className={`flex h-full items-center justify-center gap-0 overflow-hidden ${isSinglePageTouchView ? 'px-4' : ''}`}
              data-testid="reader-paging-container"
            >
              {renderUnitsForPaging(currentRenderUnits, 'current')}
            </div>

            {!isTouchDevice && !magnifierEnabled && zoomPreset !== 'actual' ? (
              <ReaderTapZone
                side="left"
                action={readingDirection === 'rtl' ? 'next' : 'previous'}
                onActivate={readingDirection === 'rtl' ? goNext : goPrevious}
              />
            ) : null}
            {!isTouchDevice && !magnifierEnabled && zoomPreset !== 'actual' ? (
              <ReaderTapZone
                side="right"
                action={readingDirection === 'rtl' ? 'previous' : 'next'}
                onActivate={readingDirection === 'rtl' ? goPrevious : goNext}
              />
            ) : null}
            {!fullscreenActive &&
            showReaderChrome &&
            !isTouchDevice &&
            !sidebarOpen ? (
              <>
                <ReaderEdgeArrowButton
                  side="left"
                  action={readingDirection === 'rtl' ? 'next' : 'previous'}
                  onActivate={readingDirection === 'rtl' ? goNext : goPrevious}
                />
                <ReaderEdgeArrowButton
                  side="right"
                  action={readingDirection === 'rtl' ? 'previous' : 'next'}
                  onActivate={readingDirection === 'rtl' ? goPrevious : goNext}
                />
              </>
            ) : null}
            {fullscreenActive && showPageHud ? (
              <div
                ref={hudRef}
                className="reader-hud pointer-events-none absolute ui-bottom-safe-hud left-1/2 -translate-x-1/2 px-3 py-1 text-sm"
              >
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
