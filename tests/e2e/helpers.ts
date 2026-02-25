import { expect, type Page } from '@playwright/test'

export const DEMO_SERIES_ID = 'Li8ezNK4gAuHoCPzk3yuA'
export type ThemeMode = 'light' | 'dark' | 'paper'

export async function primeStorage(page: Page, theme?: ThemeMode) {
  await page.addInitScript(
    ({ selectedTheme }) => {
      window.localStorage.clear()
      window.sessionStorage.clear()

      if (selectedTheme) {
        window.localStorage.setItem('tsuki-theme-mode.v1', selectedTheme)
      }
    },
    { selectedTheme: theme ?? null },
  )
}

export async function openLocalReader(page: Page) {
  await page.goto('/')
  await page.goto(`/series/${DEMO_SERIES_ID}`)

  await expect(
    page.getByRole('heading', { name: 'Suki Demo Anthology' }),
  ).toBeVisible()
  await page
    .getByRole('link', { name: /Chapter/i })
    .first()
    .click()
  await expect(page.getByTestId('reader-paging-container')).toBeVisible()
}

export async function ensureSingleMode(page: Page) {
  const singleButtons = page.getByRole('button', { name: 'Single' })
  if (
    (await singleButtons.count()) > 0 &&
    (await singleButtons.first().isVisible())
  ) {
    await singleButtons.first().click()
    return
  }

  const combos = page.getByRole('combobox')
  if ((await combos.count()) > 0 && (await combos.first().isVisible())) {
    await combos.first().selectOption('single')
  }
}

export async function readPositionLabel(page: Page): Promise<string> {
  return page.getByTestId('position-label').innerText()
}

export async function readCurrentPageNumber(page: Page): Promise<number> {
  const text = await readPositionLabel(page)
  const match = text.match(/(?:Page|Spread)\s+(\d+)/)

  if (!match) {
    throw new Error(`Could not parse page number from label: ${text}`)
  }

  return Number.parseInt(match[1], 10)
}

export async function rewindToFirstPage(page: Page) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const current = await readCurrentPageNumber(page)
    if (current <= 1) {
      return
    }

    const previousButtons = page.getByRole('button', { name: 'Previous page' })
    if (
      (await previousButtons.count()) > 0 &&
      (await previousButtons.first().isVisible())
    ) {
      await previousButtons.first().evaluate((node: HTMLElement) => {
        node.click()
      })
    } else {
      await page.keyboard.press('ArrowRight')
    }

    await page.waitForTimeout(150)
  }
}

export async function tapReaderSide(page: Page, side: 'left' | 'right') {
  const container = page.getByTestId('reader-paging-container').first()
  const box = await container.boundingBox()

  if (!box) {
    throw new Error('Reader paging container is not visible')
  }

  const x =
    side === 'left' ? box.x + box.width * 0.15 : box.x + box.width * 0.85
  const y = box.y + box.height * 0.5
  await page.touchscreen.tap(Math.round(x), Math.round(y))
}
