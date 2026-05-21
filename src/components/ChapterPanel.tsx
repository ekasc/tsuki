import { useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { X, Search } from 'lucide-react'

import { Input } from '#/components/ui/input'
import { cn } from '#/lib/utils'

interface ChapterEntry {
  id: string
  number: number
  title: string
  date?: string
}

interface ChapterPanelProps {
  chapters: ChapterEntry[]
  currentChapterId: string
  onSelectChapter: (chapterId: string) => void
  onClose: () => void
}

export function ChapterPanel({
  chapters,
  currentChapterId,
  onSelectChapter,
  onClose,
}: ChapterPanelProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  const filteredChapters = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return chapters
    return chapters.filter((ch) => {
      const numberStr = String(ch.number)
      return (
        ch.title.toLowerCase().includes(query) ||
        numberStr.includes(query)
      )
    })
  }, [chapters, searchQuery])

  const currentIndex = useMemo(
    () => chapters.findIndex((ch) => ch.id === currentChapterId),
    [chapters, currentChapterId],
  )

  const rowVirtualizer = useVirtualizer({
    count: filteredChapters.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 48,
    overscan: 10,
  })

  const scrollToCurrent = () => {
    if (currentIndex >= 0) {
      rowVirtualizer.scrollToIndex(currentIndex, { align: 'center' })
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div
        className="flex-1 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
        }}
        role="presentation"
      />
      <div className="flex w-80 flex-col bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <h2 className="text-sm font-semibold text-foreground">Chapters</h2>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={scrollToCurrent}
              className="rounded p-1 text-xs text-muted-foreground hover:text-foreground"
              title="Scroll to current chapter"
              aria-label="Scroll to current chapter"
            >
              Current
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-muted-foreground hover:text-foreground"
              aria-label="Close chapter list"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        <div className="border-b border-border p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search chapters…"
              className="h-8 pl-8 text-xs"
            />
          </div>
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto">
          <div
            className="relative"
            style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const ch = filteredChapters[virtualRow.index]
              if (!ch) return null

              const isCurrent = ch.id === currentChapterId

              return (
                <button
                  key={ch.id}
                  type="button"
                  onClick={() => onSelectChapter(ch.id)}
                  className={cn(
                    'absolute left-0 right-0 flex items-center gap-2 px-3 text-left text-xs transition-colors hover:bg-washi',
                    isCurrent
                      ? 'bg-koten/10 font-semibold text-koten'
                      : 'text-foreground',
                  )}
                  style={{ height: `${virtualRow.size}px`, transform: `translateY(${virtualRow.start}px)` }}
                >
                  <span className="truncate">
                    Chapter {ch.number}
                    {ch.title ? ` · ${ch.title}` : ''}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {filteredChapters.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">
            No chapters match your search.
          </p>
        ) : null}
      </div>
    </div>
  )
}
