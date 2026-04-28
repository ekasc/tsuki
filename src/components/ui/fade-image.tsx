import { useCallback, useEffect, useRef } from 'react'

import { cn } from '#/lib/utils'

interface FadeImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  fade?: boolean
}

export function FadeImage({
  fade = true,
  className,
  onLoad,
  ...props
}: FadeImageProps) {
  const ref = useRef<HTMLImageElement>(null)
  const didSetLoaded = useRef(false)

  const markLoaded = useCallback(() => {
    if (ref.current && !didSetLoaded.current) {
      didSetLoaded.current = true
      ref.current.dataset.loaded = 'true'
    }
  }, [])

  const handleLoad = useCallback(
    (event: React.SyntheticEvent<HTMLImageElement>) => {
      markLoaded()
      onLoad?.(event)
    },
    [markLoaded, onLoad],
  )

  useEffect(() => {
    if (ref.current?.complete && !didSetLoaded.current) {
      markLoaded()
    }
  }, [markLoaded])

  if (!fade) {
    return (
      <img ref={ref} className={className} onLoad={handleLoad} {...props} />
    )
  }

  return (
    <img
      ref={ref}
      className={cn('img-decode', className)}
      onLoad={handleLoad}
      {...props}
    />
  )
}
