import { useEffect, useMemo, useRef, useState } from 'react'

import type { ChapterPageManifest, ZoomPreset } from '#/lib/contracts'
import type { RenderUnit } from '#/lib/reader/pairing'

interface PagePaneProps {
  chapterId: string
  unit: RenderUnit
  page: ChapterPageManifest
  imageUrl?: string
  zoomPreset: ZoomPreset
  loading?: 'eager' | 'lazy'
  testId?: string
  onImageMeasure?: (pageIndex: number, width: number, height: number) => void
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
}: PagePaneProps) {
  const resolvedImageUrl = useMemo(
    () => imageUrl ?? `/api/image/${chapterId}/${page.pageIndex}`,
    [chapterId, imageUrl, page.pageIndex],
  )
  const readySource = useStableImageSource(resolvedImageUrl)
  const paneAspectRatio =
    unit.type === 'half' ? Math.max(0.1, page.aspect / 2) : page.aspect
  const fetchPriority = loading === 'eager' ? 'high' : 'auto'

  return (
    <div
      className="relative flex h-full flex-none items-center justify-center overflow-hidden bg-black"
      style={{
        aspectRatio: paneAspectRatio,
      }}
      data-testid={testId}
    >
      {unit.type === 'page' ? (
        <img
          src={readySource}
          alt={`Page ${page.pageIndex + 1}`}
          className={`${imageClassName(zoomPreset)} object-contain`}
          loading={loading}
          decoding="async"
          fetchPriority={fetchPriority}
          draggable={false}
          onLoad={(event) => {
            onImageMeasure?.(
              page.pageIndex,
              event.currentTarget.naturalWidth,
              event.currentTarget.naturalHeight,
            )
          }}
        />
      ) : (
        <div className="relative h-full w-full overflow-hidden">
          <img
            src={readySource}
            alt={`Page ${page.pageIndex + 1} ${unit.half} half`}
            className={`${imageClassName(zoomPreset)} max-h-none object-cover`}
            loading={loading}
            decoding="async"
            fetchPriority={fetchPriority}
            draggable={false}
            onLoad={(event) => {
              onImageMeasure?.(
                page.pageIndex,
                event.currentTarget.naturalWidth,
                event.currentTarget.naturalHeight,
              )
            }}
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
