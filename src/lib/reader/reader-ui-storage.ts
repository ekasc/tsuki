import type {
  ChapterPageManifest,
  ReaderDirection,
  ReaderMode,
  ZoomPreset,
} from '#/lib/contracts'
import {
  buildTwoPageSteps,
  inferAutoSpreadFlags,
  type PairingPage,
  type PairingStep,
} from '#/lib/reader/pairing'

// ── Shared reader UI preferences ──

export interface ReaderUiPrefs {
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

export interface ReaderSeriesPreset {
  mode: ReaderMode
  zoomPreset: ZoomPreset
  readingDirection: ReaderDirection
  doublePageOffset: boolean
  magnifierEnabled: boolean
  focusMode: boolean
}

// ── localStorage helpers ──

export function readStorageWithLegacy(
  key: string,
  legacyKey: string,
): string | null {
  if (typeof window === 'undefined') return null

  const value = window.localStorage.getItem(key)
  if (value) return value

  const legacyValue = window.localStorage.getItem(legacyKey)
  if (!legacyValue) return null

  window.localStorage.setItem(key, legacyValue)
  return legacyValue
}

export function loadReaderUiPrefs(
  storageKey: string,
  legacyKey: string | undefined,
  defaults: ReaderUiPrefs,
): ReaderUiPrefs | null {
  if (typeof window === 'undefined') return null

  try {
    const raw = legacyKey
      ? readStorageWithLegacy(storageKey, legacyKey)
      : window.localStorage.getItem(storageKey)
    if (!raw) return null

    const parsed = JSON.parse(raw) as Partial<ReaderUiPrefs>
    if (!parsed) return null

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
          ? clamp(
              parsed.preloadAhead,
              defaults.preloadAhead,
              defaults.preloadAhead < 7 ? [1, 16] : [1, 24],
            )
          : defaults.preloadAhead,
      preloadBehind:
        typeof parsed.preloadBehind === 'number'
          ? clamp(
              parsed.preloadBehind,
              defaults.preloadBehind,
              defaults.preloadBehind < 3 ? [0, 8] : [0, 12],
            )
          : defaults.preloadBehind,
      prefetchConcurrency:
        typeof parsed.prefetchConcurrency === 'number'
          ? clamp(
              parsed.prefetchConcurrency,
              defaults.prefetchConcurrency,
              defaults.prefetchConcurrency < 3 ? [1, 4] : [1, 8],
            )
          : defaults.prefetchConcurrency,
      nextChapterPrefetchThreshold:
        typeof parsed.nextChapterPrefetchThreshold === 'number'
          ? clamp(
              parsed.nextChapterPrefetchThreshold,
              defaults.nextChapterPrefetchThreshold,
              defaults.nextChapterPrefetchThreshold < 7 ? [1, 12] : [1, 24],
            )
          : defaults.nextChapterPrefetchThreshold,
      nextChapterWarmPages:
        typeof parsed.nextChapterWarmPages === 'number'
          ? clamp(
              parsed.nextChapterWarmPages,
              defaults.nextChapterWarmPages,
              defaults.nextChapterWarmPages < 3 ? [1, 6] : [1, 16],
            )
          : defaults.nextChapterWarmPages,
      uiAutoHideMs:
        typeof parsed.uiAutoHideMs === 'number'
          ? clamp(parsed.uiAutoHideMs, 1400, [400, 5000])
          : 1400,
      magnifierSize:
        typeof parsed.magnifierSize === 'number'
          ? clamp(parsed.magnifierSize, 220, [120, 420])
          : 220,
      magnifierZoom:
        typeof parsed.magnifierZoom === 'number'
          ? clamp(parsed.magnifierZoom, 2.4, [2, 5])
          : 2.4,
    }
  } catch {
    return null
  }
}

export function saveReaderUiPrefs(storageKey: string, prefs: ReaderUiPrefs) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(storageKey, JSON.stringify(prefs))
}

export function loadReaderSeriesPreset(
  seriesId: string,
  seriesPresetsKey: string,
  legacySeriesPresetsKey: string,
): ReaderSeriesPreset | null {
  if (typeof window === 'undefined') return null

  try {
    const raw = readStorageWithLegacy(seriesPresetsKey, legacySeriesPresetsKey)
    if (!raw) return null

    const payload = JSON.parse(raw) as Record<
      string,
      Partial<ReaderSeriesPreset>
    >
    const preset = payload[seriesId]
    if (!preset) return null

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

export function saveReaderSeriesPreset(
  seriesId: string,
  preset: ReaderSeriesPreset,
  seriesPresetsKey: string,
  legacySeriesPresetsKey: string,
) {
  if (typeof window === 'undefined') return

  try {
    const raw = readStorageWithLegacy(seriesPresetsKey, legacySeriesPresetsKey)
    const payload = raw
      ? (JSON.parse(raw) as Record<string, ReaderSeriesPreset>)
      : {}

    payload[seriesId] = preset
    window.localStorage.setItem(seriesPresetsKey, JSON.stringify(payload))
  } catch {
    // Ignore localStorage persistence failures.
  }
}

// ── Step builders (pure algorithms, no storage dependency) ──

export function buildDoublePageStepsWithOffset(
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

export function expandStepsForPortraitSingle(
  steps: PairingStep[],
  pages: ChapterPageManifest[],
  readingDirection: ReaderDirection,
): PairingStep[] {
  if (steps.length === 0) return []

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

// ── Generic helpers ──

function clamp(
  value: number,
  fallback: number,
  range: [number, number],
): number {
  const [min, max] = range
  const clamped = Math.floor(value)
  if (Number.isNaN(clamped)) return fallback
  return Math.max(min, Math.min(max, clamped))
}
