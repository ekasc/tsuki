import { expect, test, type Page } from '@playwright/test'

import { DEMO_SERIES_ID, primeStorage } from './helpers'

async function expectTheme(page: Page, theme: string) {
  await expect
    .poll(async () => {
      return page.evaluate(() =>
        document.documentElement.getAttribute('data-theme'),
      )
    })
    .toBe(theme)
}

test('theme preference persists across route transitions', async ({ page }) => {
  await primeStorage(page, 'dark')
  await page.goto('/')
  await expectTheme(page, 'dark')

  await page.goto(`/series/${DEMO_SERIES_ID}`)
  await expectTheme(page, 'dark')

  await page
    .getByRole('link', { name: /Chapter/i })
    .first()
    .click()
  await expectTheme(page, 'dark')

  await page.goto('/')
  await expectTheme(page, 'dark')
})

test('theme remains stable while switching routes quickly', async ({
  page,
}) => {
  await primeStorage(page, 'paper')
  await page.goto('/')
  await expectTheme(page, 'paper')

  for (let index = 0; index < 4; index += 1) {
    await page.goto(`/series/${DEMO_SERIES_ID}`)
    await expectTheme(page, 'paper')
    await page.waitForTimeout(80)
    await expectTheme(page, 'paper')

    await page.goto('/')
    await expectTheme(page, 'paper')
    await page.waitForTimeout(80)
    await expectTheme(page, 'paper')
  }
})
