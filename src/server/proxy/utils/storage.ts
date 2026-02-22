import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { lookup as lookupMimeType } from 'mime-types'

import { DATA_DIR } from '#/server/config'
import { HttpError } from '#/server/errors'

const PROXY_ROOT_DIR = path.join(DATA_DIR, 'proxy')
const PROXY_UPLOADS_DIR = path.join(PROXY_ROOT_DIR, 'uploads')

const SAFE_CHAPTER_ID = /^[a-f0-9]{24,64}$/
const SAFE_FILENAME = /^[A-Za-z0-9._-]+$/

const CONTENT_TYPE_TO_EXTENSION: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
}

export interface StoredUploadPage {
  filename: string
  contentType: string
  byteLength: number
}

export interface UploadPageInput {
  sourceName: string
  buffer: Buffer
  contentType: string
}

export async function ensureProxyStorageReady(): Promise<void> {
  await fs.mkdir(PROXY_UPLOADS_DIR, { recursive: true })
}

function extensionFromPage(page: UploadPageInput): string {
  const byMime = CONTENT_TYPE_TO_EXTENSION[page.contentType]
  if (byMime) {
    return byMime
  }

  const parsedExtension = path.extname(page.sourceName).toLowerCase()
  if (parsedExtension.length > 0) {
    return parsedExtension
  }

  return '.bin'
}

export function createDeterministicChapterId(input: {
  seriesTitle?: string
  chapterTitle?: string
  chapterNumber?: number
  pages: UploadPageInput[]
}): string {
  const hash = createHash('sha256')

  hash.update(input.seriesTitle ?? '')
  hash.update('\n')
  hash.update(input.chapterTitle ?? '')
  hash.update('\n')
  hash.update(input.chapterNumber?.toString() ?? '')
  hash.update('\n')

  input.pages.forEach((page, index) => {
    hash.update(index.toString())
    hash.update('\n')
    hash.update(page.sourceName)
    hash.update('\n')
    hash.update(page.contentType)
    hash.update('\n')
    hash.update(page.buffer)
    hash.update('\n')
  })

  return hash.digest('hex').slice(0, 24)
}

export async function writeUploadChapter(
  chapterId: string,
  pages: UploadPageInput[],
): Promise<StoredUploadPage[]> {
  if (!SAFE_CHAPTER_ID.test(chapterId)) {
    throw new HttpError(400, 'Invalid chapter identifier')
  }

  const chapterDir = path.join(PROXY_UPLOADS_DIR, chapterId)
  await fs.rm(chapterDir, { recursive: true, force: true })
  await fs.mkdir(chapterDir, { recursive: true })

  const storedPages: StoredUploadPage[] = []

  for (const [index, page] of pages.entries()) {
    const extension = extensionFromPage(page)
    const filename = `${String(index + 1).padStart(4, '0')}${extension}`
    const filePath = path.join(chapterDir, filename)

    await fs.writeFile(filePath, page.buffer)

    storedPages.push({
      filename,
      contentType: page.contentType,
      byteLength: page.buffer.byteLength,
    })
  }

  return storedPages
}

export async function resolveLocalAsset(
  chapterId: string,
  filename: string,
): Promise<{
  filePath: string
  contentType: string
  contentLength: string
  lastModified: string
}> {
  const normalizedChapterId = chapterId.trim().toLowerCase()

  if (!SAFE_CHAPTER_ID.test(normalizedChapterId)) {
    throw new HttpError(400, 'Invalid chapter identifier')
  }

  if (!SAFE_FILENAME.test(filename)) {
    throw new HttpError(400, 'Invalid filename')
  }

  const chapterDir = path.join(PROXY_UPLOADS_DIR, normalizedChapterId)
  const resolvedPath = path.resolve(chapterDir, filename)

  if (!resolvedPath.startsWith(`${chapterDir}${path.sep}`)) {
    throw new HttpError(400, 'Invalid local asset path')
  }

  const stats = await fs.stat(resolvedPath).catch(() => null)

  if (!stats || !stats.isFile()) {
    throw new HttpError(404, 'Local asset not found')
  }

  const contentType =
    lookupMimeType(path.extname(filename)) || 'application/octet-stream'

  return {
    filePath: resolvedPath,
    contentType: contentType.toString(),
    contentLength: stats.size.toString(),
    lastModified: stats.mtime.toUTCString(),
  }
}
