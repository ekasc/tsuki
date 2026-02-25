import { SESSION_UPLOAD_TTL_MS } from '../config'
import {
  listStaleLocalUploadSeriesIds,
  deleteSeriesById,
} from '../db/repository'
import { removeDirectory, safeResolveDataPath } from '../fs'

export async function pruneStaleSessionUploads() {
  const cutoff = Date.now() - SESSION_UPLOAD_TTL_MS
  const staleSeriesIds = listStaleLocalUploadSeriesIds(cutoff)

  await Promise.all(
    staleSeriesIds.map(async (seriesId) => {
      deleteSeriesById(seriesId)
      await removeDirectory(safeResolveDataPath(`library/${seriesId}`))
    }),
  )
}
