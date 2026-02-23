export type ConnectorSource = 'demo' | 'local-upload' | 'custom-stub'

export interface LibrarySeries {
  id: string
  title: string
  description: string | null
  source: ConnectorSource
  chapterCount: number
  coverChapterId: string | null
  coverPageIndex: number | null
}

export interface SeriesChapterSummary {
  id: string
  title: string
  chapterNumber: number
  sortIndex: number
  pageCount: number
}

export interface SeriesDetail {
  id: string
  title: string
  description: string | null
  source: ConnectorSource
  chapters: SeriesChapterSummary[]
}

export interface ChapterPageManifest {
  id: string
  chapterId: string
  pageIndex: number
  width: number
  height: number
  aspect: number
  autoIsSpread: boolean
  splitSpread: boolean | null
}

export interface ChapterManifest {
  chapterId: string
  seriesId: string
  title: string
  chapterNumber: number
  pageCount: number
  pages: ChapterPageManifest[]
}

export type ReaderMode = 'single' | 'double' | 'scroll'
export type ReaderDirection = 'ltr' | 'rtl'
export type ZoomPreset = 'fit-width' | 'fit-height' | 'actual'

export interface ChapterProgress {
  chapterId: string
  pageIndex: number
  stepIndex: number
  mode: ReaderMode
  direction: ReaderDirection
  zoomPreset: ZoomPreset
  updatedAt: number
}

export interface ChapterPayload {
  manifest: ChapterManifest
  progress: ChapterProgress | null
}

export interface ApiErrorPayload {
  error: string
}

export interface ReadingHistoryItem {
  chapterId: string
  seriesId: string
  seriesTitle?: string
  chapterTitle: string
  pageIndex: number
  mode: ReaderMode
  readerRoute?: 'local' | 'weebcentral'
  completed?: boolean
  updatedAt: number
}

export interface WeebcentralSeriesDTO {
  id: string
  title: string
  author?: string
  description?: string
  coverUrl?: string
  chapters: Array<{
    id: string
    number: number
    title: string
    date?: string
  }>
}

export interface WeebcentralChapterDTO {
  seriesId: string
  chapterId: string
  pages: Array<{
    url: string
  }>
}
