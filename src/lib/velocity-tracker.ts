/**
 * VelocityTracker measures reading velocity over a sliding window of page-change
 * events. It exposes a reading-speed classification that can be mapped to
 * prefetch budgets.
 *
 * The fundamental challenge this solves: you can't know how many images to
 * prefetch until you see how fast the user reads. But by the time you have
 * enough velocity data, the warm cache is already partially spent. This tracker
 * adaptively converges on the correct prefetch aggressiveness within ~3 page
 * turns.
 */

export type ReadingVelocity = 'stationary' | 'slow' | 'normal' | 'fast' | 'speed'

export interface VelocitySample {
  pageIndex: number
  timestamp: number
}

export interface VelocityResult {
  /** Human-readable velocity class. */
  velocity: ReadingVelocity
  /** Pages per second (smoothed over the window). */
  pagesPerSecond: number
  /** Whether reading appears to be idle. */
  isIdle: boolean
  /** Recommended lookahead (forward) count. */
  suggestedLookahead: number
  /** Recommended lookbehind (backward) count. */
  suggestedLookbehind: number
  /** Recommended image fetch concurrency. */
  suggestedConcurrency: number
}

/** Window size: number of recent page-change events used for velocity. */
const VELOCITY_WINDOW_SIZE = 5

/** Timestamp window: maximum age of samples to consider (milliseconds). */
const VELOCITY_WINDOW_MS = 15_000

/** If no page change within this threshold, reading is considered idle. */
const IDLE_THRESHOLD_MS = 10_000

/** Minimum samples needed before velocity classification is reliable. */
const MIN_SAMPLES_FOR_VELOCITY = 2

export class VelocityTracker {
  private _samples: VelocitySample[] = []
  private _totalBackwardMoves = 0
  private _totalForwardMoves = 0

  /**
   * Record a page-change event.
   * @param pageIndex The new (absolute) page index.
   */
  recordPageChange(pageIndex: number): void {
    const now = Date.now()

    // Infer direction from last sample
    const last = this._samples[this._samples.length - 1]
    if (last) {
      if (pageIndex > last.pageIndex) {
        this._totalForwardMoves += 1
      } else if (pageIndex < last.pageIndex) {
        this._totalBackwardMoves += 1
      }
    }

    // Prune samples outside the recency window
    this._samples = this._samples.filter(
      (s) => now - s.timestamp <= VELOCITY_WINDOW_MS,
    )

    // Add new sample
    this._samples.push({ pageIndex, timestamp: now })

    // Keep only the most recent N samples
    if (this._samples.length > VELOCITY_WINDOW_SIZE) {
      this._samples = this._samples.slice(
        this._samples.length - VELOCITY_WINDOW_SIZE,
      )
    }
  }

  /**
   * Get the last recorded sample, for debouncing duplicate events.
   */
  get lastSample(): VelocitySample | null {
    return this._samples[this._samples.length - 1] ?? null
  }

  /**
   * Reset the tracker (e.g., on chapter change).
   */
  reset(): void {
    this._samples = []
    this._totalBackwardMoves = 0
    this._totalForwardMoves = 0
  }

  /**
   * Get forward/backward navigation ratio between -1 and 1.
   */
  private getDirectionBias(): number {
    const total = this._totalForwardMoves + this._totalBackwardMoves
    if (total === 0) return 0
    return (this._totalForwardMoves - this._totalBackwardMoves) / total
  }

  /**
   * Get the current velocity snapshot and derived prefetch parameters.
   */
  getVelocity(): VelocityResult {
    const now = Date.now()
    const samples = this._samples

    // === idle detection ===
    const latest = samples[samples.length - 1]
    const isIdle = latest ? now - latest.timestamp > IDLE_THRESHOLD_MS : true

    // === velocity calculation ===
    let pagesPerSecond = 0

    if (samples.length >= MIN_SAMPLES_FOR_VELOCITY) {
      const oldest = samples[0]
      const newest = samples[samples.length - 1]
      const elapsedMs = newest.timestamp - oldest.timestamp

      if (elapsedMs > 0) {
        const pageDelta = Math.abs(newest.pageIndex - oldest.pageIndex)
        pagesPerSecond = pageDelta / (elapsedMs / 1000)
      }
    }

    // === velocity classification ===
    let velocity: ReadingVelocity = 'stationary'

    if (pagesPerSecond > 5.0) {
      velocity = 'speed'
    } else if (pagesPerSecond > 2.0) {
      velocity = 'fast'
    } else if (pagesPerSecond > 0.4) {
      velocity = 'normal'
    } else if (pagesPerSecond > 0.05) {
      velocity = 'slow'
    }

    // Override to stationary when idle regardless of past velocity
    if (isIdle) {
      velocity = 'stationary'
    }

    // === param mapping ===
    const params = this.velocityToParams(velocity)
    const directionBias = this.getDirectionBias()

    // Shift the prefetch window toward the reading direction
    const lookaheadAdjust = Math.round(
      params.lookahead * Math.max(0.15, 0.5 + directionBias * 0.5),
    )
    const lookbehindAdjust = Math.round(
      params.lookbehind * Math.max(0.15, 0.5 - directionBias * 0.5),
    )

    return {
      velocity,
      pagesPerSecond,
      isIdle,
      suggestedLookahead: Math.max(1, lookaheadAdjust),
      suggestedLookbehind: Math.max(0, lookbehindAdjust),
      suggestedConcurrency: params.concurrency,
    }
  }

  private velocityToParams(
    velocity: ReadingVelocity,
  ): { lookahead: number; lookbehind: number; concurrency: number } {
    switch (velocity) {
      case 'speed':
        return { lookahead: 24, lookbehind: 8, concurrency: 6 }
      case 'fast':
        return { lookahead: 16, lookbehind: 6, concurrency: 4 }
      case 'normal':
        return { lookahead: 8, lookbehind: 4, concurrency: 2 }
      case 'slow':
        return { lookahead: 4, lookbehind: 2, concurrency: 1 }
      case 'stationary':
        return { lookahead: 2, lookbehind: 1, concurrency: 1 }
    }
  }
}
