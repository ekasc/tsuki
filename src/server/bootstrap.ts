import { initializeDatabase } from './db/client'
import { pruneStaleSessionUploads } from './ingest/prune-session-uploads'
import { ensureDemoSeed } from './ingest/seed-demo'

let readyPromise: Promise<void> | null = null

export async function ensureServerReady() {
  if (readyPromise) {
    return readyPromise
  }

  readyPromise = (async () => {
    await initializeDatabase()
    await pruneStaleSessionUploads()
    await ensureDemoSeed()
  })()

  await readyPromise
}
