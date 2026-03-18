import { expect, test } from '@playwright/test'
import { openDemoSeries, primeStorage } from './helpers'

function extractChapterIdFromHref(href: string): string {
  const parsed = new URL(href, 'http://127.0.0.1:3100')
  const segments = parsed.pathname.split('/').filter(Boolean)
  const chapterId = segments.at(-1)
  if (!chapterId) {
    throw new Error(`Could not parse chapter id from href: ${href}`)
  }
  return chapterId
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

  const chapterLinks = page.getByRole('link', { name: /Chapter/i })
  const totalChapterLinks = await chapterLinks.count()
  expect(totalChapterLinks).toBeGreaterThanOrEqual(2)

  const currentChapterHref = await chapterLinks.nth(1).getAttribute('href')
  const nextChapterHref = await chapterLinks.first().getAttribute('href')
  expect(currentChapterHref).toBeTruthy()
  expect(nextChapterHref).toBeTruthy()

  const currentChapterId = extractChapterIdFromHref(currentChapterHref!)
  const nextChapterId = extractChapterIdFromHref(nextChapterHref!)
  const currentRoutePath = `/reader/${currentChapterId}`

  await chapterLinks.nth(1).click()
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

  const chapterLinks = page.getByRole('link', { name: /Chapter/i })
  const latestChapterHref = await chapterLinks.first().getAttribute('href')
  const earlierChapterHref = await chapterLinks.nth(1).getAttribute('href')
  expect(latestChapterHref).toBeTruthy()
  expect(earlierChapterHref).toBeTruthy()

  const latestChapterId = extractChapterIdFromHref(latestChapterHref!)
  const earlierChapterId = extractChapterIdFromHref(earlierChapterHref!)
  const latestRoutePath = `/reader/${latestChapterId}`

  await chapterLinks.first().click()
  await expect(page).toHaveURL(new RegExp(`/reader/${latestChapterId}$`))
  chapterRequestLog.length = 0

  for (let index = 0; index < 6; index += 1) {
    await page.keyboard.press('ArrowLeft')
    await page.waitForTimeout(110)
  }

  const unexpectedPrefetchCount = chapterRequestLog.filter(
    (entry) => entry.id === earlierChapterId && entry.routePath === latestRoutePath,
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

  const chapterLinks = page.getByRole('link', { name: /Chapter/i })
  const currentChapterHref = await chapterLinks.nth(1).getAttribute('href')
  const nextChapterHref = await chapterLinks.first().getAttribute('href')
  expect(currentChapterHref).toBeTruthy()
  expect(nextChapterHref).toBeTruthy()

  const currentChapterId = extractChapterIdFromHref(currentChapterHref!)
  const nextChapterId = extractChapterIdFromHref(nextChapterHref!)
  const currentRoutePath = `/reader/${currentChapterId}`

  await chapterLinks.nth(1).click()
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
