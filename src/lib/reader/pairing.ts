export interface SpreadHeuristicConfig {
  widthMultiplier: number
}

export const DEFAULT_SPREAD_CONFIG: SpreadHeuristicConfig = {
  widthMultiplier: 1,
}

export interface PairingPage {
  index: number
  width: number
  height: number
  autoIsSpread: boolean
  splitSpread: boolean | null
}

export type RenderUnit =
  | {
      type: 'page'
      pageIndex: number
    }
  | {
      type: 'half'
      pageIndex: number
      half: 'left' | 'right'
    }

export interface PairingStep {
  kind: 'single' | 'pair' | 'split-spread'
  anchorPageIndex: number
  units: RenderUnit[]
}

function safeWidth(width: number): number {
  if (width <= 0) {
    return 1
  }

  return width
}

export function median(values: number[]): number {
  if (values.length === 0) {
    return 1
  }

  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)

  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1]! + sorted[middle]!) / 2
  }

  return sorted[middle]!
}

export function inferAutoSpreadFlags(
  pages: Pick<PairingPage, 'width' | 'height'>[],
  config: SpreadHeuristicConfig = DEFAULT_SPREAD_CONFIG,
): boolean[] {
  const widths = pages.map((page) => safeWidth(page.width))
  const heights = pages.map((page) => safeWidth(page.height))
  const aspects = widths.map((width, index) => width / heights[index]!)

  const portraitWidths = widths.filter((_, index) => aspects[index]! < 0.95)
  const baselineWidth = median(
    portraitWidths.length > 0 ? portraitWidths : widths,
  )
  const medianWidth = baselineWidth
  const thresholdWidth = medianWidth * config.widthMultiplier

  const widthTolerance = 1.06

  return widths.map((width, index) => {
    const aspect = aspects[index]!
    const landscapeSpread = aspect >= 0.95
    const widerThanSingle = width > thresholdWidth * widthTolerance

    return landscapeSpread || widerThanSingle
  })
}

export function buildTwoPageSteps(
  pages: PairingPage[],
  config: SpreadHeuristicConfig = DEFAULT_SPREAD_CONFIG,
): PairingStep[] {
  if (pages.length === 0) {
    return []
  }

  const inferredSpreadFlags = inferAutoSpreadFlags(
    pages.map((page) => ({ width: page.width, height: page.height })),
    config,
  )

  const steps: PairingStep[] = []
  let index = 0

  while (index < pages.length) {
    const current = pages[index]!
    const currentIsSpread = current.autoIsSpread || inferredSpreadFlags[index]

    if (currentIsSpread) {
      if (current.splitSpread) {
        steps.push({
          kind: 'split-spread',
          anchorPageIndex: current.index,
          units: [
            {
              type: 'half',
              pageIndex: current.index,
              half: 'left',
            },
            {
              type: 'half',
              pageIndex: current.index,
              half: 'right',
            },
          ],
        })
      } else {
        steps.push({
          kind: 'single',
          anchorPageIndex: current.index,
          units: [
            {
              type: 'page',
              pageIndex: current.index,
            },
          ],
        })
      }

      index += 1
      continue
    }

    const next = pages[index + 1]

    if (!next) {
      steps.push({
        kind: 'single',
        anchorPageIndex: current.index,
        units: [
          {
            type: 'page',
            pageIndex: current.index,
          },
        ],
      })
      index += 1
      continue
    }

    const nextIsSpread = next.autoIsSpread || inferredSpreadFlags[index + 1]

    if (nextIsSpread) {
      steps.push({
        kind: 'single',
        anchorPageIndex: current.index,
        units: [
          {
            type: 'page',
            pageIndex: current.index,
          },
        ],
      })
      index += 1
      continue
    }

    steps.push({
      kind: 'pair',
      anchorPageIndex: current.index,
      units: [
        {
          type: 'page',
          pageIndex: current.index,
        },
        {
          type: 'page',
          pageIndex: next.index,
        },
      ],
    })

    index += 2
  }

  return steps
}

export function findStepIndexByPageIndex(
  steps: PairingStep[],
  pageIndex: number,
): number {
  const found = steps.findIndex((step) =>
    step.units.some((unit) => unit.pageIndex === pageIndex),
  )

  return found >= 0 ? found : 0
}
