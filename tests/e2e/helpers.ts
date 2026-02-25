import { expect, type Page } from '@playwright/test'

export type ThemeMode = 'light' | 'dark' | 'paper'

interface LibrarySeriesRecord {
  id: string
  source: string
  title: string
}

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

export async function resolveDemoSeriesId(page: Page): Promise<string> {
  const librarySeries = await page.evaluate(async () => {
    const response = await fetch('/api/series')
    if (!response.ok) {
      throw new Error(`Failed to fetch /api/series (${response.status})`)
    }

    return (await response.json()) as LibrarySeriesRecord[]
  })

  const demoSeries = librarySeries.find((entry) => entry.source === 'demo')
  if (!demoSeries?.id) {
    throw new Error('Could not resolve demo series id from /api/series')
  }

  return demoSeries.id
}

export async function openDemoSeries(page: Page): Promise<string> {
  await page.goto('/')
  const demoSeriesId = await resolveDemoSeriesId(page)
  await page.goto(`/series/${demoSeriesId}`)

  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByRole('link', { name: /Chapter/i }).first()).toBeVisible()

  return demoSeriesId
}

export async function openLocalReader(page: Page) {
  await openDemoSeries(page)
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
