import { HttpError } from '#/server/errors'

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/

export function encodeBase64Url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url')
}

export function decodeBase64Url(input: string): string {
  const trimmed = input.trim()

  if (trimmed.length === 0 || trimmed.length > 16_384) {
    throw new HttpError(400, 'Invalid proxy payload')
  }

  if (!BASE64URL_PATTERN.test(trimmed)) {
    throw new HttpError(400, 'Invalid base64url payload')
  }

  try {
    const decoded = Buffer.from(trimmed, 'base64url').toString('utf8')

    if (decoded.length === 0) {
      throw new HttpError(400, 'Invalid proxy payload')
    }

    return decoded
  } catch {
    throw new HttpError(400, 'Invalid base64url payload')
  }
}
