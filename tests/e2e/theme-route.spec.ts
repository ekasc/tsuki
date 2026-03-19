import { expect, test, type Page } from '@playwright/test'

import { primeStorage, resolveDemoSeriesId } from './helpers'

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

  const demoSeriesId = await resolveDemoSeriesId(page)
  await page.goto(`/series/${demoSeriesId}`)
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
  await primeStorage(page, 'ocean-dark')
  await page.goto('/')
  await expectTheme(page, 'ocean-dark')

  const demoSeriesId = await resolveDemoSeriesId(page)

  for (let index = 0; index < 4; index += 1) {
    await page.goto(`/series/${demoSeriesId}`)
    await expectTheme(page, 'ocean-dark')
    await page.waitForTimeout(80)
    await expectTheme(page, 'ocean-dark')

    await page.goto('/')
    await expectTheme(page, 'ocean-dark')
    await page.waitForTimeout(80)
    await expectTheme(page, 'ocean-dark')
  }
})
