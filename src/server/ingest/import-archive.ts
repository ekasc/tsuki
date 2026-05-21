import fs from 'node:fs/promises'
import path from 'node:path'

import { fileTypeFromBuffer } from 'file-type'
import JSZip from 'jszip'
import pLimit from 'p-limit'
import sharp from 'sharp'

import { inferAutoSpreadFlags } from '#/lib/reader/pairing'

import { DATA_DIR, IMPORT_DIR, INGEST_LIMITS, LIBRARY_DIR } from '../config'
import { deleteSeriesById, type CreatePageInput } from '../db/repository'
import {
  createChapter,
  createSeries,
  insertPages,
  updateSeriesCoverByChapter,
} from '../db/repository'
import { normalizeRelativeStoragePath } from '../fs'
import { HttpError } from '../errors'
import { retryWithBackoff } from '../retry'

const ARCHIVE_EXTENSIONS = ['.cbz', '.zip']
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp']

interface ProcessedPage {
  pageIndex: number
  imagePath: string
  thumbnailPath: string
  width: number
  height: number
  aspect: number
}

function sanitizeTitle(value: string, fallback: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    return fallback
  }

  return trimmed.slice(0, 120)
}

function isSupportedArchiveFilename(filename: string): boolean {
  const extension = path.extname(filename).toLowerCase()
  return ARCHIVE_EXTENSIONS.includes(extension)
}

function isSupportedImageFilename(filename: string): boolean {
  const extension = path.extname(filename).toLowerCase()
  return IMAGE_EXTENSIONS.includes(extension)
}

function inferArchiveName(filename: string): string {
  return path.basename(filename, path.extname(filename))
}

function toRelativeStoragePath(absolutePath: string): string {
  const relative = path.relative(DATA_DIR, absolutePath)
  return normalizeRelativeStoragePath(relative)
}

function assertArchiveAllowed(filename: string, size: number) {
  if (!isSupportedArchiveFilename(filename)) {
    throw new HttpError(400, 'Only .cbz and .zip archives are supported.')
  }

  if (size > INGEST_LIMITS.maxArchiveBytes) {
    throw new HttpError(
      413,
      `Archive too large. Max ${Math.floor(INGEST_LIMITS.maxArchiveBytes / (1024 * 1024))}MB.`,
    )
  }
}

async function assertArchiveMime(buffer: Buffer) {
  const fileType = await fileTypeFromBuffer(buffer)

  if (!fileType) {
    throw new HttpError(400, 'Cannot verify archive format.')
  }

  const accepted = ['application/zip', 'application/x-zip', 'application/x-cbz']

  if (!accepted.includes(fileType.mime)) {
    throw new HttpError(400, 'Uploaded file is not a valid ZIP/CBZ archive.')
  }
}

function pickImageEntries(zip: JSZip): JSZip.JSZipObject[] {
  const entries = Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .filter((entry) => isSupportedImageFilename(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))

  if (entries.length === 0) {
    throw new HttpError(400, 'Archive does not contain supported image files.')
  }

  if (entries.length > INGEST_LIMITS.maxEntriesPerArchive) {
    throw new HttpError(
      400,
      `Archive has too many pages. Max ${INGEST_LIMITS.maxEntriesPerArchive} entries.`,
    )
  }

  return entries
}

async function writeImportSnapshot(
  fileName: string,
  bytes: Buffer,
): Promise<string> {
  const importName = `${Date.now()}-${fileName.replace(/[^a-zA-Z0-9.-]/g, '_')}`
  const importPath = path.join(IMPORT_DIR, importName)
  await fs.writeFile(importPath, bytes)
  return importPath
}

async function processEntry(
  entry: JSZip.JSZipObject,
  pageIndex: number,
  outputDirectory: string,
): Promise<ProcessedPage> {
  const rawBytes = await entry.async('nodebuffer')

  if (rawBytes.length > INGEST_LIMITS.maxImageBytes) {
    throw new HttpError(
      400,
      `Page ${pageIndex + 1} exceeds image size limit (${Math.floor(INGEST_LIMITS.maxImageBytes / (1024 * 1024))}MB).`,
    )
  }

  const originalExtension = path
    .extname(entry.name)
    .toLowerCase()
    .replace('.', '')
  const extension = originalExtension === 'jpeg' ? 'jpg' : originalExtension

  const baseName = String(pageIndex + 1).padStart(4, '0')
  const imagePath = path.join(
    outputDirectory,
    'pages',
    `${baseName}.${extension}`,
  )
  const thumbnailPath = path.join(
    outputDirectory,
    'thumbnails',
    `${baseName}.webp`,
  )

  await fs.writeFile(imagePath, rawBytes)

  const metadata = await retryWithBackoff(
    async () => sharp(rawBytes).metadata(),
    { retries: 3, baseDelayMs: 120 },
  )

  const width = metadata.width ?? 1
  const height = metadata.height ?? 1

  await retryWithBackoff(
    async () => {
      await sharp(rawBytes)
        .resize({
          width: 360,
          height: 360,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 82 })
        .toFile(thumbnailPath)
    },
    { retries: 3, baseDelayMs: 120 },
  )

  return {
    pageIndex,
    imagePath: toRelativeStoragePath(imagePath),
    thumbnailPath: toRelativeStoragePath(thumbnailPath),
    width,
    height,
    aspect: width / Math.max(height, 1),
  }
}

export async function ingestArchiveUpload(input: {
  file: File
  seriesTitle?: string
  chapterTitle?: string
  chapterNumber?: number
}): Promise<{ seriesId: string; chapterId: string }> {
  assertArchiveAllowed(input.file.name, input.file.size)

  const buffer = Buffer.from(await input.file.arrayBuffer())
  await assertArchiveMime(buffer)

  const snapshotPath = await writeImportSnapshot(input.file.name, buffer)

  const zip = await JSZip.loadAsync(buffer)
  const entries = pickImageEntries(zip)

  const inferredName = inferArchiveName(input.file.name)
  const safeSeriesTitle = sanitizeTitle(input.seriesTitle ?? '', inferredName)
  const safeChapterTitle = sanitizeTitle(input.chapterTitle ?? '', 'Chapter 1')
  const chapterNumber = Math.max(1, input.chapterNumber ?? 1)

  const seriesId = createSeries({
    title: safeSeriesTitle,
    description: `Imported from ${input.file.name}`,
    source: 'local-upload',
  })

  const chapterId = createChapter({
    seriesId,
    title: safeChapterTitle,
    chapterNumber,
    sortIndex: chapterNumber,
  })

  const chapterOutputDirectory = path.join(LIBRARY_DIR, seriesId, chapterId)
  const pagesDirectory = path.join(chapterOutputDirectory, 'pages')
  const thumbnailsDirectory = path.join(chapterOutputDirectory, 'thumbnails')

  await fs.mkdir(pagesDirectory, { recursive: true })
  await fs.mkdir(thumbnailsDirectory, { recursive: true })

  try {
    const limit = pLimit(4)
    const processedPages = await Promise.all(
      entries.map((entry, index) =>
        limit(() => processEntry(entry, index, chapterOutputDirectory)),
      ),
    )

    const autoSpreadFlags = inferAutoSpreadFlags(
      processedPages.map((page) => ({
        width: page.width,
        height: page.height,
      })),
    )

    const pageInputs: CreatePageInput[] = processedPages.map((page) => ({
      chapterId,
      pageIndex: page.pageIndex,
      imagePath: page.imagePath,
      thumbnailPath: page.thumbnailPath,
      width: page.width,
      height: page.height,
      aspect: page.aspect,
      autoIsSpread: autoSpreadFlags[page.pageIndex] ?? false,
      userOverrideSpread: null,
      splitSpread: null,
    }))

    insertPages(pageInputs)
    updateSeriesCoverByChapter(chapterId)

    await fs.rm(snapshotPath, { force: true })

    return {
      seriesId,
      chapterId,
    }
  } catch (error) {
    await fs.rm(snapshotPath, { force: true })
    deleteSeriesById(seriesId)
    await fs.rm(path.join(LIBRARY_DIR, seriesId), {
      recursive: true,
      force: true,
    })
    throw error
  }
}
