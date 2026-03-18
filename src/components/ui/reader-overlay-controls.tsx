import { Button } from '#/components/ui/button'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface ReaderTapZoneProps {
  side: 'left' | 'right'
  onActivate: () => void
}

export function ReaderTapZone({ side, onActivate }: ReaderTapZoneProps) {
  return (
    <button
      aria-label={side === 'left' ? 'left-zone' : 'right-zone'}
      className={
        side === 'left'
          ? 'absolute inset-y-0 left-0 z-10 w-1/2 cursor-e-resize border-0 bg-transparent p-0 touch-manipulation'
          : 'absolute inset-y-0 right-0 z-10 w-1/2 cursor-w-resize border-0 bg-transparent p-0 touch-manipulation'
      }
      onClick={onActivate}
      onMouseDown={(event) => event.preventDefault()}
      tabIndex={-1}
      type="button"
    />
  )
}

interface ReaderEdgeArrowButtonProps {
  side: 'left' | 'right'
  onActivate: () => void
}

export function ReaderEdgeArrowButton({
  side,
  onActivate,
}: ReaderEdgeArrowButtonProps) {
  return (
    <Button
      aria-label={side === 'left' ? 'left-arrow' : 'right-arrow'}
      variant="soft"
      size="icon"
      className={
        side === 'left'
          ? 'absolute left-4 top-1/2 z-20 inline-flex size-12 -translate-y-1/2 border-2 border-border-strong bg-surface p-0 text-foreground shadow-[2px_2px_0_var(--shadow)] hover:bg-surface-soft md:left-5 md:size-14'
          : 'absolute right-4 top-1/2 z-20 inline-flex size-12 -translate-y-1/2 border-2 border-border-strong bg-surface p-0 text-foreground shadow-[2px_2px_0_var(--shadow)] hover:bg-surface-soft md:right-5 md:size-14'
      }
      onClick={onActivate}
      onMouseDown={(event) => event.preventDefault()}
      tabIndex={-1}
      type="button"
    >
      {side === 'left' ? (
        <ChevronLeft className="size-6 text-foreground" aria-hidden />
      ) : (
        <ChevronRight className="size-6 text-foreground" aria-hidden />
      )}
    </Button>
  )
}
