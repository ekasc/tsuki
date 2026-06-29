import { addBoundedSetEntry } from '#/lib/bounded-cache'

const warmedImageUrls = new Set<string>()
const inFlightImageWarms = new Map<string, Promise<void>>()
const WARMED_IMAGE_URL_LIMIT = 1800

export function isImageWarmed(url: string) {
  return warmedImageUrls.has(url)
}

export function isImageWarmInFlight(url: string) {
  return inFlightImageWarms.has(url)
}

export function warmImageUrl(url: string): Promise<void> {
  if (warmedImageUrls.has(url)) {
    return Promise.resolve()
  }

  const inFlight = inFlightImageWarms.get(url)
  if (inFlight) {
    return inFlight
  }

  const promise = new Promise<void>((resolve) => {
    const image = new Image()
    image.decoding = 'async'
    image.loading = 'eager'

    const finalize = (loaded: boolean) => {
      inFlightImageWarms.delete(url)
      if (loaded) {
        addBoundedSetEntry(warmedImageUrls, url, WARMED_IMAGE_URL_LIMIT)
      }
      resolve()
    }

    image.addEventListener(
      'load',
      () => {
        if (typeof image.decode !== 'function') {
          finalize(true)
          return
        }

        void image.decode().then(
          () => finalize(true),
          () => finalize(true),
        )
      },
      { once: true },
    )
    image.addEventListener('error', () => finalize(false), { once: true })
    image.src = url
  })

  inFlightImageWarms.set(url, promise)
  return promise
}
