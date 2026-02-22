import { Button } from '#/components/ui/button'

interface ReaderTapZoneProps {
  side: 'left' | 'right'
  onActivate: () => void
}

export function ReaderTapZone({ side, onActivate }: ReaderTapZoneProps) {
  return (
    <Button
      aria-label={side === 'left' ? 'left-zone' : 'right-zone'}
      variant="ghost"
      className={
        side === 'left'
          ? 'absolute inset-y-0 left-0 z-10 w-1/2 cursor-e-resize rounded-none bg-transparent hover:bg-transparent focus-visible:ring-0'
          : 'absolute inset-y-0 right-0 z-10 w-1/2 cursor-w-resize rounded-none bg-transparent hover:bg-transparent focus-visible:ring-0'
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
      className={
        side === 'left'
          ? 'absolute left-2 top-1/2 z-20 inline-flex size-11 -translate-y-1/2 rounded-full border border-white/30 bg-black/35 p-0 text-base text-white backdrop-blur-sm hover:bg-black/55'
          : 'absolute right-2 top-1/2 z-20 inline-flex size-11 -translate-y-1/2 rounded-full border border-white/30 bg-black/35 p-0 text-base text-white backdrop-blur-sm hover:bg-black/55'
      }
      onClick={onActivate}
      onMouseDown={(event) => event.preventDefault()}
      tabIndex={-1}
      type="button"
    >
      {side === 'left' ? '\u2190' : '\u2192'}
    </Button>
  )
}
