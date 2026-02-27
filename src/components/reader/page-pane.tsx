import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ChapterPageManifest, ZoomPreset } from '#/lib/contracts'
import { resolveApiUrl } from '#/lib/http-client'
import type { RenderUnit } from '#/lib/reader/pairing'
import { Button } from '#/components/ui/button'

interface PagePaneProps {
  chapterId: string
  unit: RenderUnit
  page: ChapterPageManifest
  imageUrl?: string
  zoomPreset: ZoomPreset
  loading?: 'eager' | 'lazy'
  testId?: string
  onImageMeasure?: (pageIndex: number, width: number, height: number) => void
  forceFullWidth?: boolean
}

function imageClassName(zoomPreset: ZoomPreset) {
  if (zoomPreset === 'fit-width') {
    return 'h-auto w-full'
  }

  if (zoomPreset === 'actual') {
    return 'h-auto w-auto max-w-none'
  }

  return 'h-full w-auto'
}

function useStableImageSource(source: string) {
  const [readySource, setReadySource] = useState(source)
  const requestVersionRef = useRef(0)

  useEffect(() => {
    if (source === readySource) {
      return
    }

    const requestVersion = requestVersionRef.current + 1
    requestVersionRef.current = requestVersion
    let cancelled = false
    const image = new Image()
    image.decoding = 'async'

    const commit = () => {
      if (cancelled || requestVersionRef.current !== requestVersion) {
        return
      }
      setReadySource(source)
    }

    const onLoad = () => {
      if (typeof image.decode === 'function') {
        void image
          .decode()
          .catch(() => {
            // Ignore decode failures and still commit loaded source.
          })
          .finally(commit)
        return
      }

      commit()
    }

    const onError = () => {
      commit()
    }

    image.addEventListener('load', onLoad)
    image.addEventListener('error', onError)
    image.src = source

    if (image.complete && image.naturalWidth > 0) {
      onLoad()
    }

    return () => {
      cancelled = true
      image.removeEventListener('load', onLoad)
      image.removeEventListener('error', onError)
    }
  }, [readySource, source])

  return readySource
}

export function PagePane({
  chapterId,
  unit,
  page,
  imageUrl,
  zoomPreset,
  loading = 'lazy',
  testId,
  onImageMeasure,
  forceFullWidth = false,
}: PagePaneProps) {
  const baseImageUrl = useMemo(() => {
    const base = imageUrl ?? `/api/image/${chapterId}/${page.pageIndex}`
    return resolveApiUrl(base)
  }, [chapterId, imageUrl, page.pageIndex])
  const [retryNonce, setRetryNonce] = useState(0)
  const resolvedImageUrl = useMemo(() => {
    if (retryNonce <= 0) {
      return baseImageUrl
    }

    const separator = baseImageUrl.includes('?') ? '&' : '?'
    return `${baseImageUrl}${separator}_r=${retryNonce}`
  }, [baseImageUrl, retryNonce])
  const readySource = useStableImageSource(resolvedImageUrl)

  const [imageError, setImageError] = useState(false)
  const retryCountRef = useRef(0)
  const MAX_AUTO_RETRIES = 2

  // Reset retries when the underlying page source changes.
  useEffect(() => {
    setImageError(false)
    retryCountRef.current = 0
    setRetryNonce(0)
  }, [baseImageUrl])

  const handleImageError = useCallback(() => {
    if (retryCountRef.current < MAX_AUTO_RETRIES) {
      retryCountRef.current += 1
      setRetryNonce(retryCountRef.current)
      return
    }
    setImageError(true)
  }, [])

  const handleManualRetry = useCallback(() => {
    setImageError(false)
    retryCountRef.current = 0
    setRetryNonce((current) => current + 1)
  }, [])

  const errorOverlay = imageError ? (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black/80">
      <p className="text-sm text-white/80">Image failed to load</p>
      <Button variant="soft" className="h-8 px-3 text-xs" onClick={handleManualRetry}>
        Tap to reload
      </Button>
    </div>
  ) : null

  // Determine if we're doing a CSS crop on either half or cropped page units.
  const cssCrop =
    unit.type === 'half'
      ? unit.half
      : unit.type === 'page' && 'crop' in unit
        ? (unit.crop as 'left' | 'right')
        : null
  const isCropped = cssCrop !== null
  const paneAspectRatio = isCropped ? Math.max(0.1, page.aspect / 2) : page.aspect
  const fetchPriority = loading === 'eager' ? 'high' : 'auto'

  // CSS-cropped page: show full image at 200% width, translate to show correct half
  if (cssCrop) {
    return (
      <div
        className={`relative flex h-full flex-none items-center justify-center overflow-hidden bg-black ${forceFullWidth ? 'w-full' : ''}`}
        style={{
          aspectRatio: forceFullWidth ? undefined : paneAspectRatio,
        }}
        data-testid={testId}
      >
        {errorOverlay}
        <div className="relative flex h-full w-full items-center overflow-hidden">
          <img
            src={readySource}
            alt={`Page ${page.pageIndex + 1} ${cssCrop} half`}
            className="max-w-none reader-image-touch"
            loading={loading}
            decoding="async"
            fetchPriority={fetchPriority}
            onLoad={(event) => {
              onImageMeasure?.(
                page.pageIndex,
                event.currentTarget.naturalWidth,
                event.currentTarget.naturalHeight,
              )
            }}
            onError={handleImageError}
            style={{
              width: '200%',
              height: 'auto',
              transform:
                cssCrop === 'left' ? 'translateX(0)' : 'translateX(-50%)',
              transformOrigin:
                cssCrop === 'left' ? 'left center' : 'right center',
            }}
          />
        </div>
      </div>
    )
  }

  return (
    <div
      className={`relative flex h-full flex-none items-center justify-center overflow-hidden bg-black ${forceFullWidth ? 'w-full' : ''}`}
      style={{
        aspectRatio: forceFullWidth ? undefined : paneAspectRatio,
      }}
      data-testid={testId}
    >
      {errorOverlay}
      {unit.type === 'page' ? (
        <img
          src={readySource}
          alt={`Page ${page.pageIndex + 1}`}
          className={`${imageClassName(zoomPreset)} object-contain reader-image-touch`}
          loading={loading}
          decoding="async"
          fetchPriority={fetchPriority}
          onLoad={(event) => {
            onImageMeasure?.(
              page.pageIndex,
              event.currentTarget.naturalWidth,
              event.currentTarget.naturalHeight,
            )
          }}
          onError={handleImageError}
        />
      ) : (
        <div className="relative h-full w-full overflow-hidden">
          <img
            src={readySource}
            alt={`Page ${page.pageIndex + 1} ${unit.half} half`}
            className={`${imageClassName(zoomPreset)} max-h-none object-cover reader-image-touch`}
            loading={loading}
            decoding="async"
            fetchPriority={fetchPriority}
            onLoad={(event) => {
              onImageMeasure?.(
                page.pageIndex,
                event.currentTarget.naturalWidth,
                event.currentTarget.naturalHeight,
              )
            }}
            onError={handleImageError}
            style={{
              width: '200%',
              transform:
                unit.half === 'left' ? 'translateX(0)' : 'translateX(-50%)',
              transformOrigin:
                unit.half === 'left' ? 'left center' : 'right center',
            }}
          />
        </div>
      )}
    </div>
  )
}
