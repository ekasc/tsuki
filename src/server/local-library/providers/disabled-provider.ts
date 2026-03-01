import { HttpError } from '#/server/errors'

import type { LocalLibraryProvider } from '../provider'

const DISABLED_MESSAGE = 'Local library APIs are disabled in this deployment.'

function throwDisabled(): never {
  throw new HttpError(503, DISABLED_MESSAGE)
}

export const disabledLocalLibraryProvider: LocalLibraryProvider = {
  listSeries: () => throwDisabled(),
  getSeries: () => throwDisabled(),
  deleteSeries: () => throwDisabled(),
  getChapter: () => throwDisabled(),
  updateProgress: () => throwDisabled(),
  updatePageOverrides: () => throwDisabled(),
  getImageResponse: async () => throwDisabled(),
}
