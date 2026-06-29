/**
 * usePageTransition — add smooth GSAP-powered page transitions
 * to keyboard/tap/sidebar navigation.
 *
 * Manga readers like Tachiyomi and Kindle animate page turns. Without this,
 * page changes are instant and feel jarring. This hook wraps any navigation
 * action with a brief GSAP slide-out animation before the page state updates.
 *
 * Usage:
 *   const { withTransition } = usePageTransition(swipeTrackRef)
 *   const goNext = useCallback(() => {
 *     withTransition('next', goNextInner)
 *   }, [goNextInner, withTransition])
 */

import { useCallback, useRef, type RefObject } from 'react'
import gsap from 'gsap'

type TransitionDirection = 'next' | 'prev'

export function usePageTransition(
  containerRef: RefObject<HTMLDivElement | null>,
) {
  const isAnimatingRef = useRef(false)
  const pendingActionRef = useRef<(() => void) | null>(null)
  const animationTweenRef = useRef<gsap.core.Tween | null>(null)

  const withTransition = useCallback(
    (direction: TransitionDirection, action: () => void) => {
      if (isAnimatingRef.current) {
        // Queue the action for after the current animation finishes,
        // but only if it's a different action than what's already queued.
        pendingActionRef.current = action
        return
      }

      const container = containerRef.current
      if (!container) {
        action()
        return
      }

      isAnimatingRef.current = true

      // Kill any existing animation
      if (animationTweenRef.current) {
        animationTweenRef.current.kill()
        animationTweenRef.current = null
      }

      // Reset to clean state
      gsap.set(container, { clearProps: 'all' })

      // Animate current page out (horizontal slide + subtle fade)
      const slidePct = '18%'
      const slideX = direction === 'next' ? slidePct : `-${slidePct}`

      animationTweenRef.current = gsap.to(container, {
        opacity: 0,
        x: slideX,
        duration: 0.12,
        ease: 'power2.in',
        onComplete: () => {
          animationTweenRef.current = null

          // Clear transform props so new content renders in natural position
          if (container) {
            gsap.set(container, { clearProps: 'all' })
          }

          // Execute the page state update
          action()

          isAnimatingRef.current = false

          // If another navigation was queued during the animation, run it
          if (pendingActionRef.current) {
            const next = pendingActionRef.current
            pendingActionRef.current = null
            next()
          }
        },
      })
    },
    [containerRef],
  )

  return { withTransition, isAnimatingRef }
}
