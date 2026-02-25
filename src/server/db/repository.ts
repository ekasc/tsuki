import { and, asc, desc, eq, lt } from 'drizzle-orm'
import { nanoid } from 'nanoid'

import type {
  ChapterManifest,
  ChapterPayload,
  ChapterProgress,
  LibrarySeries,
  SeriesDetail,
  ZoomPreset,
} from '#/lib/contracts'

import { getDatabase } from './client'
import { chapters, pages, readingProgress, series } from './schema'

interface CreateSeriesInput {
  title: string
  description: string | null
  source: 'demo' | 'local-upload' | 'custom-stub'
}

interface CreateChapterInput {
  seriesId: string
  title: string
  chapterNumber: number
  sortIndex: number
}

export interface CreatePageInput {
  chapterId: string
  pageIndex: number
  imagePath: string
  thumbnailPath: string
  width: number
  height: number
  aspect: number
  autoIsSpread: boolean
  userOverrideSpread: boolean | null
  splitSpread: boolean | null
}

export function createSeries(input: CreateSeriesInput): string {
  const db = getDatabase()
  const now = Date.now()
  const id = nanoid()

  db.insert(series)
    .values({
      id,
      title: input.title,
      description: input.description,
      source: input.source,
      coverPageId: null,
      createdAt: now,
      updatedAt: now,
    })
    .run()

  return id
}

export function createChapter(input: CreateChapterInput): string {
  const db = getDatabase()
  const now = Date.now()
  const id = nanoid()

  db.insert(chapters)
    .values({
      id,
      seriesId: input.seriesId,
      title: input.title,
      chapterNumber: input.chapterNumber,
      sortIndex: input.sortIndex,
      pageCount: 0,
      createdAt: now,
      updatedAt: now,
    })
    .run()

  return id
}

export function insertPages(inputPages: CreatePageInput[]) {
  if (inputPages.length === 0) {
    return
  }

  const db = getDatabase()
  const now = Date.now()

  db.insert(pages)
    .values(
      inputPages.map((page) => ({
        id: nanoid(),
        chapterId: page.chapterId,
        pageIndex: page.pageIndex,
        imagePath: page.imagePath,
        thumbnailPath: page.thumbnailPath,
        width: page.width,
        height: page.height,
        aspect: page.aspect,
        autoIsSpread: page.autoIsSpread,
        userOverrideSpread: page.userOverrideSpread,
        splitSpread: page.splitSpread,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .run()

  const chapterId = inputPages[0]!.chapterId
  const pageCount = db
    .select({ count: pages.id })
    .from(pages)
    .where(eq(pages.chapterId, chapterId))
    .all().length

  db.update(chapters)
    .set({
      pageCount,
      updatedAt: now,
    })
    .where(eq(chapters.id, chapterId))
    .run()
}

export function updateSeriesCoverByChapter(chapterId: string) {
  const db = getDatabase()
  const firstPage = db
    .select({ id: pages.id })
    .from(pages)
    .where(eq(pages.chapterId, chapterId))
    .orderBy(asc(pages.pageIndex))
    .get()

  if (!firstPage) {
    return
  }

  const chapter = db
    .select({ seriesId: chapters.seriesId })
    .from(chapters)
    .where(eq(chapters.id, chapterId))
    .get()

  if (!chapter) {
    return
  }

  db.update(series)
    .set({ coverPageId: firstPage.id, updatedAt: Date.now() })
    .where(eq(series.id, chapter.seriesId))
    .run()
}

export function listLibrarySeries(): LibrarySeries[] {
  const db = getDatabase()

  const seriesRows = db
    .select()
    .from(series)
    .orderBy(desc(series.updatedAt))
    .all()

  return seriesRows.map((seriesRow) => {
    const chapterRows = db
      .select()
      .from(chapters)
      .where(eq(chapters.seriesId, seriesRow.id))
      .orderBy(asc(chapters.sortIndex))
      .all()

    const firstChapter = chapterRows[0] ?? null
    const firstPage = firstChapter
      ? db
          .select({ pageIndex: pages.pageIndex })
          .from(pages)
          .where(eq(pages.chapterId, firstChapter.id))
          .orderBy(asc(pages.pageIndex))
          .get()
      : null

    return {
      id: seriesRow.id,
      title: seriesRow.title,
      description: seriesRow.description,
      source: seriesRow.source as LibrarySeries['source'],
      chapterCount: chapterRows.length,
      coverChapterId: firstChapter?.id ?? null,
      coverPageIndex: firstPage?.pageIndex ?? null,
    }
  })
}

export function getSeriesDetail(seriesId: string): SeriesDetail | null {
  const db = getDatabase()

  const seriesRow = db
    .select()
    .from(series)
    .where(eq(series.id, seriesId))
    .get()

  if (!seriesRow) {
    return null
  }

  const chapterRows = db
    .select()
    .from(chapters)
    .where(eq(chapters.seriesId, seriesId))
    .orderBy(asc(chapters.sortIndex))
    .all()

  return {
    id: seriesRow.id,
    title: seriesRow.title,
    description: seriesRow.description,
    source: seriesRow.source as SeriesDetail['source'],
    chapters: chapterRows.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      chapterNumber: chapter.chapterNumber,
      sortIndex: chapter.sortIndex,
      pageCount: chapter.pageCount,
    })),
  }
}

export function getChapterPayload(chapterId: string): ChapterPayload | null {
  const db = getDatabase()

  const chapterRow = db
    .select()
    .from(chapters)
    .where(eq(chapters.id, chapterId))
    .get()

  if (!chapterRow) {
    return null
  }

  const pageRows = db
    .select()
    .from(pages)
    .where(eq(pages.chapterId, chapterId))
    .orderBy(asc(pages.pageIndex))
    .all()

  const progressRow = db
    .select()
    .from(readingProgress)
    .where(
      and(
        eq(readingProgress.profileId, 'local'),
        eq(readingProgress.chapterId, chapterId),
      ),
    )
    .get()

  const manifest: ChapterManifest = {
    chapterId: chapterRow.id,
    seriesId: chapterRow.seriesId,
    title: chapterRow.title,
    chapterNumber: chapterRow.chapterNumber,
    pageCount: pageRows.length,
    pages: pageRows.map((page) => ({
      id: page.id,
      chapterId: page.chapterId,
      pageIndex: page.pageIndex,
      width: page.width,
      height: page.height,
      aspect: page.aspect,
      autoIsSpread: page.autoIsSpread,
      splitSpread: page.splitSpread ?? null,
    })),
  }

  return {
    manifest,
    progress: progressRow
      ? {
          chapterId,
          pageIndex: progressRow.pageIndex,
          stepIndex: progressRow.stepIndex,
          mode: progressRow.mode as ChapterProgress['mode'],
          direction: progressRow.direction as ChapterProgress['direction'],
          zoomPreset: progressRow.zoomPreset as ChapterProgress['zoomPreset'],
          updatedAt: progressRow.updatedAt,
        }
      : null,
  }
}

export function updatePageOverrides(
  chapterId: string,
  pageIndex: number,
  payload: {
    userOverrideSpread?: boolean | null
    splitSpread?: boolean | null
  },
): boolean {
  const db = getDatabase()
  const page = db
    .select({ id: pages.id })
    .from(pages)
    .where(and(eq(pages.chapterId, chapterId), eq(pages.pageIndex, pageIndex)))
    .get()

  if (!page) {
    return false
  }

  db.update(pages)
    .set({
      userOverrideSpread:
        payload.userOverrideSpread === undefined
          ? undefined
          : payload.userOverrideSpread,
      splitSpread:
        payload.splitSpread === undefined ? undefined : payload.splitSpread,
      updatedAt: Date.now(),
    })
    .where(eq(pages.id, page.id))
    .run()

  return true
}

export function upsertProgress(
  payload: Omit<ChapterProgress, 'updatedAt'>,
): ChapterProgress {
  const db = getDatabase()
  const updatedAt = Date.now()

  db.insert(readingProgress)
    .values({
      profileId: 'local',
      chapterId: payload.chapterId,
      pageIndex: payload.pageIndex,
      stepIndex: payload.stepIndex,
      mode: payload.mode,
      direction: payload.direction,
      zoomPreset: payload.zoomPreset as ZoomPreset,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: [readingProgress.profileId, readingProgress.chapterId],
      set: {
        pageIndex: payload.pageIndex,
        stepIndex: payload.stepIndex,
        mode: payload.mode,
        direction: payload.direction,
        zoomPreset: payload.zoomPreset,
        updatedAt,
      },
    })
    .run()

  return {
    ...payload,
    updatedAt,
  }
}

export function findPageImagePaths(chapterId: string, pageIndex: number) {
  const db = getDatabase()
  const row = db
    .select({
      imagePath: pages.imagePath,
      thumbnailPath: pages.thumbnailPath,
    })
    .from(pages)
    .where(and(eq(pages.chapterId, chapterId), eq(pages.pageIndex, pageIndex)))
    .get()

  return row ?? null
}

export function hasSeriesWithSource(source: string): boolean {
  const db = getDatabase()
  const row = db
    .select({ id: series.id })
    .from(series)
    .where(eq(series.source, source))
    .get()

  return Boolean(row)
}

export function deleteSeriesById(seriesId: string) {
  const db = getDatabase()
  db.delete(series).where(eq(series.id, seriesId)).run()
}

export function listStaleLocalUploadSeriesIds(
  cutoffTimestamp: number,
): string[] {
  const db = getDatabase()

  const rows = db
    .select({ id: series.id })
    .from(series)
    .where(
      and(
        eq(series.source, 'local-upload'),
        lt(series.updatedAt, cutoffTimestamp),
      ),
    )
    .all()

  return rows.map((row) => row.id)
}
