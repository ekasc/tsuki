import fs from 'node:fs/promises'
import path from 'node:path'

import sharp from 'sharp'

import { inferAutoSpreadFlags } from '#/lib/reader/pairing'

import { DEMO_DIR } from '../config'
import {
  createChapter,
  createSeries,
  hasSeriesWithSource,
  insertPages,
  updateSeriesCoverByChapter,
  type CreatePageInput,
} from '../db/repository'
import { normalizeRelativeStoragePath } from '../fs'

interface DemoPageSpec {
  width: number
  height: number
  label: string
  background: string
  splitSpread?: boolean
}

interface DemoChapterSpec {
  title: string
  chapterNumber: number
  pages: DemoPageSpec[]
}

const DEMO_CHAPTERS: DemoChapterSpec[] = [
  {
    title: 'Chapter 1 - Welcome Grid',
    chapterNumber: 1,
    pages: [
      { width: 1200, height: 1800, label: 'P1', background: '#0A1C2B' },
      { width: 1200, height: 1800, label: 'P2', background: '#17324A' },
      { width: 2600, height: 1700, label: 'Spread', background: '#3A1B4D' },
      { width: 1200, height: 1800, label: 'P4', background: '#175744' },
      { width: 1200, height: 1800, label: 'P5', background: '#5B3416' },
    ],
  },
  {
    title: 'Chapter 2 - Split Candidate',
    chapterNumber: 2,
    pages: [
      { width: 1200, height: 1800, label: 'P1', background: '#211538' },
      {
        width: 2500,
        height: 1700,
        label: 'Split Ready',
        background: '#5F0B21',
        splitSpread: true,
      },
      { width: 1200, height: 1800, label: 'P3', background: '#0A3B5F' },
      { width: 1200, height: 1800, label: 'P4', background: '#2D4C1A' },
    ],
  },
]

function toDataRelativePath(absolutePath: string): string {
  return normalizeRelativeStoragePath(
    path.relative(path.resolve(process.cwd(), 'data'), absolutePath),
  )
}

function buildSvgLabel(spec: DemoPageSpec): string {
  const fontSize = Math.max(72, Math.floor(spec.width / 12))

  return `
    <svg width="${spec.width}" height="${spec.height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="${spec.background}" />
      <circle cx="${Math.floor(spec.width * 0.2)}" cy="${Math.floor(spec.height * 0.22)}" r="${Math.floor(spec.width * 0.12)}" fill="#FFFFFF22" />
      <rect x="${Math.floor(spec.width * 0.08)}" y="${Math.floor(spec.height * 0.72)}" width="${Math.floor(spec.width * 0.84)}" height="${Math.floor(spec.height * 0.18)}" rx="36" fill="#00000066" />
      <text x="50%" y="48%" dominant-baseline="middle" text-anchor="middle" fill="#F7F7F7" font-size="${fontSize}" font-family="Georgia, serif" font-weight="700">${spec.label}</text>
      <text x="50%" y="82%" dominant-baseline="middle" text-anchor="middle" fill="#E5E7EB" font-size="${Math.floor(fontSize * 0.32)}" font-family="Verdana, sans-serif">Demo content (licensed for local testing)</text>
    </svg>
  `
}

async function createDemoImage(spec: DemoPageSpec, destination: string) {
  const svg = buildSvgLabel(spec)

  await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toFile(destination)
}

export async function ensureDemoSeed() {
  if (hasSeriesWithSource('demo')) {
    return
  }

  const seriesId = createSeries({
    title: 'Suki Demo Anthology',
    description:
      'Built-in legal demo pages to validate reader modes, spread detection, and progress sync.',
    source: 'demo',
  })

  for (const chapterSpec of DEMO_CHAPTERS) {
    const chapterId = createChapter({
      seriesId,
      title: chapterSpec.title,
      chapterNumber: chapterSpec.chapterNumber,
      sortIndex: chapterSpec.chapterNumber,
    })

    const chapterDir = path.join(DEMO_DIR, seriesId, chapterId)
    const pagesDir = path.join(chapterDir, 'pages')
    const thumbsDir = path.join(chapterDir, 'thumbnails')

    await fs.mkdir(pagesDir, { recursive: true })
    await fs.mkdir(thumbsDir, { recursive: true })

    const pageInputs: CreatePageInput[] = []

    for (const [pageIndex, spec] of chapterSpec.pages.entries()) {
      const pageName = `${String(pageIndex + 1).padStart(4, '0')}.jpg`
      const thumbName = `${String(pageIndex + 1).padStart(4, '0')}.webp`
      const imagePath = path.join(pagesDir, pageName)
      const thumbPath = path.join(thumbsDir, thumbName)

      await createDemoImage(spec, imagePath)

      await sharp(imagePath)
        .resize({
          width: 360,
          height: 360,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 82 })
        .toFile(thumbPath)

      pageInputs.push({
        chapterId,
        pageIndex,
        imagePath: toDataRelativePath(imagePath),
        thumbnailPath: toDataRelativePath(thumbPath),
        width: spec.width,
        height: spec.height,
        aspect: spec.width / spec.height,
        autoIsSpread: false,
        userOverrideSpread: null,
        splitSpread: spec.splitSpread ?? null,
      })
    }

    const autoSpread = inferAutoSpreadFlags(
      pageInputs.map((page) => ({ width: page.width, height: page.height })),
    )

    for (const [index, page] of pageInputs.entries()) {
      page.autoIsSpread = autoSpread[index] ?? false
    }

    insertPages(pageInputs)
    updateSeriesCoverByChapter(chapterId)
  }
}
