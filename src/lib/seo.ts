export const SITE_URL = 'https://tsukireader.com'
export const DEFAULT_OG_IMAGE_PATH = '/icon-512.png'

function normalizePath(path: string): string {
  if (!path) {
    return '/'
  }

  return path.startsWith('/') ? path : `/${path}`
}

export function absoluteUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl
  }

  return new URL(normalizePath(pathOrUrl), SITE_URL).toString()
}

export function canonicalUrl(pathname: string): string {
  return absoluteUrl(normalizePath(pathname))
}

export function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, ' ')
}

export function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim()
}

export function truncateDescription(input: string, max = 160): string {
  const normalized = normalizeWhitespace(stripHtml(input))
  if (normalized.length <= max) {
    return normalized
  }

  const slice = normalized.slice(0, max + 1)
  const boundary = slice.lastIndexOf(' ')
  const cutAt = boundary > Math.floor(max * 0.6) ? boundary : max
  return `${slice.slice(0, cutAt).trimEnd()}...`
}

