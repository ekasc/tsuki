import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'

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
    return 'h-auto w-full reader-image-fit-width'
  }

  if (zoomPreset === 'actual') {
    return 'h-auto w-auto max-w-none reader-image-actual'
  }

  return 'h-full w-auto reader-image-fit-height'
}export const PagePane = memo(
  function PagePane({
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
    const readySource = resolvedImageUrl

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
      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/85">
        <div className="reader-broken-icon" aria-hidden="true" />
        <p className="text-xs text-white/50">Image failed to load</p>
        <Button
          variant="soft"
          className="h-8 px-3 text-xs"
          onClick={handleManualRetry}
        >
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
    const safeAspect = page.aspect > 0 ? page.aspect : 0.67
    const paneAspectRatio = isCropped
      ? Math.max(0.1, safeAspect / 2)
      : safeAspect
    const fetchPriority = loading === 'eager' ? 'high' : 'auto'

    // CSS-cropped page: show full image at 200% width, translate to show correct half
    if (cssCrop) {
      return (
        <div
          className={`relative flex h-full flex-none items-center justify-center overflow-hidden bg-black ${forceFullWidth ? 'w-full' : ''}`}
          style={{
            aspectRatio: forceFullWidth
              ? paneAspectRatio > 0
                ? paneAspectRatio
                : undefined
              : paneAspectRatio,
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
          aspectRatio: paneAspectRatio > 0 ? paneAspectRatio : undefined,
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
  },
  function arePagePanePropsEqual(prev: PagePaneProps, next: PagePaneProps) {
    if (prev.chapterId !== next.chapterId) return false
    if (prev.zoomPreset !== next.zoomPreset) return false
    if (prev.loading !== next.loading) return false
    if (prev.forceFullWidth !== next.forceFullWidth) return false
    if (prev.testId !== next.testId) return false
    if (prev.imageUrl !== next.imageUrl) return false
    if (prev.page.pageIndex !== next.page.pageIndex) return false
    if (prev.page.width !== next.page.width) return false
    if (prev.page.height !== next.page.height) return false
    if (prev.unit.type !== next.unit.type) return false
    if (prev.unit.pageIndex !== next.unit.pageIndex) return false
    if (
      prev.unit.type === 'half' &&
      next.unit.type === 'half' &&
      prev.unit.half !== next.unit.half
    )
      return false
    if ('crop' in prev.unit !== 'crop' in next.unit) return false
    if (
      'crop' in prev.unit &&
      'crop' in next.unit &&
      (prev.unit as { crop: string }).crop !==
        (next.unit as { crop: string }).crop
    )
      return false
    return true
  },
)
