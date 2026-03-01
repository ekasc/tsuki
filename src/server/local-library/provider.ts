import type {
  ChapterPayload,
  ChapterProgress,
  LibrarySeries,
  SeriesDetail,
} from '#/lib/contracts'

export interface LocalLibraryImageOptions {
  thumbnail?: boolean
  width?: number
  height?: number
  crop?: 'left' | 'right' | null
}

export interface LocalLibraryProvider {
  listSeries(): Promise<LibrarySeries[]> | LibrarySeries[]
  getSeries(seriesId: string): Promise<SeriesDetail | null> | SeriesDetail | null
  deleteSeries(seriesId: string): Promise<boolean> | boolean
  getChapter(
    chapterId: string,
  ): Promise<ChapterPayload | null> | ChapterPayload | null
  updateProgress(
    payload: Omit<ChapterProgress, 'updatedAt'>,
  ): Promise<ChapterProgress> | ChapterProgress
  updatePageOverrides(
    chapterId: string,
    pageIndex: number,
    payload: {
      userOverrideSpread?: boolean | null
      splitSpread?: boolean | null
    },
  ): Promise<boolean> | boolean
  getImageResponse(
    request: Request,
    chapterId: string,
    pageIndex: number,
    options: LocalLibraryImageOptions,
  ): Promise<Response>
}
