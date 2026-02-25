import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'

import mime from 'mime-types'
import sharp from 'sharp'

import { findPageImagePaths } from './db/repository'
import { CACHE_DIR } from './config'
import { fileExists, safeResolveDataPath } from './fs'
import { HttpError } from './errors'

interface ResolveImageOptions {
  thumbnail?: boolean
  width?: number
  height?: number
  crop?: 'left' | 'right' | null
}

interface ImageAsset {
  filePath: string
  contentType: string
  etag: string
  lastModified: string
  contentLength: string
}

function buildCacheKey(
  chapterId: string,
  pageIndex: number,
  options: ResolveImageOptions,
): string {
  const payload = `${chapterId}:${pageIndex}:${options.thumbnail ? 'thumb' : 'full'}:${options.width ?? ''}:${options.height ?? ''}:${options.crop ?? ''}`

  return createHash('sha1').update(payload).digest('hex')
}

function buildContentType(filePath: string): string {
  return mime.lookup(filePath) || 'application/octet-stream'
}

async function getFileHeaders(filePath: string): Promise<ImageAsset> {
  const stat = await fs.stat(filePath)

  return {
    filePath,
    contentType: buildContentType(filePath),
    etag: `W/\"${stat.size}-${Math.floor(stat.mtimeMs)}\"`,
    lastModified: new Date(stat.mtimeMs).toUTCString(),
    contentLength: String(stat.size),
  }
}

async function maybeResizeImage(
  sourcePath: string,
  chapterId: string,
  pageIndex: number,
  options: ResolveImageOptions,
): Promise<string> {
  if (!options.width && !options.height && !options.crop) {
    return sourcePath
  }

  const key = buildCacheKey(chapterId, pageIndex, options)
  const cachePath = path.join(CACHE_DIR, `${key}.webp`)

  if (!(await fileExists(cachePath))) {
    await fs.mkdir(CACHE_DIR, { recursive: true })
    
    let pipeline = sharp(sourcePath)

    if (options.crop) {
      const metadata = await pipeline.metadata()
      if (metadata.width && metadata.height) {
        const halfWidth = Math.floor(metadata.width / 2)
        pipeline = pipeline.extract({
          left: options.crop === 'right' ? halfWidth : 0,
          top: 0,
          width: halfWidth,
          height: metadata.height,
        })
      }
    }

    if (options.width || options.height) {
      pipeline = pipeline.resize({
        width: options.width,
        height: options.height,
        fit: 'inside',
        withoutEnlargement: true,
      })
    }
    
    await pipeline
      .webp({ quality: 84 })
      .toFile(cachePath)
  }

  return cachePath
}

export async function resolveImageAsset(
  chapterId: string,
  pageIndex: number,
  options: ResolveImageOptions,
): Promise<ImageAsset> {
  const pagePaths = findPageImagePaths(chapterId, pageIndex)

  if (!pagePaths) {
    throw new HttpError(404, 'Page not found')
  }

  const relativePath = options.thumbnail
    ? pagePaths.thumbnailPath
    : pagePaths.imagePath

  const sourcePath = safeResolveDataPath(relativePath)

  const outputPath = await maybeResizeImage(
    sourcePath,
    chapterId,
    pageIndex,
    options,
  )

  return getFileHeaders(outputPath)
}
