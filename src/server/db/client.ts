import path from 'node:path'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

import { DB_FILE_PATH } from '../config'
import { ensureDataDirectories } from '../fs'
import * as schema from './schema'

let sqlite: Database.Database | null = null
let database: BetterSQLite3Database<typeof schema> | null = null
let initializationPromise: Promise<void> | null = null

function getMigrationPath(): string {
  return path.resolve(process.cwd(), 'drizzle')
}

export function getDatabase() {
  if (!database) {
    sqlite = new Database(DB_FILE_PATH)
    sqlite.pragma('journal_mode = WAL')
    database = drizzle(sqlite, {
      schema,
    })
  }

  return database
}

export async function initializeDatabase() {
  if (initializationPromise) {
    return initializationPromise
  }

  initializationPromise = (async () => {
    await ensureDataDirectories()
    const db = getDatabase()
    migrate(db, {
      migrationsFolder: getMigrationPath(),
    })
  })()

  await initializationPromise
}

export function closeDatabase() {
  sqlite?.close()
  sqlite = null
  database = null
  initializationPromise = null
}
