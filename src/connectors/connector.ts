import type {
  ChapterManifest,
  SeriesChapterSummary,
  SeriesDetail,
} from '#/lib/contracts'

export interface Connector {
  getSeries(urlOrId: string): Promise<SeriesDetail | null>
  listChapters(series: SeriesDetail): Promise<SeriesChapterSummary[]>
  getChapterManifest(
    chapter: SeriesChapterSummary,
  ): Promise<ChapterManifest | null>
}
