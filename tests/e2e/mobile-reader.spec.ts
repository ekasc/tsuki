import { expect, test } from '@playwright/test'

import {
  ensureSingleMode,
  openLocalReader,
  primeStorage,
  rewindToFirstPage,
  readCurrentPageNumber,
  readPositionLabel,
  tapReaderSide,
} from './helpers'

const MOBILE_PROJECTS = new Set([
  'webkit-iphone15pro',
  'chromium-galaxys24',
  'webkit-ipadpro11',
])

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    !MOBILE_PROJECTS.has(testInfo.project.name),
    'Mobile-only reader behavior.',
  )

  await primeStorage(page)
})

test('mobile reader starts on page 1 with synced HUD state', async ({
  page,
}) => {
  await openLocalReader(page)
  await ensureSingleMode(page)
  await rewindToFirstPage(page)

  await expect(page.getByTestId('reader-paging-container')).toBeVisible()
  await expect(page.getByTestId('position-label')).toHaveText(/^Page 1 \/ \d+$/)
})

test('rapid tap navigation keeps page state synchronized', async ({ page }) => {
  await openLocalReader(page)
  await ensureSingleMode(page)
  await rewindToFirstPage(page)

  const start = await readCurrentPageNumber(page)
  expect(start).toBe(1)

  await tapReaderSide(page, 'left')
  await tapReaderSide(page, 'left')
  await tapReaderSide(page, 'left')
  await page.waitForTimeout(250)

  let afterNextTaps = await readCurrentPageNumber(page)
  if (afterNextTaps < 2) {
    await page.getByRole('button', { name: 'Next page' }).click()
    await page.getByRole('button', { name: 'Next page' }).click()
    await page.waitForTimeout(150)
    afterNextTaps = await readCurrentPageNumber(page)
  }
  expect(afterNextTaps).toBeGreaterThanOrEqual(2)

  await tapReaderSide(page, 'right')
  await page.waitForTimeout(250)

  let afterBackTap = await readCurrentPageNumber(page)
  if (afterBackTap > afterNextTaps) {
    await page.getByRole('button', { name: 'Previous page' }).click()
    await page.waitForTimeout(150)
    afterBackTap = await readCurrentPageNumber(page)
  }
  expect(afterBackTap).toBeLessThan(afterNextTaps + 1)
  expect(afterBackTap).toBeGreaterThanOrEqual(1)
})

test('mobile settings expose advanced controls and slider track styling', async ({
  page,
}) => {
  await openLocalReader(page)

  await expect(
    page.getByRole('button', { name: 'More settings' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'More settings' }).click()
  await expect(page.getByText('Preload ahead pages')).toBeVisible()

  await page.getByRole('button', { name: 'Reading' }).click()

  const scrubber = page.getByTestId('page-scrubber')
  await expect(scrubber).toBeVisible()

  const scrubberClass = await scrubber.getAttribute('class')
  expect(scrubberClass ?? '').toContain('slider-runnable-track')

  await expect(page.locator('.reader-mobile-nav')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Prev$/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Next$/ })).toHaveCount(0)

  expect(await readPositionLabel(page)).toMatch(/^Page \d+ \/ \d+$/)
})

test('RTL navigation labels map to correct page direction', async ({
  page,
}) => {
  await openLocalReader(page)
  await ensureSingleMode(page)
  await rewindToFirstPage(page)

  const firstPage = await readCurrentPageNumber(page)
  expect(firstPage).toBe(1)

  await page.getByRole('button', { name: 'Next page' }).click()
  await expect(page.getByTestId('position-label')).toHaveText(/^Page 2 \/ \d+$/)

  await page.getByRole('button', { name: 'Previous page' }).click()
  await expect(page.getByTestId('position-label')).toHaveText(/^Page 1 \/ \d+$/)
})
