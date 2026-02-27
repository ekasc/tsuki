const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '')
  .trim()
  .replace(/\/+$/, '')

export function resolveApiUrl(path: string): string {
  if (
    path.startsWith('http://') ||
    path.startsWith('https://') ||
    path.startsWith('data:') ||
    path.startsWith('blob:')
  ) {
    return path
  }

  if (!path.startsWith('/')) {
    return path
  }

  return API_BASE_URL ? `${API_BASE_URL}${path}` : path
}

export async function fetchJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const resolvedInput =
    typeof input === 'string' ? resolveApiUrl(input) : input
  const response = await fetch(resolvedInput, init)

  if (!response.ok) {
    const fallback = `Request failed with status ${response.status}`
    let message = fallback

    try {
      const payload = (await response.json()) as { error?: string }
      if (typeof payload.error === 'string' && payload.error.trim().length > 0) {
        message = payload.error
      }
    } catch {
      // Ignore JSON parse errors and preserve fallback message.
    }

    throw new Error(message)
  }

  return (await response.json()) as T
}
