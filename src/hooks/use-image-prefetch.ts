import { useEffect, useRef } from 'react'

import { addBoundedSetEntry } from '#/lib/bounded-cache'
import { resolveApiUrl } from '#/lib/http-client'

const PREFETCH_URL_CACHE_LIMIT = 1200

interface PrefetchOptions {
  chapterId: string
  startPageIndex: number
  totalPages: number
  enabled?: boolean
  lookahead?: number
  lookbehind?: number
  concurrency?: number
}

const perChapterPrefetched = new Map<string, Set<string>>()
const perChapterInFlight = new Map<string, Map<string, HTMLImageElement>>()

function getChapterSets(chapterId: string) {
  let prefetched = perChapterPrefetched.get(chapterId)
  if (!prefetched) {
    prefetched = new Set()
    perChapterPrefetched.set(chapterId, prefetched)
  }
  let inFlight = perChapterInFlight.get(chapterId)
  if (!inFlight) {
    inFlight = new Map()
    perChapterInFlight.set(chapterId, inFlight)
  }
  return { prefetched, inFlight }
}

function warmImageUrl(url: string, chapterId: string): Promise<void> {
  const { prefetched, inFlight } = getChapterSets(chapterId)

  if (prefetched.has(url) || inFlight.has(url)) {
    return Promise.resolve()
  }

  return new Promise<void>((resolve) => {
    const image = new Image()
    image.decoding = 'async'
    image.loading = 'eager'
    inFlight.set(url, image)

    const finalize = (loaded: boolean) => {
      inFlight.delete(url)
      if (loaded) {
        addBoundedSetEntry(prefetched, url, PREFETCH_URL_CACHE_LIMIT)
      }
      resolve()
    }

    image.addEventListener(
      'load',
      () => {
        finalize(true)
      },
      { once: true },
    )
    image.addEventListener(
      'error',
      () => {
        finalize(false)
      },
      { once: true },
    )

    image.src = url
  })
}

export function useImagePrefetch({
  chapterId,
  startPageIndex,
  totalPages,
  enabled = true,
  lookahead = 8,
  lookbehind = 4,
  concurrency = 2,
}: PrefetchOptions) {
  const chapterIdRef = useRef(chapterId)
  chapterIdRef.current = chapterId

  useEffect(() => {
    if (!enabled) {
      return
    }

    let canceled = false
    const currentChapterId = chapterIdRef.current
    const targets: number[] = []

    const start = Math.max(0, startPageIndex - lookbehind)
    const end = Math.min(totalPages - 1, startPageIndex + lookahead)

    for (let pageIndex = start; pageIndex <= end; pageIndex += 1) {
      if (pageIndex === startPageIndex) {
        continue
      }
      targets.push(pageIndex)
    }

    const urls = targets
      .map((pageIndex) => resolveApiUrl(`/api/image/${chapterId}/${pageIndex}`))
      .filter((url) => {
        const { prefetched, inFlight } = getChapterSets(chapterId)
        return !prefetched.has(url) && !inFlight.has(url)
      })

    if (urls.length === 0) {
      return
    }

    const workerCount = Math.max(1, Math.min(8, concurrency))
    let cursor = 0

    const runWorker = async () => {
      while (cursor < urls.length && !canceled) {
        const index = cursor
        cursor += 1

        const url = urls[index]
        if (!url) {
          continue
        }

        await warmImageUrl(url, currentChapterId)
      }
    }

    void Promise.all(Array.from({ length: workerCount }, runWorker))

    return () => {
      canceled = true
    }
  }, [
    chapterId,
    concurrency,
    enabled,
    lookahead,
    lookbehind,
    startPageIndex,
    totalPages,
  ])
}
