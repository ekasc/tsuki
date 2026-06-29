/**
 * useAdaptivePrefetch — a velocity-aware wrapper for the static image prefetch.
 *
 * The impossible problem it solves:
 *   Static lookahead/lookbehind prefetch budgets can't anticipate the user's
 *   actual reading speed. A reader burning through pages at 5+/sec needs vastly
 *   more warm images than someone lingering on a splash page. But you can't
 *   know the velocity until you've seen the user turn pages — by which point
 *   the prefetch window has been set wrong.
 *
 *   This hook continuously observes page-change events, computes reading
 *   velocity on a sliding window, and adjusts the prefetch aggressiveness
 *   in real-time. It converges on the right budget within ~3 page turns.
 *
 * Usage:
 *   const { onPageChange, currentVelocity } = useAdaptivePrefetch({
 *     chapterId,
 *     totalPages,
 *     currentPageIndex,
 *     enabled: true,
 *   });
 *
 *   // Call onPageChange() on every user-initiated page navigation.
 *   // The hook automatically feeds currentPageIndex changes into the tracker
 *   // and adjusts the prefetch window accordingly.
 */

import { useEffect, useRef, useState } from 'react'
import { useImagePrefetch } from '#/hooks/use-image-prefetch'
import { VelocityTracker, type ReadingVelocity } from '#/lib/velocity-tracker'

export interface AdaptivePrefetchOptions {
  chapterId: string
  totalPages: number
  currentPageIndex: number
  enabled?: boolean
}

export interface AdaptivePrefetchApi {
  /**
   * Call on every user-initiated navigation (tap, swipe, key press).
   */
  onPageChange: (pageIndex: number) => void
  /** Current velocity classification for debugging / UI hints. */
  currentVelocity: ReadingVelocity
}

export function useAdaptivePrefetch({
  chapterId,
  totalPages,
  currentPageIndex,
  enabled = true,
}: AdaptivePrefetchOptions): AdaptivePrefetchApi {
  const trackerRef = useRef<VelocityTracker>(new VelocityTracker())
  const prevPageRef = useRef<number>(currentPageIndex)
  const [prefetchParams, setPrefetchParams] = useState({
    lookahead: 8,
    lookbehind: 4,
    concurrency: 2,
  })
  const [currentVelocity, setCurrentVelocity] = useState<ReadingVelocity>('normal')

  // Reset on chapter change
  useEffect(() => {
    trackerRef.current.reset()
    prevPageRef.current = 0
    setPrefetchParams({ lookahead: 8, lookbehind: 4, concurrency: 2 })
    setCurrentVelocity('normal')
  }, [chapterId])

  // Core: feed a page change into the tracker and update derived params
  const onPageChange = (pageIndex: number) => {
    const tracker = trackerRef.current

    // Debounce: ignore identical page within 200ms
    const last = tracker.lastSample
    const now = Date.now()
    if (last && last.pageIndex === pageIndex && now - last.timestamp < 200) {
      return
    }

    tracker.recordPageChange(pageIndex)

    const velocity = tracker.getVelocity()
    setPrefetchParams({
      lookahead: velocity.suggestedLookahead,
      lookbehind: velocity.suggestedLookbehind,
      concurrency: velocity.suggestedConcurrency,
    })
    setCurrentVelocity(velocity.velocity)
  }

  // Feed external page index changes (e.g. scroll-mode IntersectionObserver)
  // into the velocity tracker.
  useEffect(() => {
    const prev = prevPageRef.current
    if (prev !== currentPageIndex) {
      prevPageRef.current = currentPageIndex
      onPageChange(currentPageIndex)
    }
  }, [currentPageIndex])

  // Delegate to the static prefetch hook with our adaptive parameters
  useImagePrefetch({
    chapterId,
    startPageIndex: currentPageIndex,
    totalPages,
    enabled,
    lookahead: prefetchParams.lookahead,
    lookbehind: prefetchParams.lookbehind,
    concurrency: prefetchParams.concurrency,
  })

  return { onPageChange, currentVelocity }
}
