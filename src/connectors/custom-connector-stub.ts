import type {
  ChapterManifest,
  SeriesChapterSummary,
  SeriesDetail,
} from '#/lib/contracts'
import type { Connector } from './connector'

const WARNING_MESSAGE =
  'Permission required: CustomConnectorStub must only be implemented for sources you have explicit rights to access.'

/**
 * Stub connector intentionally does not implement scraping/fetching logic.
 * Implement only with explicit rights/permission for the source.
 */
export class CustomConnectorStub implements Connector {
  async getSeries(): Promise<SeriesDetail | null> {
    throw new Error(WARNING_MESSAGE)
  }

  async listChapters(): Promise<SeriesChapterSummary[]> {
    throw new Error(WARNING_MESSAGE)
  }

  async getChapterManifest(): Promise<ChapterManifest | null> {
    throw new Error(WARNING_MESSAGE)
  }
}

export const CUSTOM_CONNECTOR_WARNING = WARNING_MESSAGE
