import { expect, test, type Page } from '@playwright/test'
import { openDemoSeries } from './helpers'

async function rewindToStart(page: Page) {
  let attempts = 0
  while (attempts < 10) {
    const text = await page
      .getByTestId('position-label')
      .innerText()
      .catch(() => '')
    if (text.startsWith('Page 1 /') || text.startsWith('Spread 1 /')) {
      break
    }
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(200)
    attempts++
  }
}

test.beforeEach(async ({}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    'Desktop-only keyboard and combobox behavior.',
  )
})

test('library to reader flow works', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.removeItem('tsuki-history.v1'))
  await openDemoSeries(page)
  await page
    .getByRole('link', { name: /Chapter/i })
    .first()
    .click()

  await expect(page.getByText('Ch 1 · 5p')).toBeVisible()
  await expect(page.getByTestId('reader-paging-container')).toBeVisible()
  await page.mouse.move(100, 100)
  await page.getByRole('combobox').first().selectOption('single')
  await rewindToStart(page)

  await page.keyboard.press('ArrowLeft')
  await expect(page.getByTestId('position-label')).toHaveText(/^Page 2 \/ \d+$/)
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('position-label')).toHaveText(/^Page 1 \/ \d+$/)
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByTestId('position-label')).toHaveText(/^Page 2 \/ \d+$/)
  await page.waitForTimeout(450)
  await page.reload()
  await expect(page.getByTestId('position-label')).toHaveText(/^Page 2 \/ \d+$/)
})

test('two-page mode never renders more than two containers', async ({
  page,
}) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.removeItem('tsuki-history.v1'))
  await openDemoSeries(page)
  await page
    .getByRole('link', { name: /Chapter/i })
    .first()
    .click()

  await page.mouse.move(100, 100)
  await page.getByRole('combobox').first().selectOption('single')
  await rewindToStart(page)

  await page.mouse.move(100, 100)
  await page.getByRole('combobox').first().selectOption('double')

  for (let index = 0; index < 3; index += 1) {
    const count = await page.getByTestId('reader-page-container').count()
    expect(count).toBeGreaterThanOrEqual(1)
    expect(count).toBeLessThanOrEqual(2)

    await page.keyboard.press('ArrowLeft')
  }
})

test('split spread renders exactly two halves', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.removeItem('tsuki-history.v1'))
  await openDemoSeries(page)

  await page
    .getByRole('link', { name: /Chapter/i })
    .nth(1)
    .click()
  await page.mouse.move(100, 100)
  await page.getByRole('combobox').first().selectOption('single')
  await rewindToStart(page)

  await page.mouse.move(100, 100)
  await page.getByRole('combobox').first().selectOption('double')
  await page.keyboard.press('ArrowLeft')

  await expect(page.getByTestId('reader-page-container')).toHaveCount(2)
  await expect(page.getByAltText(/left half/i)).toBeVisible()
  await expect(page.getByAltText(/right half/i)).toBeVisible()
})

test('navigating past final page opens next chapter', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.removeItem('tsuki-history.v1'))
  await openDemoSeries(page)

  await page
    .getByRole('link', { name: /Chapter/i })
    .first()
    .click()
  await page.mouse.move(100, 100)
  await page.getByRole('combobox').first().selectOption('single')
  await rewindToStart(page)

  for (let index = 0; index < 10; index += 1) {
    await page.keyboard.press('ArrowLeft')
    await page.waitForTimeout(200)
  }

  await expect(page.getByText('Ch 2 · 4p')).toBeVisible()
})

test('desktop tap zones disable while magnifier is enabled', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.removeItem('tsuki-history.v1'))
  await openDemoSeries(page)

  await page
    .getByRole('link', { name: /Chapter/i })
    .first()
    .click()
  await page.mouse.move(100, 100)
  await page.getByRole('combobox').first().selectOption('single')
  await rewindToStart(page)

  await expect(page.getByLabel('left-zone')).toHaveCount(1)
  await expect(page.getByLabel('right-zone')).toHaveCount(1)

  await page.keyboard.press('KeyZ')

  await expect(page.getByLabel('left-zone')).toHaveCount(0)
  await expect(page.getByLabel('right-zone')).toHaveCount(0)
})
