import { expect, test } from '@playwright/test'

import { openLocalReader, primeStorage } from './helpers'

const MOBILE_PROJECTS = new Set([
  'webkit-iphone15pro',
  'chromium-galaxys24',
  'webkit-ipadpro11',
])

test('pwa shell includes manifest and Apple web app metadata', async ({
  page,
}) => {
  await primeStorage(page)
  await page.goto('/')

  await expect(
    page.locator('link[rel="manifest"][href="/manifest.json"]'),
  ).toHaveCount(1)
  await expect(
    page.locator('meta[name="mobile-web-app-capable"][content="yes"]'),
  ).toHaveCount(1)
  await expect(
    page.locator('meta[name="apple-mobile-web-app-capable"][content="yes"]'),
  ).toHaveCount(1)
  await expect(
    page.locator(
      'meta[name="apple-mobile-web-app-status-bar-style"][content="black-translucent"]',
    ),
  ).toHaveCount(1)
  await expect(
    page.locator('meta[name="viewport"][content*="viewport-fit=cover"]'),
  ).toHaveCount(1)

  const manifest = await page.evaluate(async () => {
    const response = await fetch('/manifest.json')
    return response.json() as Promise<{
      display: string
      name: string
      short_name: string
      theme_color: string
      icons?: Array<{
        src: string
        sizes?: string
        type?: string
        purpose?: string
      }>
    }>
  })

  expect(manifest.name).toBe('Tsuki Reader')
  expect(manifest.short_name).toBe('Tsuki')
  expect(manifest.display).toBe('standalone')
  expect(manifest.theme_color).toBe('#1d140d')
  expect(Array.isArray(manifest.icons)).toBe(true)
  expect(manifest.icons?.some((icon) => icon.src === '/icon-192.png')).toBe(
    true,
  )
  expect(manifest.icons?.some((icon) => icon.src === '/icon-512.png')).toBe(
    true,
  )

  const iconChecks = await page.evaluate(async () => {
    const iconPaths = ['/icon-192.png', '/icon-512.png', '/apple-touch-icon.png']
    const responses = await Promise.all(
      iconPaths.map(async (path) => {
        const response = await fetch(path)
        return {
          path,
          ok: response.ok,
          contentType: response.headers.get('content-type') || '',
        }
      }),
    )
    return responses
  })

  iconChecks.forEach((result) => {
    expect(result.ok).toBe(true)
    expect(result.contentType).toContain('image/png')
  })
})

test('standalone detection path updates html dataset flag', async ({
  page,
  browser,
}) => {
  await primeStorage(page)
  await page.goto('/')

  await expect
    .poll(async () => {
      return page.evaluate(() => document.documentElement.dataset.standalone)
    })
    .toMatch(/^(true|false)$/)

  const standaloneContext = await browser.newContext()
  const standalonePage = await standaloneContext.newPage()

  await standalonePage.addInitScript(() => {
    try {
      Object.defineProperty(navigator, 'standalone', {
        configurable: true,
        get: () => true,
      })
    } catch {
      // Ignore override failures in engines where this property is immutable.
    }
  })

  await standalonePage.goto('/')
  await expect
    .poll(async () => {
      return standalonePage.evaluate(
        () => document.documentElement.dataset.standalone,
      )
    })
    .toBe('true')

  await standaloneContext.close()
})

test('mobile safe-area anchored reader controls remain visible', async ({
  page,
}, testInfo) => {
  test.skip(
    !MOBILE_PROJECTS.has(testInfo.project.name),
    'Safe-area visibility check is mobile-only.',
  )

  await primeStorage(page)
  await openLocalReader(page)

  const settingsHeader = page.getByText('Settings').first()
  await expect(settingsHeader).toBeVisible()
  const viewport = page.viewportSize()
  const settingsBox = await settingsHeader.boundingBox()

  expect(viewport).not.toBeNull()
  expect(settingsBox).not.toBeNull()

  if (!viewport || !settingsBox) {
    return
  }

  expect(settingsBox.y).toBeGreaterThanOrEqual(0)
  expect(settingsBox.y + settingsBox.height).toBeLessThanOrEqual(
    viewport.height,
  )

  const readerContainer = page.getByTestId('reader-paging-container').first()
  await readerContainer.scrollIntoViewIfNeeded()

  const bottomPageIndicator = page.locator('.ui-bottom-safe-offset').first()
  await expect(bottomPageIndicator).toBeVisible()
  const indicatorBox = await bottomPageIndicator.boundingBox()
  expect(indicatorBox).not.toBeNull()

  if (!indicatorBox) {
    return
  }

  expect(indicatorBox.y).toBeGreaterThanOrEqual(0)
  expect(indicatorBox.y + indicatorBox.height).toBeLessThanOrEqual(
    viewport.height,
  )
})
