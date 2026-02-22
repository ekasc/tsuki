import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

import type { ChapterPageManifest, ZoomPreset } from '#/lib/contracts'
import { PagePane } from './page-pane'

interface ContinuousScrollProps {
  chapterId: string
  pages: ChapterPageManifest[]
  zoomPreset: ZoomPreset
  isFullscreen?: boolean
  resolveImageUrl?: (page: ChapterPageManifest) => string | undefined
  onVisiblePageChange: (pageIndex: number) => void
}

export function ContinuousScroll({
  chapterId,
  pages,
  zoomPreset,
  isFullscreen = false,
  resolveImageUrl,
  onVisiblePageChange,
}: ContinuousScrollProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const [viewportWidth, setViewportWidth] = useState(720)

  useEffect(() => {
    const element = parentRef.current

    if (!element || typeof ResizeObserver === 'undefined') {
      return
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) {
        setViewportWidth(Math.max(320, entry.contentRect.width))
      }
    })

    observer.observe(element)

    return () => {
      observer.disconnect()
    }
  }, [])

  const heights = useMemo(
    () =>
      pages.map((page) => {
        const safeAspect = page.aspect > 0 ? page.aspect : 0.67
        return Math.max(240, viewportWidth / safeAspect)
      }),
    [pages, viewportWidth],
  )

  const virtualizer = useVirtualizer({
    count: pages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => heights[index] ?? 460,
    overscan: 2,
  })

  const virtualItems = virtualizer.getVirtualItems()

  useEffect(() => {
    const firstItem = virtualItems[0]

    if (firstItem) {
      onVisiblePageChange(firstItem.index)
    }
  }, [onVisiblePageChange, virtualItems])

  return (
    <div
      ref={parentRef}
      className={`${isFullscreen ? 'h-[100dvh]' : 'h-[72vh]'} overflow-auto bg-black`}
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
                testId="scroll-page-container"
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
