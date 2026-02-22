import type {
  ChapterManifest,
  SeriesChapterSummary,
  SeriesDetail,
} from '#/lib/contracts'
import { getChapterPayload, getSeriesDetail } from '#/server/db/repository'
import type { Connector } from './connector'

export class DemoConnector implements Connector {
  async getSeries(urlOrId: string): Promise<SeriesDetail | null> {
    const series = getSeriesDetail(urlOrId)

    if (!series || series.source !== 'demo') {
      return null
    }

    return series
  }

  async listChapters(series: SeriesDetail): Promise<SeriesChapterSummary[]> {
    return series.chapters
  }

  async getChapterManifest(
    chapter: SeriesChapterSummary,
  ): Promise<ChapterManifest | null> {
    const payload = getChapterPayload(chapter.id)
    return payload?.manifest ?? null
  }
}
