import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import readerCss from '../reader.css?url'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  type PointerEvent as ReactPointerEvent,
  useRef,
  useState,
  type MouseEvent,
} from 'react'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import { flushSync } from 'react-dom'

if (typeof window !== 'undefined') {
  gsap.registerPlugin(useGSAP)
}

import { ContinuousScroll } from '#/components/reader/continuous-scroll'
import { PagePane } from '#/components/reader/page-pane'
import { ChapterPanel } from '#/components/ChapterPanel'
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
  ReaderDirection,
  ReaderMode,
  WeebcentralChapterDTO,
  WeebcentralSeriesDTO,
  ZoomPreset,
} from '#/lib/contracts'
import { addBoundedSetEntry, setBoundedMapEntry } from '#/lib/bounded-cache'
import { resolveApiUrl } from '#/lib/http-client'
import {
  weebcentralChapterQueryOptions,
  weebcentralSeriesQueryOptions,
} from '#/lib/query-options'
import type { AppRouterContext } from '#/lib/router-context'
import { upsertReadingHistory } from '#/lib/reading-history'
import { canonicalUrl } from '#/lib/seo'
import {
  buildTwoPageSteps,
  findStepIndexByPageIndex,
  inferAutoSpreadFlags,
  type PairingPage,
  type PairingStep,
  type RenderUnit,
} from '#/lib/reader/pairing'
import * as ReaderUI from '#/lib/reader/reader-ui-storage'
import { useTouchDevice, useTouchPortrait } from '#/hooks/use-touch-portrait'

function WeebcentralPending() {
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

export const Route = createFileRoute('/weebcentral/$chapterId')({
  headers: () => ({
    'X-Robots-Tag': 'index, follow',
  }),
  head: ({ params }: { params: { chapterId: string } }) => ({
    meta: [
      { title: 'Tsuki reader' },
      {
        name: 'description',
        content:
          'Read manga chapters in Tsuki with a clean, distraction-free viewer.',
      },
      { name: 'robots', content: 'index,follow,max-image-preview:large' },
    ],
    links: [
      {
        rel: 'canonical',
        href: canonicalUrl(
          `/weebcentral/${encodeURIComponent(params.chapterId)}`,
        ),
      },
      { rel: 'stylesheet', href: readerCss },
    ],
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
      weebcentralChapterQueryOptions(params.chapterId),
    )
  },
  staleTime: 45_000,
  preloadStaleTime: 120_000,
  gcTime: 15 * 60_000,
  pendingMs: 100,
  pendingMinMs: 300,
  component: WeebcentralReaderPage,
  pendingComponent: WeebcentralPending,
})

const REMOTE_PROGRESS_STORAGE_KEY = 'tsuki-remote-progress.v1'
const LEGACY_REMOTE_PROGRESS_STORAGE_KEY = 'suki-remote-progress.v1'
const prefetchedRemoteImageUrls = new Set<string>()
const inFlightRemoteImagePrefetches = new Map<string, HTMLImageElement>()
const PREFETCHED_REMOTE_IMAGE_URL_LIMIT = 1600
const REMOTE_PAGE_DIMENSIONS_LIMIT = 180
interface RemotePageDimension {
  width: number
  height: number
}
const remotePageDimensionsCache = new Map<
  string,
  Record<number, RemotePageDimension>
>()
const REMOTE_READER_UI_PREFS_KEY = 'tsuki-remote-reader-ui.v1'
const LEGACY_REMOTE_READER_UI_PREFS_KEY = 'suki-remote-reader-ui.v1'
const DEFAULT_REMOTE_READER_UI_PREFS: ReaderUI.ReaderUiPrefs = {
  mode: 'single',
  zoomPreset: 'fit-width',
  sidebarOpen: false,
  doublePageOffset: false,
  preloadAhead: 6,
  preloadBehind: 2,
  prefetchConcurrency: 2,
  nextChapterPrefetchThreshold: 6,
  nextChapterWarmPages: 2,
  uiAutoHideMs: 1400,
  magnifierSize: 220,
  magnifierZoom: 2.4,
}

const REMOTE_READER_SERIES_PRESETS_KEY = 'tsuki-remote-reader-series-presets.v1'
const LEGACY_REMOTE_READER_SERIES_PRESETS_KEY =
  'suki-remote-reader-series-presets.v1'
const REMOTE_READER_OPENING_LINES = [
  'Warming up page turns…',
  'Pulling chapter pages…',
  'Locking in your reading lane…',
] as const
const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect



interface StoredRemoteProgress {
  pageIndex: number
  mode: ReaderMode
  direction: ReaderDirection
  zoomPreset: ZoomPreset
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
  if (!Number.isFinite(value)) {
    return min
  }

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
    const raw = ReaderUI.readStorageWithLegacy(
      REMOTE_PROGRESS_STORAGE_KEY,
      LEGACY_REMOTE_PROGRESS_STORAGE_KEY,
    )
    if (!raw) {
      return null
    }

    const payload = JSON.parse(raw) as Record<
      string,
      Partial<StoredRemoteProgress>
    >
    const item = payload[chapterId]
    if (!item) {
      return null
    }

    return {
      pageIndex:
        typeof item.pageIndex === 'number' ? Math.max(0, item.pageIndex) : 0,
      mode:
        item.mode === 'double' || item.mode === 'scroll' ? item.mode : 'single',
      direction: item.direction === 'ltr' ? 'ltr' : 'rtl',
      zoomPreset:
        item.zoomPreset === 'fit-width' || item.zoomPreset === 'actual'
          ? item.zoomPreset
          : 'fit-width',
    }
  } catch {
    return null
  }
}

function saveRemoteProgress(chapterId: string, progress: StoredRemoteProgress) {
  try {
    const raw = ReaderUI.readStorageWithLegacy(
      REMOTE_PROGRESS_STORAGE_KEY,
      LEGACY_REMOTE_PROGRESS_STORAGE_KEY,
    )
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

interface ReaderPageState {
  pageIndex: number
  stepIndex: number
  singleStepIndex: number
}

function derivePageIndices(
  pageIndex: number,
  pages: ChapterPageManifest[],
  doublePageOffset: boolean,
  isTouchPortrait: boolean,
  readingDirection: ReaderDirection,
): ReaderPageState {
  const safeIdx = clamp(pageIndex, 0, Math.max(pages.length - 1, 0))
  const pairingPages = pages.map(asPairingPage)
  const doubleSteps = ReaderUI.buildDoublePageStepsWithOffset(
    pairingPages,
    doublePageOffset,
  )
  const portraitSteps = ReaderUI.expandStepsForPortraitSingle(
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

function WeebcentralReaderPage() {
  const params = Route.useParams()
  const search = Route.useSearch() as {
    seriesId?: string
    seriesTitle?: string
  }
  const navigate = useNavigate()
  const loaderChapter = Route.useLoaderData() as
    | WeebcentralChapterDTO
    | undefined
  const queryClient = useQueryClient()
  const openingLine = useMemo(() => {
    const seed = params.chapterId.length + (params.chapterId.charCodeAt(0) || 0)
    return REMOTE_READER_OPENING_LINES[
      seed % REMOTE_READER_OPENING_LINES.length
    ]
  }, [params.chapterId])

  const cachedChapter = useMemo(() => {
    if (typeof window === 'undefined') return null
    if (loaderChapter?.chapterId === params.chapterId) {
      return loaderChapter
    }
    const cached = queryClient.getQueryData<WeebcentralChapterDTO>(
      weebcentralChapterQueryOptions(params.chapterId).queryKey,
    )
    if (cached?.chapterId === params.chapterId) return cached
    return null
  }, [params.chapterId, loaderChapter])

  const initialCachedDimensions = useMemo(() => {
    if (!cachedChapter) return {} as Record<number, RemotePageDimension>
    return remotePageDimensionsCache.get(cachedChapter.chapterId) ?? {}
  }, [cachedChapter])

  const cachedPages = useMemo(() => {
    if (!cachedChapter) return [] as ChapterPageManifest[]
    return createPlaceholderPages(cachedChapter, initialCachedDimensions)
  }, [cachedChapter, initialCachedDimensions])

  const [series, setSeries] = useState<WeebcentralSeriesDTO | null>(null)
  const [chapter, setChapter] = useState<WeebcentralChapterDTO | null>(
    cachedChapter,
  )
  const [isLoading, setIsLoading] = useState(() => !cachedChapter)
  const [error, setError] = useState<string | null>(null)
  const initialUiPrefs = useMemo(
    () =>
      ReaderUI.loadReaderUiPrefs(
        REMOTE_READER_UI_PREFS_KEY,
        LEGACY_REMOTE_READER_UI_PREFS_KEY,
        DEFAULT_REMOTE_READER_UI_PREFS,
      ) ?? DEFAULT_REMOTE_READER_UI_PREFS,
    [],
  )

  const [mode, setMode] = useState<ReaderMode>(initialUiPrefs.mode)
  const [zoomPreset, setZoomPreset] = useState<ZoomPreset>(
    initialUiPrefs.zoomPreset,
  )
  const [readingDirection, setReadingDirection] = useState<ReaderDirection>(
    () => {
      if (typeof window === 'undefined') return 'rtl'
      const maybeSeriesId = search.seriesId
      if (!maybeSeriesId) return 'rtl'
      const preset = ReaderUI.loadReaderSeriesPreset(maybeSeriesId, REMOTE_READER_SERIES_PRESETS_KEY, LEGACY_REMOTE_READER_SERIES_PRESETS_KEY)
      return preset?.readingDirection ?? 'rtl'
    },
  )
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(
    initialUiPrefs.sidebarOpen,
  )
  const [doublePageOffset, setDoublePageOffset] = useState<boolean>(
    initialUiPrefs.doublePageOffset,
  )
  const [showChapterPanel, setShowChapterPanel] = useState(false)
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
  const [pageDimensions, setPageDimensions] = useState<
    Record<number, RemotePageDimension>
  >(initialCachedDimensions)
  const [pageState, setPageState] = useState<ReaderPageState>(() => {
    if (!cachedChapter) return ZERO_PAGE_STATE
    if (cachedPages.length === 0) return ZERO_PAGE_STATE
    const savedProgress = loadRemoteProgress(cachedChapter.chapterId)
    const pageIdx = clamp(
      savedProgress?.pageIndex ?? 0,
      0,
      cachedPages.length - 1,
    )
    return derivePageIndices(pageIdx, cachedPages, false, false, 'rtl')
  })
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [inlineFullscreen, setInlineFullscreen] = useState(false)
  const [showPageHud, setShowPageHud] = useState(false)
  const [pendingBoundaryDirection, setPendingBoundaryDirection] = useState<
    'next' | 'prev' | null
  >(null)
  const [boundaryNotice, setBoundaryNotice] = useState<string | null>(null)

  const [nativePagerVisualLock, setNativePagerVisualLock] = useState(false)

  const viewportRef = useRef<HTMLDivElement>(null)
  const readerStageRef = useRef<HTMLElement>(null)
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
    lock: 'x' | 'y' | null
  } | null>(null)
  const suppressTapRef = useRef(false)
  const swipeCommitTimeoutRef = useRef<number | null>(null)
  const swipeTrackRef = useRef<HTMLDivElement>(null)
  const swipeOffsetRef = useRef(0)
  const swipeDraggingRef = useRef(false)
  const nativePagerRef = useRef<HTMLDivElement>(null)
  const pagerSettleTimeoutRef = useRef<number | null>(null)
  const nativePagerCenterRafRef = useRef<number | null>(null)
  const nativePagerInitRafRef = useRef<number | null>(null)
  const nativePagerVisualLockTimeoutRef = useRef<number | null>(null)
  const nativePagerReadyRef = useRef(false)
  const nativePagerCenteringRef = useRef(false)
  const sidebarRef = useRef<HTMLDivElement>(null)
  const boundaryRef = useRef<HTMLDivElement>(null)
  const hudRef = useRef<HTMLDivElement>(null)
  const settingsContentRef = useRef<HTMLDivElement>(null)
  const isTouchDevice = useTouchDevice()
  const isTouchPortrait = useTouchPortrait()

  const pages = useMemo(
    () => (chapter ? createPlaceholderPages(chapter, pageDimensions) : []),
    [chapter, pageDimensions],
  )
  const pageByIndex = useMemo(
    () => new Map(pages.map((page) => [page.pageIndex, page] as const)),
    [pages],
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
        setBoundedMapEntry(
          remotePageDimensionsCache,
          chapter.chapterId,
          next,
          REMOTE_PAGE_DIMENSIONS_LIMIT,
        )
        return next
      })
    },
    [chapter],
  )

  const twoPageSteps = useMemo(
    () =>
      ReaderUI.buildDoublePageStepsWithOffset(
        pages.map(asPairingPage),
        doublePageOffset,
      ),
    [doublePageOffset, pages],
  )
  const portraitSingleSteps = useMemo(
    () => ReaderUI.expandStepsForPortraitSingle(twoPageSteps, pages, readingDirection),
    [pages, readingDirection, twoPageSteps],
  )
  const singlePageSteps = useMemo(
    () => buildSinglePageSteps(pages, isTouchPortrait, readingDirection),
    [isTouchPortrait, pages, readingDirection],
  )
  const activeDoubleSteps = isTouchPortrait ? portraitSingleSteps : twoPageSteps
  const isSinglePageTouchView =
    isTouchDevice &&
    (mode === 'single' || (mode === 'double' && isTouchPortrait))
  const gallerySwipeEnabled =
    isTouchDevice && mode !== 'scroll' && zoomPreset !== 'actual'
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

  const activeSeriesId =
    series?.id ?? search.seriesId ?? chapter?.seriesId ?? null

  const previousChapterId =
    currentChapterIndex >= 0
      ? (series?.chapters[currentChapterIndex + 1]?.id ?? null)
      : null
  const nextChapterId =
    currentChapterIndex > 0
      ? (series?.chapters[currentChapterIndex - 1]?.id ?? null)
      : null

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

  const nextRenderUnits = useMemo(() => {
    if (mode === 'single') {
      if (pageState.singleStepIndex >= maxSingleStepIndex) {
        return [] as typeof displayUnits
      }

      return singlePageSteps[pageState.singleStepIndex + 1]?.units ?? []
    }

    return getDisplayUnitsForStep(
      activeDoubleSteps[pageState.stepIndex + 1] ?? null,
      pageByIndex,
      isTouchPortrait,
      readingDirection,
    )
  }, [
    activeDoubleSteps,
    pageState.singleStepIndex,
    pageState.stepIndex,
    isTouchPortrait,
    maxSingleStepIndex,
    mode,
    pageByIndex,
    readingDirection,
    singlePageSteps,
  ])

  const previousRenderUnits = useMemo(() => {
    if (mode === 'single') {
      if (pageState.singleStepIndex <= 0) {
        return [] as typeof displayUnits
      }

      return singlePageSteps[pageState.singleStepIndex - 1]?.units ?? []
    }

    return getDisplayUnitsForStep(
      activeDoubleSteps[pageState.stepIndex - 1] ?? null,
      pageByIndex,
      isTouchPortrait,
      readingDirection,
    )
  }, [
    activeDoubleSteps,
    pageState.singleStepIndex,
    pageState.stepIndex,
    isTouchPortrait,
    mode,
    pageByIndex,
    readingDirection,
    singlePageSteps,
  ])
  const leftRenderUnits = nativePagerVisualLock
    ? currentRenderUnits
    : readingDirection === 'rtl'
      ? nextRenderUnits.length > 0
        ? nextRenderUnits
        : currentRenderUnits
      : previousRenderUnits.length > 0
        ? previousRenderUnits
        : currentRenderUnits
  const rightRenderUnits = nativePagerVisualLock
    ? currentRenderUnits
    : readingDirection === 'rtl'
      ? previousRenderUnits.length > 0
        ? previousRenderUnits
        : currentRenderUnits
      : nextRenderUnits.length > 0
        ? nextRenderUnits
        : currentRenderUnits

  const armNativePagerVisualLock = useCallback((durationMs = 220) => {
    setNativePagerVisualLock(true)

    if (nativePagerVisualLockTimeoutRef.current !== null) {
      window.clearTimeout(nativePagerVisualLockTimeoutRef.current)
    }

    nativePagerVisualLockTimeoutRef.current = window.setTimeout(() => {
      setNativePagerVisualLock(false)
      nativePagerVisualLockTimeoutRef.current = null
    }, durationMs)
  }, [])

  const recenterNativePager = useCallback(
    (options?: { attempts?: number; markReady?: boolean }) => {
      const attempts = Math.max(options?.attempts ?? 2, 0)
      const markReady = options?.markReady ?? true
      const pager = nativePagerRef.current
      if (!pager) {
        return false
      }

      const width = pager.clientWidth
      if (width <= 0) {
        return false
      }

      if (nativePagerCenterRafRef.current !== null) {
        window.cancelAnimationFrame(nativePagerCenterRafRef.current)
        nativePagerCenterRafRef.current = null
      }

      let remainingAttempts = attempts
      nativePagerCenteringRef.current = true
      pager.style.scrollSnapType = 'none'
      pager.scrollLeft = width

      const settle = () => {
        const currentPager = nativePagerRef.current
        if (!currentPager) {
          nativePagerCenteringRef.current = false
          nativePagerCenterRafRef.current = null
          return
        }

        const currentWidth = currentPager.clientWidth
        if (currentWidth > 0) {
          const target = currentWidth
          if (Math.abs(currentPager.scrollLeft - target) > 1) {
            currentPager.scrollLeft = target
          }
        }

        if (remainingAttempts > 0) {
          remainingAttempts -= 1
          nativePagerCenterRafRef.current = window.requestAnimationFrame(settle)
          return
        }

        currentPager.style.scrollSnapType = ''
        nativePagerCenteringRef.current = false
        nativePagerCenterRafRef.current = null
        if (markReady) {
          nativePagerReadyRef.current = true
        }
      }

      nativePagerCenterRafRef.current = window.requestAnimationFrame(settle)
      return true
    },
    [],
  )

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
            variant={mode === 'single' ? 'default' : 'soft'}
            className="h-12 px-3 text-xs"
            aria-label="Switch to single-page mode"
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
            className="h-12 px-3 text-xs"
            aria-label="Switch to two-page mode"
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
            className="h-12 px-3 text-xs"
            aria-label="Switch to scroll mode"
            onClick={() => {
              setMode('scroll')
              goToPage(currentTargetPageIndex)
            }}
          >
            Scroll
          </Button>
        </div>
      ) : null}
      <label className="reader-settings-label">
        Pages to preload ahead
        <Input
          type="number"
          min={1}
          max={16}
          value={preloadAhead}
          onChange={(event) =>
            setPreloadAhead(
              clampNumber(Number.parseInt(event.target.value, 10), 1, 16),
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
          max={8}
          value={preloadBehind}
          onChange={(event) =>
            setPreloadBehind(
              clampNumber(Number.parseInt(event.target.value, 10), 0, 8),
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
          max={4}
          value={prefetchConcurrency}
          onChange={(event) =>
            setPrefetchConcurrency(
              clampNumber(Number.parseInt(event.target.value, 10), 1, 4),
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
          max={12}
          value={nextChapterPrefetchThreshold}
          onChange={(event) =>
            setNextChapterPrefetchThreshold(
              clampNumber(Number.parseInt(event.target.value, 10), 1, 12),
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
          max={6}
          value={nextChapterWarmPages}
          onChange={(event) =>
            setNextChapterWarmPages(
              clampNumber(Number.parseInt(event.target.value, 10), 1, 6),
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

  const persistRemoteProgressNow = useCallback(
    (pageIndex: number) => {
      if (!chapter) {
        return
      }

      saveRemoteProgress(chapter.chapterId, {
        pageIndex,
        mode,
        direction: readingDirection,
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
      readingDirection,
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

      setPendingBoundaryDirection(null)
      setBoundaryNotice(null)

      persistRemoteProgressNow(currentProgressPageIndex)

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
      currentProgressPageIndex,
      navigate,
      persistRemoteProgressNow,
      series?.id,
      series?.title,
    ],
  )

  const remoteChapterChangeRef = useRef<string | null>(null)

  useEffect(() => {
    const prev = remoteChapterChangeRef.current
    remoteChapterChangeRef.current = params.chapterId

    if (prev === params.chapterId) return

    if (prev !== null) {
      setChapter(null)
      setSeries(null)
      setPageDimensions({})
      setPageState(ZERO_PAGE_STATE)
      setIsLoading(true)
    }
  }, [params.chapterId])

  const loadRemoteChapter = useCallback(async () => {
    const chapterOptions = weebcentralChapterQueryOptions(params.chapterId)
    const cachedChapter = queryClient.getQueryData<WeebcentralChapterDTO>(
      chapterOptions.queryKey,
    )

    setIsLoading(!cachedChapter)
    setError(null)
    setPageDimensions({})
    setPageState(ZERO_PAGE_STATE)

    const applyChapterState = (chapterPayload: WeebcentralChapterDTO) => {
      setChapter(chapterPayload)

      const cachedDims =
        remotePageDimensionsCache.get(chapterPayload.chapterId) ?? {}
      const chapterPages = createPlaceholderPages(chapterPayload, cachedDims)
      setPageDimensions(cachedDims)

      const savedProgress = loadRemoteProgress(chapterPayload.chapterId)
      const initialPageIndex = clamp(
        savedProgress?.pageIndex ?? 0,
        0,
        chapterPayload.pages.length - 1,
      )
      setPageState(
        derivePageIndices(
          initialPageIndex,
          chapterPages,
          doublePageOffset,
          isTouchPortrait,
          readingDirection,
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
        cachedChapter ?? (await queryClient.fetchQuery(chapterOptions))
      if (!cachedChapter) {
        applyChapterState(chapterPayload)
      }

      const seriesInput =
        search.seriesId?.trim() || chapterPayload.seriesId || params.chapterId
      const seriesOptions = weebcentralSeriesQueryOptions(seriesInput)
      const cachedSeries = queryClient.getQueryData<WeebcentralSeriesDTO>(
        seriesOptions.queryKey,
      )
      if (cachedSeries) {
        setSeries(cachedSeries)
      }

      void (async () => {
        try {
          const seriesPayload =
            cachedSeries ?? (await queryClient.fetchQuery(seriesOptions))
          setSeries(seriesPayload)
        } catch {
          // Ignore series metadata failure; chapter can still render.
        }
      })()
    } catch (requestError) {
      void requestError
      setError('Could not open this chapter.')
    } finally {
      setIsLoading(false)
    }
  }, [params.chapterId, queryClient, search.seriesId])

  useEffect(() => {
    void loadRemoteChapter()
  }, [loadRemoteChapter])

  useEffect(() => {
    const chapterOptions = weebcentralChapterQueryOptions(params.chapterId)

    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated') return
      if (event.query.state.status !== 'success') return

      const key = event.query.queryKey
      if (key.length !== chapterOptions.queryKey.length) return
      if (
        !key.every((v: unknown, i: number) => v === chapterOptions.queryKey[i])
      )
        return

      const data = event.query.state.data as WeebcentralChapterDTO | undefined
      if (!data || data === chapter) return

      setChapter(data)
    })

    return unsubscribe
  }, [params.chapterId, queryClient, chapter])

  useEffect(() => {
    ReaderUI.saveReaderUiPrefs(REMOTE_READER_UI_PREFS_KEY, {
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

    const preset = ReaderUI.loadReaderSeriesPreset(activeSeriesId, REMOTE_READER_SERIES_PRESETS_KEY, LEGACY_REMOTE_READER_SERIES_PRESETS_KEY)
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

    ReaderUI.saveReaderSeriesPreset(activeSeriesId, {
      mode,
      zoomPreset,
      readingDirection,
      doublePageOffset,
      magnifierEnabled,
      focusMode,
    }, REMOTE_READER_SERIES_PRESETS_KEY, LEGACY_REMOTE_READER_SERIES_PRESETS_KEY)
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
    if (!chapter) {
      return
    }

    const timeout = window.setTimeout(() => {
      persistRemoteProgressNow(currentProgressPageIndex)
    }, 220)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [currentProgressPageIndex, chapter, persistRemoteProgressNow])

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

    pagesToWarm.forEach(({ url, pageIndex }) => {
      const resolvedUrl = resolveApiUrl(url)
      if (
        prefetchedRemoteImageUrls.has(resolvedUrl) ||
        inFlightRemoteImagePrefetches.has(resolvedUrl)
      ) {
        return
      }

      const image = new Image()
      image.decoding = 'async'
      image.loading = 'eager'
      inFlightRemoteImagePrefetches.set(resolvedUrl, image)

      const finalize = (loaded: boolean) => {
        inFlightRemoteImagePrefetches.delete(resolvedUrl)
        if (loaded) {
          addBoundedSetEntry(
            prefetchedRemoteImageUrls,
            resolvedUrl,
            PREFETCHED_REMOTE_IMAGE_URL_LIMIT,
          )
        }
      }

      image.addEventListener(
        'load',
        () => {
          rememberPageDimension(
            pageIndex,
            image.naturalWidth,
            image.naturalHeight,
          )
          finalize(true)
        },
        { once: true },
      )
      image.addEventListener(
        'error',
        () => {
          finalize(false)
        },
        { once: true },
      )
      image.src = resolvedUrl
    })
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

    const remainingPages = maxPageIndex - currentTargetPageIndex
    const shouldPrefetchNextChapter =
      remainingPages <= nextChapterPrefetchThreshold
    if (!shouldPrefetchNextChapter) {
      return
    }

    const chapterOptions = weebcentralChapterQueryOptions(nextChapterId, {
      prefetch: true,
    })
    if (queryClient.getQueryData(chapterOptions.queryKey)) {
      return
    }

    const controller = new AbortController()

    void (async () => {
      try {
        const payload =
          queryClient.getQueryData<WeebcentralChapterDTO>(
            chapterOptions.queryKey,
          ) ?? (await queryClient.fetchQuery(chapterOptions))

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
              await fetch(resolveApiUrl(page.url), {
                signal: controller.signal,
                cache: 'force-cache',
                headers: {
                  'x-tsuki-prefetch': '1',
                },
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
    nextChapterId,
    nextChapterPrefetchThreshold,
    nextChapterWarmPages,
    pages.length,
    prefetchConcurrency,
    queryClient,
  ])

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
    if (!fullscreenActive || !readerStageRef.current) return

    const container = readerStageRef.current
    const focusableSelector =
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

    const handleTabKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return

      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(focusableSelector),
      )
      if (focusable.length === 0) {
        container.focus({ preventScroll: true })
        return
      }

      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    container.addEventListener('keydown', handleTabKey)

    const firstFocusable =
      container.querySelector<HTMLElement>(focusableSelector)
    requestAnimationFrame(() => {
      firstFocusable?.focus()
    })

    return () => {
      container.removeEventListener('keydown', handleTabKey)
    }
  }, [fullscreenActive])

  useEffect(() => {
    if (!chapter || isLoading || fullscreenActive || sidebarOpen) return
    readerStageRef.current?.focus()
  }, [chapter, isLoading, fullscreenActive, sidebarOpen])

  useEffect(() => {
    if (!focusMode) {
      return
    }

    setSidebarOpen(false)
    setShowReaderChrome(false)
    setShowShortcutHelp(false)
  }, [focusMode])

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

      if (swipeCommitTimeoutRef.current !== null) {
        window.clearTimeout(swipeCommitTimeoutRef.current)
      }

      if (pagerSettleTimeoutRef.current !== null) {
        window.clearTimeout(pagerSettleTimeoutRef.current)
      }

      if (nativePagerVisualLockTimeoutRef.current !== null) {
        window.clearTimeout(nativePagerVisualLockTimeoutRef.current)
      }

      if (nativePagerInitRafRef.current !== null) {
        window.cancelAnimationFrame(nativePagerInitRafRef.current)
      }

      if (nativePagerCenterRafRef.current !== null) {
        window.cancelAnimationFrame(nativePagerCenterRafRef.current)
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
      setPageState(
        derivePageIndices(
          safeIndex,
          pages,
          doublePageOffset,
          isTouchPortrait,
          readingDirection,
        ),
      )
    },
    [doublePageOffset, isTouchPortrait, maxPageIndex, pages, readingDirection],
  )

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
          goToChapter(nextChapterId)
        } else {
          armBoundaryNotice('next')
        }
        return
      }

      setPageState((prev) => {
        const next = clamp(prev.stepIndex + 1, 0, maxStepIndex)
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
          goToChapter(nextChapterId)
        } else {
          armBoundaryNotice('next')
        }
        return
      }

      const nextSingle = clamp(
        pageState.singleStepIndex + 1,
        0,
        maxSingleStepIndex,
      )
      setPageState((prev) => ({
        ...prev,
        singleStepIndex: nextSingle,
        pageIndex:
          singlePageSteps[nextSingle]?.anchorPageIndex ?? prev.pageIndex,
      }))
      setPendingBoundaryDirection(null)
      setBoundaryNotice(null)
      return
    }

    if (pageState.pageIndex >= maxPageIndex) {
      if (pendingBoundaryDirection === 'next' && nextChapterId) {
        goToChapter(nextChapterId)
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
    goToChapter,
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
          goToChapter(previousChapterId)
        } else {
          armBoundaryNotice('prev')
        }
        return
      }

      setPageState((prev) => {
        const previous = clamp(prev.stepIndex - 1, 0, maxStepIndex)
        return {
          ...prev,
          stepIndex: previous,
          pageIndex:
            activeDoubleSteps[previous]?.anchorPageIndex ?? prev.pageIndex,
        }
      })
      setPendingBoundaryDirection(null)
      setBoundaryNotice(null)
      return
    }

    if (mode === 'single') {
      if (pageState.singleStepIndex <= 0) {
        if (pendingBoundaryDirection === 'prev' && previousChapterId) {
          goToChapter(previousChapterId)
        } else {
          armBoundaryNotice('prev')
        }
        return
      }

      setPageState((prev) => {
        const previousSingle = clamp(
          prev.singleStepIndex - 1,
          0,
          maxSingleStepIndex,
        )
        return {
          ...prev,
          singleStepIndex: previousSingle,
          pageIndex:
            singlePageSteps[previousSingle]?.anchorPageIndex ?? prev.pageIndex,
        }
      })
      setPendingBoundaryDirection(null)
      setBoundaryNotice(null)
      return
    }

    if (pageState.pageIndex <= 0) {
      if (pendingBoundaryDirection === 'prev' && previousChapterId) {
        goToChapter(previousChapterId)
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
    goToChapter,
    goToPage,
    maxSingleStepIndex,
    maxStepIndex,
    mode,
    nextChapterId,
    pendingBoundaryDirection,
    previousChapterId,
    activeDoubleSteps,
    singlePageSteps,
  ])

  const navigatingRef = useRef(false)

  const handleNativePagerScroll = useCallback(() => {
    if (
      !gallerySwipeEnabled ||
      !nativePagerReadyRef.current ||
      nativePagerCenteringRef.current
    ) {
      return
    }

    if (pagerSettleTimeoutRef.current !== null) {
      window.clearTimeout(pagerSettleTimeoutRef.current)
    }

    pagerSettleTimeoutRef.current = window.setTimeout(() => {
      if (
        navigatingRef.current ||
        !nativePagerReadyRef.current ||
        nativePagerCenteringRef.current
      ) {
        return
      }

      const pager = nativePagerRef.current
      if (!pager) {
        return
      }

      const width = pager.clientWidth
      if (width <= 0) {
        return
      }

      const index = Math.round(pager.scrollLeft / width)

      if (index <= 0) {
        const canNavigateLeft =
          readingDirection === 'rtl'
            ? nextRenderUnits.length > 0
            : previousRenderUnits.length > 0
        if (canNavigateLeft) {
          suppressTapRef.current = true
          navigatingRef.current = true
          armNativePagerVisualLock()
          flushSync(() => {
            if (readingDirection === 'rtl') {
              goNext()
            } else {
              goPrevious()
            }
          })
          recenterNativePager({ attempts: 1 })
          requestAnimationFrame(() => {
            navigatingRef.current = false
          })
        }
        return
      }

      if (index >= 2) {
        const canNavigateRight =
          readingDirection === 'rtl'
            ? previousRenderUnits.length > 0
            : nextRenderUnits.length > 0
        if (canNavigateRight) {
          suppressTapRef.current = true
          navigatingRef.current = true
          armNativePagerVisualLock()
          flushSync(() => {
            if (readingDirection === 'rtl') {
              goPrevious()
            } else {
              goNext()
            }
          })
          recenterNativePager({ attempts: 1 })
          requestAnimationFrame(() => {
            navigatingRef.current = false
          })
        }
        return
      }

      recenterNativePager({ attempts: 1 })
    }, 100)
  }, [
    armNativePagerVisualLock,
    gallerySwipeEnabled,
    goNext,
    goPrevious,
    nextRenderUnits.length,
    previousRenderUnits.length,
    readingDirection,
    recenterNativePager,
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
      if (!gallerySwipeEnabled || event.pointerType !== 'touch') {
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
    [gallerySwipeEnabled],
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

      const deltaX = event.clientX - gesture.startX
      const deltaY = event.clientY - gesture.startY
      const absX = Math.abs(deltaX)
      const absY = Math.abs(deltaY)

      if (!gallerySwipeEnabled) {
        if (mode === 'scroll') {
          return
        }

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
      const threshold = Math.max(48, width * 0.16)
      const commit =
        Math.abs(swipeOffsetRef.current) > threshold
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

      swipeOffsetRef.current = commit === 'next' ? width : -width
      if (swipeTrackRef.current) {
        swipeTrackRef.current.style.transition =
          'transform 160ms cubic-bezier(0.22, 0.78, 0.16, 1)'
        swipeTrackRef.current.style.transform = `translate3d(${swipeOffsetRef.current}px, 0, 0)`
      }

      if (swipeCommitTimeoutRef.current !== null) {
        window.clearTimeout(swipeCommitTimeoutRef.current)
      }

      swipeCommitTimeoutRef.current = window.setTimeout(() => {
        if (commit === 'next') {
          goNext()
        } else {
          goPrevious()
        }

        swipeOffsetRef.current = 0
        if (swipeTrackRef.current) {
          swipeTrackRef.current.style.transition = 'none'
          swipeTrackRef.current.style.transform = 'translate3d(0px, 0, 0)'
        }
        swipeCommitTimeoutRef.current = null
      }, 160)
    },
    [
      gallerySwipeEnabled,
      goNext,
      goPrevious,
      isTouchDevice,
      mode,
      readingDirection,
    ],
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
            chapterId={chapter?.chapterId ?? params.chapterId}
            unit={unit}
            page={page}
            imageUrl={pageUrlMap.get(page.pageIndex)}
            zoomPreset={zoomPreset}
            loading="eager"
            testId="reader-page-container"
            onImageMeasure={rememberPageDimension}
            forceFullWidth={isSinglePageTouchView}
          />
        )
      }),
    [
      chapter?.chapterId,
      isSinglePageTouchView,
      pageUrlMap,
      pageByIndex,
      params.chapterId,
      rememberPageDimension,
      zoomPreset,
    ],
  )

  useIsomorphicLayoutEffect(() => {
    swipeDraggingRef.current = false
    swipeOffsetRef.current = 0

    if (swipeTrackRef.current) {
      swipeTrackRef.current.style.transition = 'none'
      swipeTrackRef.current.style.transform = 'translate3d(0px, 0, 0)'
    }

    if (pagerSettleTimeoutRef.current !== null) {
      window.clearTimeout(pagerSettleTimeoutRef.current)
      pagerSettleTimeoutRef.current = null
    }

    if (!gallerySwipeEnabled || !nativePagerRef.current) {
      nativePagerReadyRef.current = false
      nativePagerCenteringRef.current = false
      setNativePagerVisualLock(false)
      if (nativePagerVisualLockTimeoutRef.current !== null) {
        window.clearTimeout(nativePagerVisualLockTimeoutRef.current)
        nativePagerVisualLockTimeoutRef.current = null
      }
      return
    }

    const pager = nativePagerRef.current
    const initializePager = (attempt = 0) => {
      const currentPager = nativePagerRef.current
      if (!currentPager) {
        return
      }

      if (currentPager.clientWidth <= 0) {
        if (attempt < 8) {
          nativePagerInitRafRef.current = window.requestAnimationFrame(() => {
            initializePager(attempt + 1)
          })
        }
        return
      }

      currentPager.style.overflowX = 'hidden'
      armNativePagerVisualLock(320)
      const centered = recenterNativePager({ attempts: 4, markReady: false })
      if (!centered) {
        if (attempt < 8) {
          nativePagerInitRafRef.current = window.requestAnimationFrame(() => {
            initializePager(attempt + 1)
          })
        }
        return
      }

      nativePagerInitRafRef.current = window.requestAnimationFrame(() => {
        const latestPager = nativePagerRef.current
        if (!latestPager) {
          return
        }

        if (
          latestPager.clientWidth > 0 &&
          Math.abs(latestPager.scrollLeft - latestPager.clientWidth) > 1
        ) {
          recenterNativePager({ attempts: 2, markReady: false })
        }

        latestPager.style.overflowX = ''
        nativePagerReadyRef.current = true
      })
    }

    nativePagerReadyRef.current = false
    initializePager()

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry || entry.contentRect.width <= 0 || navigatingRef.current) {
        return
      }

      recenterNativePager({
        attempts: 2,
        markReady: nativePagerReadyRef.current,
      })
    })
    resizeObserver.observe(pager)

    return () => {
      resizeObserver.disconnect()
      if (nativePagerInitRafRef.current !== null) {
        window.cancelAnimationFrame(nativePagerInitRafRef.current)
        nativePagerInitRafRef.current = null
      }
      if (nativePagerCenterRafRef.current !== null) {
        window.cancelAnimationFrame(nativePagerCenterRafRef.current)
        nativePagerCenterRafRef.current = null
      }
      pager.style.overflowX = ''
      pager.style.scrollSnapType = ''
      nativePagerReadyRef.current = false
      nativePagerCenteringRef.current = false
      setNativePagerVisualLock(false)
      if (nativePagerVisualLockTimeoutRef.current !== null) {
        window.clearTimeout(nativePagerVisualLockTimeoutRef.current)
        nativePagerVisualLockTimeoutRef.current = null
      }
    }
  }, [
    armNativePagerVisualLock,
    chapter?.chapterId,
    gallerySwipeEnabled,
    isLoading,
    recenterNativePager,
  ])

  useEffect(() => {
    if (
      !gallerySwipeEnabled ||
      !nativePagerReadyRef.current ||
      navigatingRef.current
    ) {
      return
    }

    recenterNativePager({ attempts: 1 })
  }, [
    pageState.pageIndex,
    pageState.singleStepIndex,
    pageState.stepIndex,
    gallerySwipeEnabled,
    mode,
    recenterNativePager,
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

      if (event.key === 'Escape') {
        if (document.fullscreenElement) {
          event.preventDefault()
          void document.exitFullscreen()
          return
        }
        if (inlineFullscreen) {
          event.preventDefault()
          setInlineFullscreen(false)
          return
        }
        if (sidebarOpen) {
          event.preventDefault()
          setSidebarOpen(false)
          return
        }
        if (showShortcutHelp) {
          event.preventDefault()
          setShowShortcutHelp(false)
          return
        }
        if (focusMode) {
          event.preventDefault()
          setFocusMode(false)
          return
        }
        if (boundaryNotice) {
          event.preventDefault()
          setBoundaryNotice(null)
          setPendingBoundaryDirection(null)
          return
        }
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
    goToChapter,
    magnifierEnabled,
    nextChapterId,
    previousChapterId,
    readingDirection,
    revealReaderUi,
    toggleFullscreen,
    sidebarOpen,
    inlineFullscreen,
    boundaryNotice,
    showShortcutHelp,
  ])

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

  const remoteSeriesTitle =
    series?.title ?? search.seriesTitle ?? 'Online series'
  const remoteSeriesIdForLink =
    series?.id ?? search.seriesId ?? chapter?.seriesId ?? params.chapterId
  const activeChapterMetadata =
    series?.chapters.find((entry) => entry.id === params.chapterId) ?? null

  if (isLoading) {
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

  if (error || !chapter) {
    return (
      <div className="flex min-h-[40dvh] flex-col items-center justify-center gap-4 p-6">
        <div className="flex max-w-sm flex-col items-center gap-4 rounded border border-destructive/30 bg-destructive/10 px-6 py-8 text-center">
          <p className="text-sm text-destructive">
            {error ?? 'Could not open this chapter.'}
          </p>
          <Button
            variant="default"
            className="h-12 min-w-[140px] px-5 text-sm"
            onClick={() => {
              void loadRemoteChapter()
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
          role={sidebarOpen ? 'complementary' : undefined}
          aria-label="Reader settings"
          aria-hidden={!sidebarOpen}
          className={
            isTouchDevice
              ? 'reader-shell-panel reader-settings-panel animate-enter relative z-30 w-full overflow-visible p-3'
              : `reader-shell-panel reader-settings-panel animate-enter absolute inset-y-0 left-0 z-40 w-[min(88vw,360px)] overflow-y-auto p-3 transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`
          }
          style={{
            animationDelay: '20ms',
            paddingTop: isTouchDevice
              ? 'max(0.75rem, calc(var(--safe-top) + 0.5rem))'
              : undefined,
          }}
        >
          {isTouchDevice ? (
            <div className="reader-settings-bar mb-2 flex items-center justify-between border border-border bg-surface-soft px-2 py-1.5">
              <span className="text-xs font-semibold text-foreground">
                Settings
              </span>
              <Button
                type="button"
                variant="soft"
                size="sm"
                className="h-12 px-3 text-xs"
                onClick={() =>
                  setMobileSettingsMinimized((current) => !current)
                }
              >
                {mobileSettingsMinimized ? 'Show' : 'Minimize'}
              </Button>
            </div>
          ) : null}

          <div
            ref={settingsContentRef}
            className={
              isTouchDevice && mobileSettingsMinimized ? 'invisible' : ''
            }
          >
            <div className="reader-settings-surface space-y-2 text-xs text-muted-foreground">
              <Link
                to="/"
                className="reader-settings-action inline-flex border border-border bg-surface-soft px-2 py-1 hover:bg-surface"
              >
                Back to home
              </Link>
              <Link
                to="/weebcentral-series/$seriesId"
                params={{ seriesId: remoteSeriesIdForLink }}
                className="block truncate text-sm font-semibold leading-snug text-foreground underline-offset-2 hover:underline"
              >
                {remoteSeriesTitle}
              </Link>
              <p>
                {activeChapterMetadata
                  ? `Ch ${activeChapterMetadata.number}`
                  : `Ch ${chapter.chapterId}`}
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

              {!isTouchDevice ? (
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
                    options={[
                      { value: 'fit-height', label: 'Fit to screen' },
                      { value: 'fit-width', label: 'Fit to width' },
                      { value: 'actual', label: 'Actual size' },
                    ]}
                  />

                  {orderedSeriesChapters.length ? (
                    <Button
                      type="button"
                      variant="soft"
                      className="h-12 w-full"
                      onClick={() => setShowChapterPanel(true)}
                    >
                      Chapters ({orderedSeriesChapters.length})
                    </Button>
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
                />
              </label>
            </div>

            {isTouchDevice ? (
              <details className="exp-details-panel mt-2 px-3 py-2 text-xs text-muted-foreground">
                <summary className="exp-details-summary">More settings</summary>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <SelectField
                    value={zoomPreset}
                    aria-label="Zoom preset"
                    onChange={(event) =>
                      setZoomPreset(event.target.value as ZoomPreset)
                    }
                    className="h-12"
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
                {orderedSeriesChapters.length ? (
                  <div className="mt-2">
                    <Button
                      type="button"
                      variant="soft"
                      className="h-10 w-full"
                      onClick={() => setShowChapterPanel(true)}
                    >
                      Chapters ({orderedSeriesChapters.length})
                    </Button>
                  </div>
                ) : null}
                <details className="reader-settings-advanced mt-2 text-xs text-muted-foreground">
                  <summary className="font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    Advanced tuning
                  </summary>
                  {advancedTuningInner}
                </details>
              </details>
            ) : (
              <details className="reader-settings-advanced mt-3 text-xs text-muted-foreground">
                <summary className="font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Advanced tuning
                </summary>
                {advancedTuningInner}
              </details>
            )}

            <div className="mt-3 flex items-center gap-2">
              <Button variant="soft" className="w-full" onClick={goNext}>
                Next page
              </Button>
              <Button variant="soft" className="w-full" onClick={goPrevious}>
                Previous page
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{hudPageLabel}</p>
            <div className="mt-2 flex items-center gap-2">
              <Button
                variant="ghost"
                className="w-full border border-border"
                onClick={() => goToChapter(nextChapterId)}
                disabled={!nextChapterId}
              >
                Next chapter
              </Button>
              <Button
                variant="ghost"
                className="w-full border border-border disabled:!bg-surface-soft disabled:!text-foreground/70 disabled:!opacity-100"
                onClick={() => goToChapter(previousChapterId)}
                disabled={!previousChapterId}
              >
                Previous chapter
              </Button>
            </div>
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
                  <div
                    role="region"
                    aria-label="Keyboard shortcuts"
                    className="reader-shortcut-sheet mt-2 text-xs"
                  >
                    <p>Nav: A/D or arrows, Space, [ ]</p>
                    <p>View: Q mode, 0 reset zoom, F fullscreen</p>
                    <p>UI: S sidebar, X focus, Z magnifier</p>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
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
          role="alert"
          className="reader-hud pointer-events-none absolute ui-bottom-safe-stack left-1/2 z-30 -translate-x-1/2 px-3 py-1 text-xs"
        >
          {boundaryNotice}
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
        tabIndex={-1}
        style={{ outline: 'none' }}
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
              chapterId={chapter.chapterId}
              pages={pages}
              zoomPreset={zoomPreset}
              resolveImageUrl={(page) => pageUrlMap.get(page.pageIndex)}
              onImageMeasure={rememberPageDimension}
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
              if (!gallerySwipeEnabled) {
                handleReaderTouchStart(event)
              }

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
            onPointerUp={gallerySwipeEnabled ? undefined : handleReaderTouchEnd}
            onPointerMove={
              gallerySwipeEnabled ? undefined : handleReaderTouchMove
            }
            onPointerCancel={
              gallerySwipeEnabled ? undefined : handleReaderTouchCancel
            }
            style={{
              cursor: zoomPreset === 'actual' ? 'grab' : 'default',
              overflow: zoomPreset === 'actual' ? 'auto' : 'hidden',
              touchAction: isTouchDevice ? 'pan-y' : 'auto',
              overscrollBehavior: isTouchDevice ? 'contain' : undefined,
            }}
          >
            {gallerySwipeEnabled ? (
              <div
                ref={nativePagerRef}
                className="reader-native-pager relative flex h-full snap-x snap-mandatory overflow-x-auto overflow-y-hidden"
                data-testid="reader-paging-container"
                onScroll={handleNativePagerScroll}
                style={{
                  WebkitOverflowScrolling: 'touch',
                  transition: 'none',
                  scrollbarWidth: 'none',
                }}
              >
                <div className="h-full w-full shrink-0 snap-start overflow-hidden">
                  <div
                    className={`flex h-full items-center justify-center gap-0 ${isSinglePageTouchView ? 'px-4' : ''}`}
                  >
                    {renderUnitsForPaging(leftRenderUnits, 'next')}
                  </div>
                </div>
                <div className="h-full w-full shrink-0 snap-start overflow-hidden">
                  <div
                    className={`flex h-full items-center justify-center gap-0 overflow-hidden ${isSinglePageTouchView ? 'px-4' : ''}`}
                  >
                    {renderUnitsForPaging(currentRenderUnits, 'current')}
                  </div>
                </div>
                <div className="h-full w-full shrink-0 snap-start overflow-hidden">
                  <div
                    className={`flex h-full items-center justify-center gap-0 ${isSinglePageTouchView ? 'px-4' : ''}`}
                  >
                    {renderUnitsForPaging(rightRenderUnits, 'prev')}
                  </div>
                </div>
              </div>
            ) : (
              <div
                className={`flex h-full items-center justify-center gap-0 overflow-hidden ${isSinglePageTouchView ? 'px-4' : ''}`}
                data-testid="reader-paging-container"
              >
                {renderUnitsForPaging(currentRenderUnits, 'current')}
              </div>
            )}

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

      {showChapterPanel && series && (
        <ChapterPanel
          chapters={series.chapters}
          currentChapterId={params.chapterId}
          onSelectChapter={(nextId) => {
            setShowChapterPanel(false)
            goToChapter(nextId)
          }}
          onClose={() => setShowChapterPanel(false)}
        />
      )}
    </div>
  )
}
