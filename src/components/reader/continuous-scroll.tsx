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
  const [measuredHeights, setMeasuredHeights] = useState<
    Record<number, number>
  >({})

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
    setMeasuredHeights({})
  }, [chapterId])

  const estimatePageHeight = useCallback(
    (index: number) => {
      const measuredHeight = measuredHeights[index]
      if (typeof measuredHeight === 'number') {
        return measuredHeight
      }

      const page = pages[index]
      if (!page) {
        return viewportSize.height
      }

      const safeAspect = page.aspect > 0 ? page.aspect : 0.67
      return Math.max(240, viewportSize.width / safeAspect)
    },
    [measuredHeights, pages, viewportSize.height, viewportSize.width],
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
  }, [measuredHeights, viewportSize.width, virtualizer])

  const handleImageMeasure = useCallback(
    (pageIndex: number, width: number, height: number) => {
      if (width <= 0 || height <= 0) {
        return
      }

      const safeAspect = width / Math.max(height, 1)
      const nextHeight = Math.max(240, viewportSize.width / safeAspect)

      setMeasuredHeights((current) => {
        if (current[pageIndex] === nextHeight) {
          return current
        }

        return {
          ...current,
          [pageIndex]: nextHeight,
        }
      })

      onImageMeasure?.(pageIndex, width, height)
    },
    [onImageMeasure, viewportSize.width],
  )

  useEffect(() => {
    if (virtualItems.length === 0) {
      return
    }

    const scrollOffset = virtualizer.scrollOffset ?? 0
    const viewportMidpoint = scrollOffset + viewportSize.height * 0.5
    const mostVisibleItem = virtualItems.reduce((closest, item) => {
      const itemMidpoint = item.start + item.size * 0.5
      const currentDistance = Math.abs(itemMidpoint - viewportMidpoint)
      const closestMidpoint = closest.start + closest.size * 0.5
      const closestDistance = Math.abs(closestMidpoint - viewportMidpoint)

      return currentDistance < closestDistance ? item : closest
    })

    onVisiblePageChange(mostVisibleItem.index)
  }, [
    onVisiblePageChange,
    viewportSize.height,
    virtualItems,
    virtualizer.scrollOffset,
  ])

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
              ref={virtualizer.measureElement}
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
