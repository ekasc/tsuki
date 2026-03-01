import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'

const createAnyFileRoute = createFileRoute as any
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
import { flushSync } from 'react-dom'

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
import { setBoundedMapEntry } from '#/lib/bounded-cache'
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
import { useTouchDevice, useTouchPortrait } from '#/hooks/use-touch-portrait'

export const Route = createAnyFileRoute('/weebcentral/$chapterId')({
  headers: () => ({
    'X-Robots-Tag': 'noindex, follow',
  }),
  head: ({ params }: { params: { chapterId: string } }) => ({
    meta: [
      { title: 'Reader | Tsuki Reader' },
      {
        name: 'description',
        content: 'Read manga chapters in Tsuki with a clean, distraction-free viewer.',
      },
      { name: 'robots', content: 'noindex,follow' },
    ],
    links: [
      {
        rel: 'canonical',
        href: canonicalUrl(`/weebcentral/${encodeURIComponent(params.chapterId)}`),
      },
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
  component: WeebcentralReaderPage,
})

const REMOTE_PROGRESS_STORAGE_KEY = 'tsuki-remote-progress.v1'
const LEGACY_REMOTE_PROGRESS_STORAGE_KEY = 'suki-remote-progress.v1'
const prefetchedRemoteChapters = new Map<string, WeebcentralChapterDTO>()
const prefetchedRemoteSeries = new Map<string, WeebcentralSeriesDTO>()
const inFlightRemoteChapterPrefetches = new Set<string>()
const PREFETCHED_REMOTE_CHAPTER_LIMIT = 64
const PREFETCHED_REMOTE_SERIES_LIMIT = 64
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
const REMOTE_READER_SERIES_PRESETS_KEY = 'tsuki-remote-reader-series-presets.v1'
const LEGACY_REMOTE_READER_SERIES_PRESETS_KEY =
  'suki-remote-reader-series-presets.v1'
const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect

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

const DEFAULT_REMOTE_READER_UI_PREFS: ReaderUiPrefs = {
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
      REMOTE_READER_SERIES_PRESETS_KEY,
      LEGACY_REMOTE_READER_SERIES_PRESETS_KEY,
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
      REMOTE_READER_SERIES_PRESETS_KEY,
      LEGACY_REMOTE_READER_SERIES_PRESETS_KEY,
    )
    const payload = raw
      ? (JSON.parse(raw) as Record<string, ReaderSeriesPreset>)
      : {}

    payload[seriesId] = preset
    window.localStorage.setItem(
      REMOTE_READER_SERIES_PRESETS_KEY,
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
          ? Math.max(1, Math.min(16, Math.floor(parsed.preloadAhead)))
          : 6,
      preloadBehind:
        typeof parsed.preloadBehind === 'number'
          ? Math.max(0, Math.min(8, Math.floor(parsed.preloadBehind)))
          : 2,
      prefetchConcurrency:
        typeof parsed.prefetchConcurrency === 'number'
          ? Math.max(1, Math.min(4, Math.floor(parsed.prefetchConcurrency)))
          : 2,
      nextChapterPrefetchThreshold:
        typeof parsed.nextChapterPrefetchThreshold === 'number'
          ? Math.max(
              1,
              Math.min(12, Math.floor(parsed.nextChapterPrefetchThreshold)),
            )
          : 6,
      nextChapterWarmPages:
        typeof parsed.nextChapterWarmPages === 'number'
          ? Math.max(1, Math.min(6, Math.floor(parsed.nextChapterWarmPages)))
          : 2,
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

function getDisplayUnitsForStep(
  step: PairingStep | null,
  pageByIndex: ReadonlyMap<number, ChapterPageManifest>,
  isTouchPortrait: boolean,
) {
  if (!step) {
    return [] as PairingStep['units']
  }

  const normalizedUnits =
    step.units.length > 2 ? step.units.slice(0, 2) : step.units
  const renderedUnits =
    normalizedUnits.length === 2
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
    const raw = readStorageWithLegacy(
      REMOTE_PROGRESS_STORAGE_KEY,
      LEGACY_REMOTE_PROGRESS_STORAGE_KEY,
    )
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
    const raw = readStorageWithLegacy(
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

function WeebcentralReaderPage() {
  const params = Route.useParams()
  const search = Route.useSearch() as {
    seriesId?: string
    seriesTitle?: string
  }
  const navigate = useNavigate()
  const loaderChapter = Route.useLoaderData() as WeebcentralChapterDTO | undefined
  const queryClient = useQueryClient()

  const [series, setSeries] = useState<WeebcentralSeriesDTO | null>(null)
  const [chapter, setChapter] = useState<WeebcentralChapterDTO | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const initialUiPrefs = useMemo(
    () =>
      loadReaderUiPrefs(
        REMOTE_READER_UI_PREFS_KEY,
        LEGACY_REMOTE_READER_UI_PREFS_KEY,
      ) ?? DEFAULT_REMOTE_READER_UI_PREFS,
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
  const [settingsTab, setSettingsTab] = useState<'basic' | 'advanced'>('basic')
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
  const [chapterFilter, setChapterFilter] = useState('')
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
  const [currentSingleStepIndex, setCurrentSingleStepIndex] = useState(0)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [inlineFullscreen, setInlineFullscreen] = useState(false)
  const [showPageHud, setShowPageHud] = useState(false)
  const [pendingBoundaryDirection, setPendingBoundaryDirection] = useState<
    'next' | 'prev' | null
  >(null)
  const [boundaryNotice, setBoundaryNotice] = useState<string | null>(null)
  const [pageMotion, setPageMotion] = useState<'next' | 'prev' | null>(null)
  const [nativePagerVisualLock, setNativePagerVisualLock] = useState(false)

  const viewportRef = useRef<HTMLDivElement>(null)
  const readerStageRef = useRef<HTMLElement>(null)
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
      ? (activeDoubleSteps[currentStepIndex]?.anchorPageIndex ??
        currentPageIndex)
      : mode === 'single'
        ? (singlePageSteps[currentSingleStepIndex]?.anchorPageIndex ??
          currentPageIndex)
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

  const filteredSeriesChapters = useMemo(() => {
    const query = chapterFilter.trim().toLowerCase()
    if (!query) {
      return orderedSeriesChapters
    }

    return orderedSeriesChapters.filter((entry) => {
      const chapterNumber = String(entry.number)
      const title = entry.title.toLowerCase()
      return chapterNumber.includes(query) || title.includes(query)
    })
  }, [chapterFilter, orderedSeriesChapters])

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

  const nextRenderUnits = useMemo(() => {
    if (mode === 'single') {
      if (currentSingleStepIndex >= maxSingleStepIndex) {
        return [] as typeof displayUnits
      }

      return singlePageSteps[currentSingleStepIndex + 1]?.units ?? []
    }

    return getDisplayUnitsForStep(
      activeDoubleSteps[currentStepIndex + 1] ?? null,
      pageByIndex,
      isTouchPortrait,
    )
  }, [
    activeDoubleSteps,
    currentSingleStepIndex,
    currentStepIndex,
    isTouchPortrait,
    maxSingleStepIndex,
    mode,
    pageByIndex,
    singlePageSteps,
  ])

  const previousRenderUnits = useMemo(() => {
    if (mode === 'single') {
      if (currentSingleStepIndex <= 0) {
        return [] as typeof displayUnits
      }

      return singlePageSteps[currentSingleStepIndex - 1]?.units ?? []
    }

    return getDisplayUnitsForStep(
      activeDoubleSteps[currentStepIndex - 1] ?? null,
      pageByIndex,
      isTouchPortrait,
    )
  }, [
    activeDoubleSteps,
    currentSingleStepIndex,
    currentStepIndex,
    isTouchPortrait,
    mode,
    pageByIndex,
    singlePageSteps,
  ])
  const leftRenderUnits =
    nativePagerVisualLock
      ? currentRenderUnits
      : nextRenderUnits.length > 0
        ? nextRenderUnits
        : currentRenderUnits
  const rightRenderUnits =
    nativePagerVisualLock
      ? currentRenderUnits
      : previousRenderUnits.length > 0
        ? previousRenderUnits
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

      setPendingBoundaryDirection(null)
      setBoundaryNotice(null)

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

  useEffect(() => {
    if (!loaderChapter) {
      return
    }

    setBoundedMapEntry(
      prefetchedRemoteChapters,
      params.chapterId,
      loaderChapter,
      PREFETCHED_REMOTE_CHAPTER_LIMIT,
    )
  }, [loaderChapter, params.chapterId])

  const loadRemoteChapter = useCallback(async () => {
    const chapterOptions = weebcentralChapterQueryOptions(params.chapterId)
    const prefetchedChapter = prefetchedRemoteChapters.get(params.chapterId)
    const cachedChapter =
      prefetchedChapter ??
      queryClient.getQueryData<WeebcentralChapterDTO>(chapterOptions.queryKey)

    if (prefetchedChapter) {
      prefetchedRemoteChapters.delete(params.chapterId)
    }

    setIsLoading(!cachedChapter)
    setError(null)
    setPageDimensions({})
    setCurrentPageIndex(0)
    setCurrentStepIndex(0)
    setCurrentSingleStepIndex(0)

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
      setCurrentSingleStepIndex(
        findStepIndexByPageIndex(
          buildSinglePageSteps(chapterPages, false),
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
        cachedChapter ?? (await queryClient.fetchQuery(chapterOptions))
      if (!cachedChapter) {
        applyChapterState(chapterPayload)
      }

      const seriesInput =
        search.seriesId?.trim() || chapterPayload.seriesId || params.chapterId
      const seriesOptions = weebcentralSeriesQueryOptions(seriesInput)
      const cachedSeries =
        prefetchedRemoteSeries.get(seriesInput) ??
        prefetchedRemoteSeries.get(chapterPayload.seriesId) ??
        queryClient.getQueryData<WeebcentralSeriesDTO>(seriesOptions.queryKey)
      if (cachedSeries) {
        setBoundedMapEntry(
          prefetchedRemoteSeries,
          seriesInput,
          cachedSeries,
          PREFETCHED_REMOTE_SERIES_LIMIT,
        )
        setBoundedMapEntry(
          prefetchedRemoteSeries,
          cachedSeries.id,
          cachedSeries,
          PREFETCHED_REMOTE_SERIES_LIMIT,
        )
        setSeries(cachedSeries)
      }

      void (async () => {
        try {
          const seriesPayload =
            cachedSeries ??
            (await queryClient.fetchQuery(seriesOptions))
          setBoundedMapEntry(
            prefetchedRemoteSeries,
            seriesInput,
            seriesPayload,
            PREFETCHED_REMOTE_SERIES_LIMIT,
          )
          setBoundedMapEntry(
            prefetchedRemoteSeries,
            seriesPayload.id,
            seriesPayload,
            PREFETCHED_REMOTE_SERIES_LIMIT,
          )
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

  useEffect(() => {
    setChapterFilter('')
  }, [params.chapterId])

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
    if (!chapter) {
      return
    }

    const timeout = window.setTimeout(() => {
      persistRemoteProgressNow(currentTargetPageIndex)
    }, 220)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [
    currentTargetPageIndex,
    chapter,
    persistRemoteProgressNow,
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

    const remainingPages = maxPageIndex - currentTargetPageIndex
    const shouldPrefetchNextChapter =
      remainingPages <= nextChapterPrefetchThreshold
    if (!shouldPrefetchNextChapter) {
      return
    }

    if (
      prefetchedRemoteChapters.has(nextChapterId) ||
      inFlightRemoteChapterPrefetches.has(nextChapterId)
    ) {
      return
    }

    const controller = new AbortController()
    inFlightRemoteChapterPrefetches.add(nextChapterId)

    void (async () => {
      try {
        const chapterOptions = weebcentralChapterQueryOptions(nextChapterId, {
          prefetch: true,
        })
        const payload =
          queryClient.getQueryData<WeebcentralChapterDTO>(
            chapterOptions.queryKey,
          ) ?? (await queryClient.fetchQuery(chapterOptions))

        setBoundedMapEntry(
          prefetchedRemoteChapters,
          nextChapterId,
          payload,
          PREFETCHED_REMOTE_CHAPTER_LIMIT,
        )

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
      } finally {
        inFlightRemoteChapterPrefetches.delete(nextChapterId)
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

      if (pageMotionTimeoutRef.current !== null) {
        window.clearTimeout(pageMotionTimeoutRef.current)
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
          goToChapter(nextChapterId)
        } else {
          armBoundaryNotice('next')
        }
        return
      }

      const next = clamp(currentStepIndex + 1, 0, maxStepIndex)
      triggerPageMotion('next')
      setCurrentStepIndex(next)
      setCurrentPageIndex(
        activeDoubleSteps[next]?.anchorPageIndex ?? currentPageIndex,
      )
      setPendingBoundaryDirection(null)
      setBoundaryNotice(null)
      return
    }

    if (mode === 'single') {
      if (currentSingleStepIndex >= maxSingleStepIndex) {
        if (pendingBoundaryDirection === 'next' && nextChapterId) {
          goToChapter(nextChapterId)
        } else {
          armBoundaryNotice('next')
        }
        return
      }

      const nextSingle = clamp(
        currentSingleStepIndex + 1,
        0,
        maxSingleStepIndex,
      )
      triggerPageMotion('next')
      setCurrentSingleStepIndex(nextSingle)
      setCurrentPageIndex(
        singlePageSteps[nextSingle]?.anchorPageIndex ?? currentPageIndex,
      )
      setPendingBoundaryDirection(null)
      setBoundaryNotice(null)
      return
    }

    if (currentPageIndex >= maxPageIndex) {
      if (pendingBoundaryDirection === 'next' && nextChapterId) {
        goToChapter(nextChapterId)
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
          goToChapter(previousChapterId)
        } else {
          armBoundaryNotice('prev')
        }
        return
      }

      const previous = clamp(currentStepIndex - 1, 0, maxStepIndex)
      triggerPageMotion('prev')
      setCurrentStepIndex(previous)
      setCurrentPageIndex(
        activeDoubleSteps[previous]?.anchorPageIndex ?? currentPageIndex,
      )
      setPendingBoundaryDirection(null)
      setBoundaryNotice(null)
      return
    }

    if (mode === 'single') {
      if (currentSingleStepIndex <= 0) {
        if (pendingBoundaryDirection === 'prev' && previousChapterId) {
          goToChapter(previousChapterId)
        } else {
          armBoundaryNotice('prev')
        }
        return
      }

      const previousSingle = clamp(
        currentSingleStepIndex - 1,
        0,
        maxSingleStepIndex,
      )
      triggerPageMotion('prev')
      setCurrentSingleStepIndex(previousSingle)
      setCurrentPageIndex(
        singlePageSteps[previousSingle]?.anchorPageIndex ?? currentPageIndex,
      )
      setPendingBoundaryDirection(null)
      setBoundaryNotice(null)
      return
    }

    if (currentPageIndex <= 0) {
      if (pendingBoundaryDirection === 'prev' && previousChapterId) {
        goToChapter(previousChapterId)
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
    triggerPageMotion,
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
        if (nextRenderUnits.length > 0) {
          suppressTapRef.current = true
          navigatingRef.current = true
          armNativePagerVisualLock()
          flushSync(() => {
            goNext()
          })
          recenterNativePager({ attempts: 1 })
          requestAnimationFrame(() => {
            navigatingRef.current = false
          })
        }
        return
      }

      if (index >= 2) {
        if (previousRenderUnits.length > 0) {
          suppressTapRef.current = true
          navigatingRef.current = true
          armNativePagerVisualLock()
          flushSync(() => {
            goPrevious()
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
      const threshold = Math.max(48, width * 0.16)
      const commit =
        Math.abs(swipeOffsetRef.current) > threshold
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
    [gallerySwipeEnabled, goNext, goPrevious, isTouchDevice, mode],
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
    currentPageIndex,
    currentSingleStepIndex,
    currentStepIndex,
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
    goToChapter,
    magnifierEnabled,
    nextChapterId,
    previousChapterId,
    revealReaderUi,
    toggleFullscreen,
  ])

  const remoteSeriesTitle = series?.title ?? search.seriesTitle ?? 'Online series'
  const remoteSeriesIdForLink =
    series?.id ?? search.seriesId ?? chapter?.seriesId ?? params.chapterId
  const activeChapterMetadata =
    series?.chapters.find((entry) => entry.id === params.chapterId) ?? null

  if (isLoading) {
    return (
      <div className="border-2 border-border bg-surface p-6 text-muted-foreground">
        Opening chapter…
      </div>
    )
  }

  if (error || !chapter) {
    return (
      <div className="border-2 border-destructive/30 bg-destructive/10 p-6 text-destructive">
        We could not open this chapter. Please go back and try another one.
      </div>
    )
  }

  return (
    <div
      className={
        fullscreenActive
          ? 'fixed inset-0 z-[120] h-[100dvh] overflow-hidden bg-black'
          : isTouchDevice
            ? `relative min-h-[100dvh] overflow-x-hidden overflow-y-auto bg-black ${focusMode ? 'reader-focus-mode' : ''} reader-touch-root`
            : `relative h-[100dvh] overflow-hidden bg-black ${focusMode ? 'reader-focus-mode' : ''}`
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
          className={`reader-shell-toggle absolute ui-left-safe-offset ui-top-safe-offset z-50 size-12 transition-transform duration-200 md:size-10 ${showReaderChrome || sidebarOpen ? 'opacity-100' : 'pointer-events-none opacity-0'} ${isTouchDevice ? 'hidden' : ''} ${sidebarOpen ? 'md:left-[calc(min(88vw,360px)+12px)]' : ''}`}
          onClick={() => setSidebarOpen((current) => !current)}
          type="button"
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
              ? 'reader-shell-panel animate-enter relative z-30 w-full overflow-visible p-3'
              : `reader-shell-panel animate-enter absolute inset-y-0 left-0 z-40 w-[min(88vw,360px)] overflow-y-auto p-3 transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`
          }
          style={{
            animationDelay: '20ms',
            paddingTop: isTouchDevice
              ? 'max(0.75rem, calc(var(--safe-top) + 0.5rem))'
              : undefined,
          }}
        >
          {isTouchDevice ? (
            <div className="mb-2 flex items-center justify-between border border-border bg-surface-soft px-2 py-1.5">
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

          <div
            className={isTouchDevice && mobileSettingsMinimized ? 'hidden' : ''}
          >
            <div className="space-y-2 text-xs text-muted-foreground">
              <Link
                to="/"
                className="inline-flex border border-border bg-surface-soft px-2 py-1 hover:bg-surface"
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
              <p className="text-[11px]">
                Tip: click left/right side of the page to move.
              </p>
            </div>

            <div className="mt-3 flex gap-2">
              <Button
                type="button"
                variant={settingsTab === 'basic' ? 'default' : 'soft'}
                className="h-8 w-full"
                onClick={() => setSettingsTab('basic')}
              >
                Reading
              </Button>
              <Button
                type="button"
                variant={settingsTab === 'advanced' ? 'default' : 'soft'}
                className="h-8 w-full"
                onClick={() => setSettingsTab('advanced')}
              >
                More settings
              </Button>
            </div>

            {settingsTab === 'basic' ? (
              <div
                className={
                  isTouchDevice
                    ? 'mt-3 grid grid-cols-2 gap-2'
                    : 'mt-3 grid gap-2'
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
                {mode === 'double' && isTouchPortrait ? (
                  <p className="col-span-2 px-1 text-xs text-muted-foreground">
                    Portrait on touch screens uses one page at a time.
                  </p>
                ) : null}

                <Button
                  type="button"
                  variant={doublePageOffset ? 'default' : 'soft'}
                  className="h-9 justify-between px-3"
                  onClick={() => setDoublePageOffset((value) => !value)}
                >
                  <span>Offset</span>
                  <span>{doublePageOffset ? 'On' : 'Off'}</span>
                </Button>

                {!isTouchDevice ? (
                  <>
                    <Button
                      type="button"
                      variant={magnifierEnabled ? 'default' : 'soft'}
                      className="h-9 justify-between px-3"
                      onClick={() => setMagnifierEnabled((value) => !value)}
                    >
                      <span>Magnifier</span>
                      <span>{magnifierEnabled ? 'On' : 'Off'}</span>
                    </Button>

                    <Button
                      type="button"
                      variant={focusMode ? 'default' : 'soft'}
                      className="h-9 justify-between px-3"
                      onClick={() => setFocusMode((value) => !value)}
                    >
                      <span>Distraction-free mode</span>
                      <span>{focusMode ? 'On' : 'Off'}</span>
                    </Button>
                  </>
                ) : null}

                <SelectField
                  value={zoomPreset}
                  onChange={(event) =>
                    setZoomPreset(event.target.value as ZoomPreset)
                  }
                  className="h-9"
                  options={[
                    { value: 'fit-height', label: 'Fit to screen' },
                    { value: 'fit-width', label: 'Fit to width' },
                    { value: 'actual', label: 'Actual size' },
                  ]}
                />

                {orderedSeriesChapters.length ? (
                  <>
                    <Input
                      value={chapterFilter}
                      onChange={(event) => setChapterFilter(event.target.value)}
                      className="h-9 min-w-0"
                      placeholder="Type chapter number..."
                    />
                    {filteredSeriesChapters.length > 0 ? (
                      <SelectField
                        value={chapter.chapterId}
                        onChange={(event) => {
                          const nextId = event.target.value
                          if (nextId === chapter.chapterId) {
                            return
                          }
                          goToChapter(nextId)
                        }}
                        className="h-9 min-w-0"
                        options={filteredSeriesChapters.map((entry) => ({
                          value: entry.id,
                          label: `Chapter ${entry.number}`,
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
                  className={`text-xs text-muted-foreground ${isTouchDevice ? 'col-span-2' : ''}`}
                >
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
                    max={16}
                    value={preloadAhead}
                    onChange={(event) =>
                      setPreloadAhead(
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
                  Preload behind pages
                  <Input
                    type="number"
                    min={0}
                    max={8}
                    value={preloadBehind}
                    onChange={(event) =>
                      setPreloadBehind(
                        clampNumber(
                          Number.parseInt(event.target.value, 10),
                          0,
                          8,
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
                    max={4}
                    value={prefetchConcurrency}
                    onChange={(event) =>
                      setPrefetchConcurrency(
                        clampNumber(
                          Number.parseInt(event.target.value, 10),
                          1,
                          4,
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
                    max={12}
                    value={nextChapterPrefetchThreshold}
                    onChange={(event) =>
                      setNextChapterPrefetchThreshold(
                        clampNumber(
                          Number.parseInt(event.target.value, 10),
                          1,
                          12,
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
                    max={6}
                    value={nextChapterWarmPages}
                    onChange={(event) =>
                      setNextChapterWarmPages(
                        clampNumber(
                          Number.parseInt(event.target.value, 10),
                          1,
                          6,
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
                className="w-full border border-border"
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
                  className="mt-2 h-8 border border-border text-xs"
                  onClick={() => setShowShortcutHelp((value) => !value)}
                >
                  {showShortcutHelp
                    ? 'Hide keyboard shortcuts'
                    : 'Show keyboard shortcuts'}
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
        </aside>
      ) : null}

      {!fullscreenActive && !focusMode && showReaderChrome && !isTouchDevice ? (
        <div className="reader-quick-strip absolute right-3 top-3 z-30 hidden flex-wrap gap-2 md:flex">
          <Button
            type="button"
            variant="soft"
            className="h-9 px-3 text-xs"
            onClick={() => setSidebarOpen((value) => !value)}
          >
            Settings
          </Button>
          <Button
            type="button"
            variant="soft"
            className="h-9 px-3 text-xs"
            onClick={() => {
              void toggleFullscreen()
            }}
          >
            Fullscreen
          </Button>
        </div>
      ) : null}

      {!fullscreenActive &&
      (showReaderChrome || sidebarOpen) &&
      !isTouchDevice ? (
        <div className="reader-chapter-jump absolute bottom-4 right-3 z-30 hidden items-center gap-2 md:flex">
          <Button
            type="button"
            variant="soft"
            className="h-11 px-3 text-xs"
            onClick={() => goToChapter(nextChapterId)}
            disabled={!nextChapterId}
          >
            Next chapter
          </Button>
          <Button
            type="button"
            variant="soft"
            className="h-11 px-3 text-xs"
            onClick={() => goToChapter(previousChapterId)}
            disabled={!previousChapterId}
          >
            Prev chapter
          </Button>
        </div>
      ) : null}

      {!fullscreenActive && !focusMode && showReaderChrome && !isTouchDevice ? (
        <div className="reader-key-hints absolute bottom-4 left-1/2 z-20 -translate-x-1/2 text-xs">
          Tip: click/tap left or right side to move pages.
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
        <div className="reader-hud pointer-events-none absolute ui-bottom-safe-stack left-1/2 z-30 -translate-x-1/2 px-3 py-1 text-xs">
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
              isFullscreen={fullscreenActive}
              resolveImageUrl={(page) => pageUrlMap.get(page.pageIndex)}
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
            className={`relative ${!fullscreenActive && isTouchDevice ? 'h-[100dvh]' : 'h-full'} bg-black ${focusMode ? 'reader-focus-mode' : ''}`}
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
                    className={`flex h-full items-center justify-center gap-0 overflow-hidden ${isSinglePageTouchView ? 'px-4' : ''} ${!gallerySwipeEnabled && pageMotion ? `reader-page-motion-${pageMotion}` : ''}`}
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
                className={`flex h-full items-center justify-center gap-0 overflow-hidden ${isSinglePageTouchView ? 'px-4' : ''} ${!gallerySwipeEnabled && pageMotion ? `reader-page-motion-${pageMotion}` : ''}`}
                data-testid="reader-paging-container"
              >
                {renderUnitsForPaging(currentRenderUnits, 'current')}
              </div>
            )}

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
            {!fullscreenActive && showReaderChrome && !isTouchDevice ? (
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
