import type {
  ChapterPayload,
  ChapterPageManifest,
  LibrarySeries,
  SeriesDetail,
} from '#/lib/contracts'
import { inferAutoSpreadFlags } from '#/lib/reader/pairing'

export const FIXTURE_SERIES_ID = 'Li8ezNK4gAuHoCPzk3yuA'

export const FIXTURE_CHAPTER_IDS = {
  first: 'SQW_DloYbKHRLibsR0-wV',
  second: '3uGXSAKdwDP7pcym0iZ4x',
} as const

interface FixturePageSpec {
  width: number
  height: number
  label: string
  background: string
  splitSpread?: boolean
}

interface FixtureChapterSpec {
  id: string
  title: string
  chapterNumber: number
  pages: FixturePageSpec[]
}

const FIXTURE_CHAPTERS: FixtureChapterSpec[] = [
  {
    id: FIXTURE_CHAPTER_IDS.first,
    title: 'Chapter 1 - Welcome Grid',
    chapterNumber: 1,
    pages: [
      { width: 1200, height: 1800, label: 'P1', background: '#0A1C2B' },
      { width: 1200, height: 1800, label: 'P2', background: '#17324A' },
      { width: 2600, height: 1700, label: 'Spread', background: '#3A1B4D' },
      { width: 1200, height: 1800, label: 'P4', background: '#175744' },
      { width: 1200, height: 1800, label: 'P5', background: '#5B3416' },
    ],
  },
  {
    id: FIXTURE_CHAPTER_IDS.second,
    title: 'Chapter 2 - Split Candidate',
    chapterNumber: 2,
    pages: [
      { width: 1200, height: 1800, label: 'P1', background: '#211538' },
      {
        width: 2500,
        height: 1700,
        label: 'Split Ready',
        background: '#5F0B21',
        splitSpread: true,
      },
      { width: 1200, height: 1800, label: 'P3', background: '#0A3B5F' },
      { width: 1200, height: 1800, label: 'P4', background: '#2D4C1A' },
    ],
  },
]

function buildChapterPages(chapter: FixtureChapterSpec): ChapterPageManifest[] {
  const spreadFlags = inferAutoSpreadFlags(
    chapter.pages.map((page) => ({
      width: page.width,
      height: page.height,
    })),
  )

  return chapter.pages.map((page, pageIndex) => ({
    id: `${chapter.id}-page-${pageIndex + 1}`,
    chapterId: chapter.id,
    pageIndex,
    width: page.width,
    height: page.height,
    aspect: page.width / page.height,
    autoIsSpread: Boolean(spreadFlags[pageIndex]),
    splitSpread: page.splitSpread ?? null,
  }))
}

function buildFixtureChapterPayload(chapter: FixtureChapterSpec): ChapterPayload {
  const pages = buildChapterPages(chapter)

  return {
    manifest: {
      chapterId: chapter.id,
      seriesId: FIXTURE_SERIES_ID,
      title: chapter.title,
      chapterNumber: chapter.chapterNumber,
      pageCount: pages.length,
      pages,
    },
    progress: null,
  }
}

export const FIXTURE_LIBRARY_SERIES: LibrarySeries[] = [
  {
    id: FIXTURE_SERIES_ID,
    title: 'Suki Demo Anthology',
    description:
      'Built-in legal demo pages to validate reader modes, spread detection, and progress sync.',
    source: 'demo',
    chapterCount: FIXTURE_CHAPTERS.length,
    coverChapterId: FIXTURE_CHAPTERS[0]?.id ?? null,
    coverPageIndex: 0,
  },
]

export const FIXTURE_SERIES_DETAIL: SeriesDetail = {
  id: FIXTURE_SERIES_ID,
  title: 'Suki Demo Anthology',
  description:
    'Built-in legal demo pages to validate reader modes, spread detection, and progress sync.',
  source: 'demo',
  chapters: FIXTURE_CHAPTERS.map((chapter) => ({
    id: chapter.id,
    title: chapter.title,
    chapterNumber: chapter.chapterNumber,
    sortIndex: chapter.chapterNumber,
    pageCount: chapter.pages.length,
  })),
}

export const FIXTURE_CHAPTER_PAYLOAD_BY_ID: Record<string, ChapterPayload> =
  Object.fromEntries(
    FIXTURE_CHAPTERS.map((chapter) => [chapter.id, buildFixtureChapterPayload(chapter)]),
  )

export interface FixtureImageTemplate {
  width: number
  height: number
  label: string
  background: string
}

export function getFixtureImageTemplate(
  chapterId: string,
  pageIndex: number,
): FixtureImageTemplate | null {
  const chapter = FIXTURE_CHAPTERS.find((entry) => entry.id === chapterId)
  if (!chapter) {
    return null
  }

  const page = chapter.pages[pageIndex]
  if (!page) {
    return null
  }

  return {
    width: page.width,
    height: page.height,
    label: page.label,
    background: page.background,
  }
}

export function cloneFixtureChapterPayload(
  chapterId: string,
): ChapterPayload | null {
  const payload = FIXTURE_CHAPTER_PAYLOAD_BY_ID[chapterId]
  if (!payload) {
    return null
  }

  return {
    manifest: {
      ...payload.manifest,
      pages: payload.manifest.pages.map((page) => ({ ...page })),
    },
    progress: payload.progress ? { ...payload.progress } : null,
  }
}

export function cloneFixtureSeriesDetail(seriesId: string): SeriesDetail | null {
  if (seriesId !== FIXTURE_SERIES_ID) {
    return null
  }

  return {
    ...FIXTURE_SERIES_DETAIL,
    chapters: FIXTURE_SERIES_DETAIL.chapters.map((chapter) => ({ ...chapter })),
  }
}

export function cloneFixtureSeriesList(): LibrarySeries[] {
  return FIXTURE_LIBRARY_SERIES.map((entry) => ({ ...entry }))
}
