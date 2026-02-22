export async function fetchJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(input, init)

  if (!response.ok) {
    const fallback = `Request failed with status ${response.status}`

    try {
      const payload = (await response.json()) as { error?: string }
      throw new Error(payload.error ?? fallback)
    } catch {
      throw new Error(fallback)
    }
  }

  return (await response.json()) as T
}
