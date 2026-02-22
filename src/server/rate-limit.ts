import { HttpError } from './errors'

interface Bucket {
  windowStart: number
  count: number
}

const buckets = new Map<string, Bucket>()

export function assertRateLimit(
  key: string,
  options: {
    limit: number
    windowMs: number
  },
) {
  const now = Date.now()
  const current = buckets.get(key)

  if (!current || now - current.windowStart > options.windowMs) {
    buckets.set(key, {
      windowStart: now,
      count: 1,
    })
    return
  }

  if (current.count >= options.limit) {
    throw new HttpError(429, 'Too many requests. Please try again shortly.')
  }

  current.count += 1
  buckets.set(key, current)
}

export function requestClientId(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  const cfIp = request.headers.get('cf-connecting-ip')

  return forwarded?.split(',')[0]?.trim() ?? cfIp ?? 'local'
}
