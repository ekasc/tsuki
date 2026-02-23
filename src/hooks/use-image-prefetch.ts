import { useEffect } from 'react'

const prefetched = new Set<string>()

interface PrefetchOptions {
  chapterId: string
  startPageIndex: number
  totalPages: number
  enabled?: boolean
  lookahead?: number
  lookbehind?: number
  concurrency?: number
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
  useEffect(() => {
    if (!enabled) {
      return
    }

    const controller = new AbortController()
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
      .map((pageIndex) => `/api/image/${chapterId}/${pageIndex}`)
      .filter((url) => !prefetched.has(url))

    if (urls.length === 0) {
      return
    }

    const workerCount = Math.max(1, Math.min(8, concurrency))
    let cursor = 0

    const runWorker = async () => {
      while (cursor < urls.length && !controller.signal.aborted) {
        const index = cursor
        cursor += 1
        const url = urls[index]!

        try {
          await fetch(url, {
            signal: controller.signal,
            cache: 'force-cache',
          })
          prefetched.add(url)
        } catch {
          // Ignore aborted/failed prefetches.
        }
      }
    }

    void Promise.all(Array.from({ length: workerCount }, runWorker))

    return () => {
      controller.abort()
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
