import { useCallback, useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

import type { ChapterPageManifest, ZoomPreset } from '#/lib/contracts'
import { PagePane } from './page-pane'

interface ContinuousScrollProps {
  chapterId: string
  pages: ChapterPageManifest[]
  zoomPreset: ZoomPreset
  resolveImageUrl?: (page: ChapterPageManifest) => string | undefined
  onImageMeasure?: (pageIndex: number, width: number, height: number) => void
  onVisiblePageChange: (pageIndex: number) => void
}

export function ContinuousScroll({
  chapterId,
  pages,
  zoomPreset,
  resolveImageUrl,
  onImageMeasure,
  onVisiblePageChange,
}: ContinuousScrollProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const [viewportSize, setViewportSize] = useState({
    width: 720,
    height: 960,
  })
  const measuredHeightsRef = useRef<Record<number, number>>({})
  const [measureVersion, setMeasureVersion] = useState(0)
  const savedScrollTopRef = useRef(0)
  const shouldRestoreScrollRef = useRef(false)

  useEffect(() => {
    const element = parentRef.current

    if (!element || typeof ResizeObserver === 'undefined') {
      return
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) {
        setViewportSize({
          width: Math.max(320, entry.contentRect.width),
          height: Math.max(480, entry.contentRect.height),
        })
      }
    })

    observer.observe(element)

    return () => {
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    savedScrollTopRef.current = parentRef.current?.scrollTop ?? 0
    shouldRestoreScrollRef.current = true
    measuredHeightsRef.current = {}
    setMeasureVersion((v) => v + 1)
  }, [chapterId])

  const estimatePageHeight = useCallback(
    (index: number) => {
      const measured = measuredHeightsRef.current[index]
      if (typeof measured === 'number') {
        return measured
      }

      const page = pages[index]
      if (!page) {
        return viewportSize.height
      }

      const safeAspect = page.aspect > 0 ? page.aspect : 0.67
      return Math.max(240, viewportSize.width / safeAspect)
    },
    // measureVersion triggers recalculation when heights change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [measureVersion, pages, viewportSize.height, viewportSize.width],
  )

  const virtualizer = useVirtualizer({
    count: pages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: estimatePageHeight,
    overscan: 3,
  })

  const virtualItems = virtualizer.getVirtualItems()

  useEffect(() => {
    virtualizer.measure()
    if (shouldRestoreScrollRef.current) {
      virtualizer.scrollToOffset(savedScrollTopRef.current)
      shouldRestoreScrollRef.current = false
    }
  }, [measureVersion, viewportSize.width, virtualizer])

  const handleImageMeasure = useCallback(
    (pageIndex: number, width: number, height: number) => {
      if (width <= 0 || height <= 0) {
        return
      }

      const safeAspect = width / Math.max(height, 1)
      const nextHeight = Math.max(240, viewportSize.width / safeAspect)

      const current = measuredHeightsRef.current[pageIndex]
      if (current === nextHeight) {
        return
      }

      measuredHeightsRef.current = {
        ...measuredHeightsRef.current,
        [pageIndex]: nextHeight,
      }
      setMeasureVersion((v) => v + 1)

      onImageMeasure?.(pageIndex, width, height)
    },
    [onImageMeasure, viewportSize.width],
  )

  // Scroll-based page tracking via IntersectionObserver
  const pageElementsRef = useRef<Map<number, HTMLDivElement>>(new Map())
  const mostVisibleRef = useRef(0)
  const onVisiblePageChangeRef = useRef(onVisiblePageChange)
  onVisiblePageChangeRef.current = onVisiblePageChange
  const observerRef = useRef<IntersectionObserver | null>(null)

  useEffect(() => {
    const elements = pageElementsRef.current

    const observer = new IntersectionObserver(
      (entries) => {
        let bestIndex = mostVisibleRef.current
        let bestRatio = 0

        for (const entry of entries) {
          const index = Number(
            (entry.target as HTMLElement).dataset.scrollPageIndex,
          )
          if (!Number.isFinite(index)) continue

          if (entry.intersectionRatio > bestRatio) {
            bestRatio = entry.intersectionRatio
            bestIndex = index
          }
        }

        if (bestRatio > 0 && bestIndex !== mostVisibleRef.current) {
          mostVisibleRef.current = bestIndex
          onVisiblePageChangeRef.current(bestIndex)
        }
      },
      { threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5] },
    )

    observerRef.current = observer

    for (const el of elements.values()) {
      observer.observe(el)
    }

    return () => {
      observer.disconnect()
      observerRef.current = null
    }
  }, [pages.length, measureVersion])

  const registerPageElement = useCallback(
    (pageIndex: number, el: HTMLDivElement | null) => {
      if (el) {
        el.dataset.scrollPageIndex = String(pageIndex)
        pageElementsRef.current.set(pageIndex, el)
        observerRef.current?.observe(el)
      } else {
        pageElementsRef.current.delete(pageIndex)
      }
    },
    [],
  )

  return (
    <div
      ref={parentRef}
      className="h-[100dvh] overflow-auto bg-black"
      style={{ touchAction: 'pan-y', WebkitOverflowScrolling: 'touch' }}
      data-testid="reader-scroll-container"
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          position: 'relative',
          width: '100%',
        }}
      >
        {virtualItems.map((item) => {
          const page = pages[item.index]!

          return (
            <div
              key={item.key}
              ref={(el) => {
                virtualizer.measureElement(el)
                registerPageElement(item.index, el as HTMLDivElement | null)
              }}
              data-index={item.index}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${item.start}px)`,
              }}
            >
              <PagePane
                chapterId={chapterId}
                page={page}
                unit={{ type: 'page', pageIndex: page.pageIndex }}
                imageUrl={resolveImageUrl?.(page)}
                zoomPreset={zoomPreset}
                loading="eager"
                onImageMeasure={handleImageMeasure}
                testId="scroll-page-container"
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
