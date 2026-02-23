import fs from 'node:fs'
import path from 'node:path'

export const DATA_DIR = path.resolve(process.cwd(), 'data')
const LEGACY_DB_FILE_PATH = path.join(DATA_DIR, 'suki_reader.db')
const NEXT_DB_FILE_PATH = path.join(DATA_DIR, 'tsuki_reader.db')

export const DB_FILE_PATH =
  fs.existsSync(NEXT_DB_FILE_PATH) || !fs.existsSync(LEGACY_DB_FILE_PATH)
    ? NEXT_DB_FILE_PATH
    : LEGACY_DB_FILE_PATH
export const LIBRARY_DIR = path.join(DATA_DIR, 'library')
export const CACHE_DIR = path.join(DATA_DIR, 'cache')
export const IMPORT_DIR = path.join(DATA_DIR, 'imports')
export const DEMO_DIR = path.join(DATA_DIR, 'demo')

export const INGEST_LIMITS = {
  maxArchiveBytes: 150 * 1024 * 1024,
  maxImageBytes: 25 * 1024 * 1024,
  maxEntriesPerArchive: 400,
}

export const READER_DEFAULTS = {
  spreadWidthMultiplier: 1.35,
} as const
