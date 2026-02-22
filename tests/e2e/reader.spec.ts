import { expect, test, type Page } from '@playwright/test'

async function rewindToStart(page: Page) {
  for (let index = 0; index < 8; index += 1) {
    await page.getByTestId('nav-prev').click()
  }
}

test('library to reader flow works', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByText('Suki Demo Anthology')).toBeVisible()
  await page
    .locator('article')
    .filter({ hasText: 'Suki Demo Anthology' })
    .getByRole('link', { name: 'Open' })
    .click()

  await expect(
    page.getByRole('heading', { name: 'Suki Demo Anthology' }),
  ).toBeVisible()
  await page.getByRole('link', { name: 'Read Chapter' }).first().click()

  await expect(
    page.getByRole('heading', { name: /Chapter 1 - Welcome Grid/i }),
  ).toBeVisible()
  await expect(page.getByTestId('reader-paging-container')).toBeVisible()
  await page.getByTestId('mode-single').click()
  await rewindToStart(page)

  await page.getByLabel('left-arrow').click()
  await expect(page.getByTestId('position-label')).toHaveText(/^Page 2 \/ \d+$/)
  await page.getByLabel('right-zone').click()
  await expect(page.getByTestId('position-label')).toHaveText(/^Page 1 \/ \d+$/)
  await page.getByLabel('left-zone').click()
  await expect(page.getByTestId('position-label')).toHaveText(/^Page 2 \/ \d+$/)
  await page.waitForTimeout(450)
  await page.reload()
  await expect(page.getByTestId('position-label')).toHaveText(/^Page 2 \/ \d+$/)
})

test('two-page mode never renders more than two containers', async ({
  page,
}) => {
  await page.goto('/')
  await page
    .locator('article')
    .filter({ hasText: 'Suki Demo Anthology' })
    .getByRole('link', { name: 'Open' })
    .click()
  await page.getByRole('link', { name: 'Read Chapter' }).first().click()

  await page.getByTestId('mode-single').click()
  await rewindToStart(page)
  await page.getByTestId('mode-double').click()

  for (let index = 0; index < 3; index += 1) {
    const count = await page.getByTestId('reader-page-container').count()
    expect(count).toBeGreaterThanOrEqual(1)
    expect(count).toBeLessThanOrEqual(2)

    await page.getByTestId('nav-next').click()
  }
})

test('split spread renders exactly two halves', async ({ page }) => {
  await page.goto('/')
  await page
    .locator('article')
    .filter({ hasText: 'Suki Demo Anthology' })
    .getByRole('link', { name: 'Open' })
    .click()

  await page.getByRole('link', { name: 'Read Chapter' }).nth(1).click()
  await page.getByTestId('mode-single').click()
  await rewindToStart(page)
  await page.getByTestId('mode-double').click()
  await page.getByTestId('nav-next').click()

  await expect(page.getByTestId('reader-page-container')).toHaveCount(2)
  await expect(page.getByAltText(/left half/i)).toBeVisible()
  await expect(page.getByAltText(/right half/i)).toBeVisible()
})

test('navigating past final page opens next chapter', async ({ page }) => {
  await page.goto('/')
  await page
    .locator('article')
    .filter({ hasText: 'Suki Demo Anthology' })
    .getByRole('link', { name: 'Open' })
    .click()

  await page.getByRole('link', { name: 'Read Chapter' }).first().click()
  await page.getByTestId('mode-single').click()
  await rewindToStart(page)

  for (let index = 0; index < 6; index += 1) {
    await page.getByTestId('nav-next').click()
  }

  await expect(
    page.getByRole('heading', { name: /Chapter 2 - Split Candidate/i }),
  ).toBeVisible()
})
