import { describe, expect, it } from 'vitest'
import {
  buildTwoPageSteps,
  DEFAULT_SPREAD_CONFIG,
  findStepIndexByPageIndex,
  inferAutoSpreadFlags,
  type PairingPage,
} from './pairing'

function page(
  index: number,
  options: Partial<Omit<PairingPage, 'index'>> = {},
): PairingPage {
  return {
    index,
    width: 1200,
    height: 1800,
    autoIsSpread: false,
    splitSpread: null,
    ...options,
  }
}

describe('inferAutoSpreadFlags', () => {
  it('marks pages wider than single-page median width as spreads', () => {
    const spreads = inferAutoSpreadFlags([
      { width: 1200, height: 1800 },
      { width: 1200, height: 1800 },
      { width: 2600, height: 1700 },
    ])

    expect(spreads).toEqual([false, false, true])
  })

  it('does not mark near-equal portrait pages as spreads', () => {
    const spreads = inferAutoSpreadFlags([
      { width: 1200, height: 1800 },
      { width: 1210, height: 1800 },
      { width: 1220, height: 1800 },
    ])

    expect(spreads).toEqual([false, false, false])
  })

  it('marks landscape pages as spreads', () => {
    const spreads = inferAutoSpreadFlags([
      { width: 1200, height: 1800 },
      { width: 2100, height: 1500 },
      { width: 1180, height: 1800 },
    ])

    expect(spreads).toEqual([false, true, false])
  })
})

describe('buildTwoPageSteps', () => {
  it('handles spread at i by showing page alone', () => {
    const steps = buildTwoPageSteps([
      page(0, { autoIsSpread: true }),
      page(1),
      page(2),
    ])

    expect(steps.map((step) => step.kind)).toEqual(['single', 'pair'])
    expect(steps[0]?.units).toHaveLength(1)
    expect(steps[1]?.units).toHaveLength(2)
  })

  it('handles spread at i+1 by not pairing current with spread', () => {
    const steps = buildTwoPageSteps([
      page(0),
      page(1, { autoIsSpread: true }),
      page(2),
    ])

    expect(
      steps.map((step) => step.units.map((unit) => unit.pageIndex)),
    ).toEqual([[0], [1], [2]])
  })

  it('handles last page as single', () => {
    const steps = buildTwoPageSteps([page(0), page(1), page(2)])

    expect(
      steps.map((step) => step.units.map((unit) => unit.pageIndex)),
    ).toEqual([[0, 1], [2]])
  })

  it('handles consecutive spreads as singles', () => {
    const steps = buildTwoPageSteps([
      page(0, { autoIsSpread: true }),
      page(1, { autoIsSpread: true }),
      page(2),
      page(3),
    ])

    expect(
      steps.map((step) => step.units.map((unit) => unit.pageIndex)),
    ).toEqual([[0], [1], [2, 3]])
  })

  it('renders exactly two halves for split-spread mode', () => {
    const steps = buildTwoPageSteps([
      page(0, { autoIsSpread: true, splitSpread: true }),
      page(1),
      page(2),
    ])

    expect(steps[0]?.kind).toBe('split-spread')
    expect(steps[0]?.units).toHaveLength(2)
    expect(steps[0]?.units.every((unit) => unit.type === 'half')).toBe(true)
  })

  it('never renders three pages in a single step', () => {
    const steps = buildTwoPageSteps([
      page(0),
      page(1),
      page(2, { autoIsSpread: true }),
      page(3),
      page(4),
      page(5, { autoIsSpread: true, splitSpread: true }),
    ])

    expect(steps.every((step) => step.units.length <= 2)).toBe(true)
  })
})

describe('findStepIndexByPageIndex', () => {
  it('finds step by page index and defaults to zero', () => {
    const steps = buildTwoPageSteps([page(0), page(1), page(2)], {
      ...DEFAULT_SPREAD_CONFIG,
    })

    expect(findStepIndexByPageIndex(steps, 2)).toBe(1)
    expect(findStepIndexByPageIndex(steps, 99)).toBe(0)
  })
})
