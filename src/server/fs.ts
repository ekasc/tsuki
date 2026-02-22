import fs from 'node:fs/promises'
import path from 'node:path'
import {
  CACHE_DIR,
  DATA_DIR,
  DEMO_DIR,
  IMPORT_DIR,
  LIBRARY_DIR,
} from './config'

const REQUIRED_DIRS = [DATA_DIR, CACHE_DIR, DEMO_DIR, IMPORT_DIR, LIBRARY_DIR]

export async function ensureDataDirectories() {
  await Promise.all(
    REQUIRED_DIRS.map(async (directoryPath) => {
      await fs.mkdir(directoryPath, { recursive: true })
    }),
  )
}

export function normalizeRelativeStoragePath(inputPath: string): string {
  const normalized = path
    .normalize(inputPath)
    .replace(/^([/\\])+/, '')
    .replace(/^(\.\.(\/|\\|$))+/, '')

  return normalized
}

export function safeResolveDataPath(relativePath: string): string {
  const normalized = normalizeRelativeStoragePath(relativePath)
  const absolutePath = path.resolve(DATA_DIR, normalized)

  if (!absolutePath.startsWith(DATA_DIR)) {
    throw new Error('Unsafe path request detected')
  }

  return absolutePath
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

export async function removeDirectory(directoryPath: string): Promise<void> {
  await fs.rm(directoryPath, { recursive: true, force: true })
}
