import { expect, test, type Page } from '@playwright/test'

import {
  ensureSingleMode,
  openLocalReader,
  primeStorage,
  rewindToFirstPage,
} from './helpers'

const VISUAL_PROJECTS = new Set(['chromium-desktop'])
const VISUAL_ENABLED = process.env.VISUAL_REGRESSION === '1'

test.skip(!VISUAL_ENABLED, 'Visual suite only runs when VISUAL_REGRESSION=1.')

async function openReaderForSnapshot(
  page: Page,
  theme: 'light' | 'dark' | 'paper' = 'light',
) {
  await primeStorage(page, theme)
  await openLocalReader(page)
  await ensureSingleMode(page)
  await rewindToFirstPage(page)
  await expect(page.getByTestId('reader-page-container').first()).toBeVisible()
  await page.waitForTimeout(150)
}

async function setMode(page: Page, mode: 'single' | 'double') {
  const buttonLabel = mode === 'single' ? 'Single' : 'Double'
  const modeButtons = page.getByRole('button', { name: buttonLabel })

  if (
    (await modeButtons.count()) > 0 &&
    (await modeButtons.first().isVisible())
  ) {
    await modeButtons.first().click()
    return
  }

  const modeSelect = page.getByRole('combobox').first()
  await modeSelect.selectOption(mode)
}

async function expectReaderSnapshot(page: Page, name: string) {
  await expect(page).toHaveScreenshot(name, {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixelRatio: 0.02,
  })
}

test.beforeEach(async ({}, testInfo) => {
  test.skip(
    !VISUAL_PROJECTS.has(testInfo.project.name),
    'Visual snapshots run on the desktop baseline project only.',
  )
})

test('reader single-page baseline', async ({ page }) => {
  await openReaderForSnapshot(page, 'light')
  await setMode(page, 'single')
  await expectReaderSnapshot(page, 'reader-single.png')
})

test('reader double-page baseline', async ({ page }) => {
  await openReaderForSnapshot(page, 'light')
  await setMode(page, 'double')
  await page.waitForTimeout(150)
  await expectReaderSnapshot(page, 'reader-double.png')
})

test('reader settings panel expanded baseline', async ({ page }) => {
  await openReaderForSnapshot(page, 'light')

  const settingsTitle = page.getByRole('button', { name: 'Basics' })
  const hasVisibleSettings =
    (await settingsTitle.count()) > 0 &&
    (await settingsTitle.isVisible().catch(() => false))

  if (!hasVisibleSettings) {
    await page.keyboard.press('KeyS')
    await expect(settingsTitle).toBeVisible()
  }

  await expect(settingsTitle).toBeVisible()
  await expectReaderSnapshot(page, 'reader-settings-expanded.png')
})

test('reader boundary notice baseline', async ({ page }) => {
  await openReaderForSnapshot(page, 'light')
  await setMode(page, 'single')
  await rewindToFirstPage(page)

  const previousPageButton = page.getByRole('button', { name: 'Previous page' })
  await previousPageButton.first().evaluate((node: HTMLElement) => {
    node.click()
  })
  await expect(page.getByText(/At first page/i)).toBeVisible()
  await expectReaderSnapshot(page, 'reader-boundary-notice.png')
})

for (const theme of ['light', 'dark', 'paper'] as const) {
  test(`reader theme baseline ${theme}`, async ({ page }) => {
    await openReaderForSnapshot(page, theme)
    await setMode(page, 'single')
    await expectReaderSnapshot(page, `reader-theme-${theme}.png`)
  })
}
