import { expect, test, type Page } from '@playwright/test'
import { openDemoSeries, primeStorage, resolveDemoSeriesId } from './helpers'

interface SeriesChapterSummary {
  id: string
  chapterNumber: number
  sortIndex: number
}

interface SeriesDetailResponse {
  chapters: SeriesChapterSummary[]
}

async function resolveReaderAdjacency(page: Page) {
  const demoSeriesId = await resolveDemoSeriesId(page)
  const response = await page.request.get(`/api/series/${demoSeriesId}`)
  if (!response.ok()) {
    throw new Error(`Failed to fetch /api/series/${demoSeriesId} (${response.status()})`)
  }

  const detail = (await response.json()) as SeriesDetailResponse
  const sorted = [...detail.chapters].sort((left, right) => {
    if (left.chapterNumber !== right.chapterNumber) {
      return left.chapterNumber - right.chapterNumber
    }

    return left.sortIndex - right.sortIndex
  })

  if (sorted.length < 2) {
    throw new Error('Expected at least 2 chapters in demo series')
  }

  const currentChapterId = sorted[0]!.id
  const nextChapterId = sorted[1]!.id
  const terminalChapterId = sorted[sorted.length - 1]!.id
  const beforeTerminalChapterId = sorted[sorted.length - 2]!.id

  return {
    currentChapterId,
    nextChapterId,
    terminalChapterId,
    beforeTerminalChapterId,
  }
}

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    'Desktop-only network prefetch assertions.',
  )

  await primeStorage(page)
})

test('reader prefetches next chapter before transition', async ({ page }) => {
  const chapterRequestLog: Array<{ id: string; routePath: string }> = []

  page.on('request', (request) => {
    const parsed = new URL(request.url())
    const match = parsed.pathname.match(/^\/api\/chapter\/([^/]+)$/)
    if (!match?.[1]) {
      return
    }

    chapterRequestLog.push({
      id: decodeURIComponent(match[1]),
      routePath: new URL(page.url()).pathname,
    })
  })

  await page.goto('/')
  await openDemoSeries(page)
  const { currentChapterId, nextChapterId } = await resolveReaderAdjacency(page)

  const currentRoutePath = `/reader/${currentChapterId}`

  await page.locator(`a[href$="/${currentChapterId}"]`).first().click()
  await expect(page.getByTestId('reader-paging-container')).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/reader/${currentChapterId}$`))

  await expect
    .poll(
      () =>
        chapterRequestLog.filter(
          (entry) => entry.id === nextChapterId && entry.routePath === currentRoutePath,
        ).length,
      { timeout: 10_000 },
    )
    .toBeGreaterThan(0)

  const preNavigationRequestCount = chapterRequestLog.filter(
    (entry) => entry.id === nextChapterId,
  ).length

  for (let index = 0; index < 12; index += 1) {
    if (new URL(page.url()).pathname === `/reader/${nextChapterId}`) {
      break
    }

    await page.keyboard.press('ArrowLeft')
    await page.waitForTimeout(160)
  }

  await expect(page).toHaveURL(new RegExp(`/reader/${nextChapterId}$`))

  const postNavigationRequestCount = chapterRequestLog.filter(
    (entry) => entry.id === nextChapterId,
  ).length

  expect(postNavigationRequestCount).toBe(preNavigationRequestCount)
})

test('reader does not prefetch when there is no next chapter', async ({ page }) => {
  const chapterRequestLog: Array<{ id: string; routePath: string }> = []

  page.on('request', (request) => {
    const parsed = new URL(request.url())
    const match = parsed.pathname.match(/^\/api\/chapter\/([^/]+)$/)
    if (!match?.[1]) {
      return
    }

    chapterRequestLog.push({
      id: decodeURIComponent(match[1]),
      routePath: new URL(page.url()).pathname,
    })
  })

  await page.goto('/')
  await openDemoSeries(page)
  const { terminalChapterId, beforeTerminalChapterId } =
    await resolveReaderAdjacency(page)
  const terminalRoutePath = `/reader/${terminalChapterId}`

  await page.locator(`a[href$="/${terminalChapterId}"]`).first().click()
  await expect(page).toHaveURL(new RegExp(`/reader/${terminalChapterId}$`))
  chapterRequestLog.length = 0

  for (let index = 0; index < 6; index += 1) {
    await page.keyboard.press('ArrowLeft')
    await page.waitForTimeout(110)
  }

  const unexpectedPrefetchCount = chapterRequestLog.filter(
    (entry) =>
      entry.id === beforeTerminalChapterId &&
      entry.routePath === terminalRoutePath,
  ).length
  expect(unexpectedPrefetchCount).toBe(0)
})

test('reader does not duplicate next chapter prefetch during rapid page flips', async ({
  page,
}) => {
  const chapterRequestLog: Array<{ id: string; routePath: string }> = []

  page.on('request', (request) => {
    const parsed = new URL(request.url())
    const match = parsed.pathname.match(/^\/api\/chapter\/([^/]+)$/)
    if (!match?.[1]) {
      return
    }

    chapterRequestLog.push({
      id: decodeURIComponent(match[1]),
      routePath: new URL(page.url()).pathname,
    })
  })

  await page.goto('/')
  await openDemoSeries(page)
  const { currentChapterId, nextChapterId } = await resolveReaderAdjacency(page)
  const currentRoutePath = `/reader/${currentChapterId}`

  await page.locator(`a[href$="/${currentChapterId}"]`).first().click()
  await expect(page).toHaveURL(new RegExp(`/reader/${currentChapterId}$`))

  await expect
    .poll(
      () =>
        chapterRequestLog.filter(
          (entry) => entry.id === nextChapterId && entry.routePath === currentRoutePath,
        ).length,
      { timeout: 10_000 },
    )
    .toBe(1)

  for (let index = 0; index < 4; index += 1) {
    await page.keyboard.press('ArrowLeft')
    await page.waitForTimeout(80)
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(80)
  }

  await page.waitForTimeout(350)

  const duplicateCount = chapterRequestLog.filter(
    (entry) => entry.id === nextChapterId && entry.routePath === currentRoutePath,
  ).length
  expect(duplicateCount).toBe(1)
})
