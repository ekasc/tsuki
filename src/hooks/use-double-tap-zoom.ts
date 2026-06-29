/**
 * useDoubleTapZoom — detect double-tap gestures for toggling zoom levels.
 *
 * Best-in-class manga readers support double-tap to toggle between
 * fit-to-screen and actual-pixel-size. This hook detects a double-tap
 * within a 300ms window and calls the provided zoom callback.
 */

import { useCallback, useRef } from 'react'

export interface DoubleTapConfig {
  /** Maximum time between taps to count as a double-tap (ms). Default 300ms. */
  maxIntervalMs?: number
  /** Maximum pixel distance between taps to count as a double-tap. Default 30px. */
  maxDistancePx?: number
}

const DEFAULT_CONFIG: Required<DoubleTapConfig> = {
  maxIntervalMs: 300,
  maxDistancePx: 30,
}

export function useDoubleTapZoom(
  onZoomToggle: () => void,
  config: DoubleTapConfig = {},
) {
  const { maxIntervalMs, maxDistancePx } = { ...DEFAULT_CONFIG, ...config }
  const lastTapRef = useRef<{ x: number; y: number; time: number } | null>(
    null,
  )

  const handleTap = useCallback(
    (x: number, y: number) => {
      const now = Date.now()
      const last = lastTapRef.current

      if (last) {
        const elapsed = now - last.time
        const distance = Math.sqrt(
          (x - last.x) ** 2 + (y - last.y) ** 2,
        )

        if (elapsed <= maxIntervalMs && distance <= maxDistancePx) {
          // Double-tap detected
          lastTapRef.current = null
          onZoomToggle()
          return true
        }
      }

      lastTapRef.current = { x, y, time: now }

      // Clear the last tap after the interval expires
      setTimeout(() => {
        if (
          lastTapRef.current &&
          lastTapRef.current.x === x &&
          lastTapRef.current.y === y
        ) {
          lastTapRef.current = null
        }
      }, maxIntervalMs)

      return false
    },
    [onZoomToggle, maxIntervalMs, maxDistancePx],
  )

  return { handleTap }
}
