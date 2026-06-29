import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { VelocityTracker } from './velocity-tracker'

describe('VelocityTracker', () => {
  let tracker: VelocityTracker
  let now = 1_000_000_000_000

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    tracker = new VelocityTracker()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function tick(ms: number) {
    now += ms
    vi.setSystemTime(now)
  }

  it('returns stationary when no page changes recorded', () => {
    const v = tracker.getVelocity()
    expect(v.velocity).toBe('stationary')
    expect(v.pagesPerSecond).toBe(0)
    expect(v.suggestedLookahead).toBe(2)
    expect(v.suggestedConcurrency).toBe(1)
  })

  it('classifies slow reading correctly', () => {
    // 1 page every 5 seconds = 0.2 pages/sec → 'slow'
    tracker.recordPageChange(0)
    tick(5000)
    tracker.recordPageChange(1)
    tick(5000)
    tracker.recordPageChange(2)
    tick(5000)
    tracker.recordPageChange(3)

    const v = tracker.getVelocity()
    expect(v.velocity).toBe('slow')
    expect(v.pagesPerSecond).toBeGreaterThan(0.15)
    expect(v.pagesPerSecond).toBeLessThan(0.25)
    expect(v.suggestedLookahead).toBe(4)
    expect(v.suggestedConcurrency).toBe(1)
  })

  it('classifies normal reading correctly', () => {
    // 1 page every second = 1 pages/sec → 'normal'
    tracker.recordPageChange(0)
    tick(1000)
    tracker.recordPageChange(1)
    tick(1000)
    tracker.recordPageChange(2)
    tick(1000)
    tracker.recordPageChange(3)

    const v = tracker.getVelocity()
    expect(v.velocity).toBe('normal')
    expect(v.pagesPerSecond).toBeGreaterThan(0.8)
    expect(v.pagesPerSecond).toBeLessThan(1.2)
    expect(v.suggestedLookahead).toBe(8)
    expect(v.suggestedConcurrency).toBe(2)
  })

  it('classifies fast reading correctly', () => {
    // 1 page every 300ms ≈ 3.3 pages/sec → 'fast'
    tracker.recordPageChange(0)
    tick(300)
    tracker.recordPageChange(1)
    tick(300)
    tracker.recordPageChange(2)
    tick(300)
    tracker.recordPageChange(3)

    const v = tracker.getVelocity()
    expect(v.velocity).toBe('fast')
    expect(v.pagesPerSecond).toBeGreaterThan(2.0)
    expect(v.suggestedLookahead).toBe(16)
    expect(v.suggestedConcurrency).toBe(4)
  })

  it('classifies speed reading correctly', () => {
    // 1 page every 100ms = 10 pages/sec → 'speed'
    tracker.recordPageChange(0)
    tick(100)
    tracker.recordPageChange(1)
    tick(100)
    tracker.recordPageChange(2)
    tick(100)
    tracker.recordPageChange(3)

    const v = tracker.getVelocity()
    expect(v.velocity).toBe('speed')
    expect(v.pagesPerSecond).toBeGreaterThan(5.0)
    expect(v.suggestedLookahead).toBe(24)
    expect(v.suggestedConcurrency).toBe(6)
  })

  it('detects idle state after 10 seconds without activity', () => {
    tracker.recordPageChange(0)
    tick(1000)
    tracker.recordPageChange(1)

    // "normal" initially
    expect(tracker.getVelocity().isIdle).toBe(false)

    tick(11_000) // idle timeout exceeded

    expect(tracker.getVelocity().isIdle).toBe(true)
    expect(tracker.getVelocity().velocity).toBe('stationary')
  })

  it('resets correctly', () => {
    tracker.recordPageChange(0)
    tick(100)
    tracker.recordPageChange(1)

    expect(tracker.getVelocity().velocity).not.toBe('stationary')

    tracker.reset()
    expect(tracker.getVelocity().velocity).toBe('stationary')
    expect(tracker.lastSample).toBeNull()
  })

  it('debounces with lastSample', () => {
    tracker.recordPageChange(5)
    expect(tracker.lastSample?.pageIndex).toBe(5)
    expect(tracker.lastSample?.timestamp).toBe(now)

    tick(500)
    tracker.recordPageChange(5) // Same page, different time
    expect(tracker.lastSample?.pageIndex).toBe(5)
  })

  it('handles backward navigation gracefully', () => {
    tracker.recordPageChange(10)
    tick(500)
    tracker.recordPageChange(9) // going back
    tick(500)
    tracker.recordPageChange(8) // going back
    tick(500)
    tracker.recordPageChange(7) // going back

    const v = tracker.getVelocity()
    // 3 pages backward over 1500ms = 2 pages/sec → 'fast'
    expect(v.velocity).toBe('fast')
  })

  it('prunes stale samples outside the 15-second window', () => {
    // Add old samples
    tracker.recordPageChange(0)
    tick(12_000)
    tracker.recordPageChange(1)

    // Should still have velocity
    expect(tracker.getVelocity().velocity).not.toBe('stationary')

    tick(12_000) // total elapsed > 15s from first sample

    // After enough idle + pruning, velocity should drop
    tracker.recordPageChange(2) // triggers pruning
    const v = tracker.getVelocity()
    expect(v.velocity).not.toBe('stationary')
  })
})
