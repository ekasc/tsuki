import path from 'node:path'

import JSZip from 'jszip'
import { fileTypeFromBuffer } from 'file-type'

import { uploadRequestSchema } from '#/server/api/validators'
import { HttpError } from '#/server/errors'
import { assertRateLimit, requestClientId } from '#/server/rate-limit'

import { proxyConfig } from '../server'
import {
  createDeterministicChapterId,
  ensureProxyStorageReady,
  type UploadPageInput,
  writeUploadChapter,
} from '../utils/storage'

const MAX_ENTRY_BYTES = 25 * 1024 * 1024

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
])

const ARCHIVE_EXTENSIONS = new Set(['.zip', '.cbz'])

type UploadChapterResponse = {
  chapterId: string
  pages: Array<{
    url: string
  }>
}

function assertUploadRateLimit(request: Request): void {
  assertRateLimit(`proxy-upload:${requestClientId(request)}`, {
    limit: proxyConfig.uploadRateLimitPerMinute,
    windowMs: 60_000,
  })
}

async function toBuffer(file: File): Promise<Buffer> {
  if (file.size > proxyConfig.uploadMaxBytes) {
    throw new HttpError(413, 'Upload file exceeds size limits')
  }

  return Buffer.from(await file.arrayBuffer())
}

function assertArchiveFile(file: File): void {
  const extension = path.extname(file.name).toLowerCase()
  if (!ARCHIVE_EXTENSIONS.has(extension)) {
    throw new HttpError(400, 'Archive must be .zip or .cbz')
  }
}

async function extractUploadPagesFromArchive(
  file: File,
): Promise<UploadPageInput[]> {
  assertArchiveFile(file)
  const buffer = await toBuffer(file)
  const detected = await fileTypeFromBuffer(buffer)

  if (!detected || detected.mime !== 'application/zip') {
    throw new HttpError(400, 'Uploaded archive is not a ZIP/CBZ file')
  }

  const zip = await JSZip.loadAsync(buffer)
  const entryNames = Object.keys(zip.files)
    .filter((entryName) => !zip.files[entryName]?.dir)
    .sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true }),
    )

  if (entryNames.length === 0) {
    throw new HttpError(400, 'Archive contains no files')
  }

  if (entryNames.length > proxyConfig.uploadMaxPages) {
    throw new HttpError(400, 'Archive contains too many files')
  }

  const pages: UploadPageInput[] = []

  for (const entryName of entryNames) {
    const zipEntry = zip.files[entryName]
    if (!zipEntry) {
      continue
    }

    const entryBuffer = await zipEntry.async('nodebuffer')

    if (entryBuffer.length > MAX_ENTRY_BYTES) {
      throw new HttpError(
        413,
        `Archive entry exceeds size limit (${Math.floor(MAX_ENTRY_BYTES / (1024 * 1024))}MB).`,
      )
    }

    const entryType = await fileTypeFromBuffer(entryBuffer)
    const mime = entryType?.mime

    if (!mime || !ALLOWED_IMAGE_MIME_TYPES.has(mime)) {
      continue
    }

    pages.push({
      sourceName: path.basename(entryName),
      buffer: entryBuffer,
      contentType: mime,
    })
  }

  if (pages.length === 0) {
    throw new HttpError(400, 'Archive contains no supported image pages')
  }

  if (pages.length > proxyConfig.uploadMaxPages) {
    throw new HttpError(400, 'Upload contains too many image pages')
  }

  return pages
}

async function extractUploadPagesFromFiles(
  files: File[],
): Promise<UploadPageInput[]> {
  if (files.length === 0) {
    throw new HttpError(400, 'No files uploaded')
  }

  if (files.length > proxyConfig.uploadMaxPages) {
    throw new HttpError(400, 'Too many image files uploaded')
  }

  const pages: UploadPageInput[] = []

  for (const file of files) {
    const buffer = await toBuffer(file)
    const detected = await fileTypeFromBuffer(buffer)
    const mime = detected?.mime

    if (!mime || !ALLOWED_IMAGE_MIME_TYPES.has(mime)) {
      throw new HttpError(400, `Unsupported image file: ${file.name}`)
    }

    pages.push({
      sourceName: file.name,
      buffer,
      contentType: mime,
    })
  }

  return pages
}

function collectUploadedFiles(formData: FormData): File[] {
  return Array.from(formData.values()).filter(
    (value): value is File => value instanceof File,
  )
}

export async function uploadChapterFromRequest(
  request: Request,
): Promise<UploadChapterResponse> {
  assertUploadRateLimit(request)
  await ensureProxyStorageReady()

  const formData = await request.formData()

  const metadata = uploadRequestSchema.parse({
    seriesTitle: formData.get('seriesTitle')?.toString() ?? undefined,
    chapterTitle: formData.get('chapterTitle')?.toString() ?? undefined,
    chapterNumber: formData.get('chapterNumber')
      ? Number.parseInt(formData.get('chapterNumber')!.toString(), 10)
      : undefined,
  })

  const archive = formData.get('archive')
  const files = collectUploadedFiles(formData)

  const pages =
    archive instanceof File
      ? await extractUploadPagesFromArchive(archive)
      : await extractUploadPagesFromFiles(files)

  const chapterId = createDeterministicChapterId({
    ...metadata,
    pages,
  })

  const storedPages = await writeUploadChapter(chapterId, pages)

  return {
    chapterId,
    pages: storedPages.map((page) => ({
      url: `/v1/local/${chapterId}/${page.filename}`,
    })),
  }
}
