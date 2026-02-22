function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: {
    retries: number
    baseDelayMs: number
  },
): Promise<T> {
  let attempt = 0
  let latestError: unknown

  while (attempt <= options.retries) {
    try {
      return await operation()
    } catch (error) {
      latestError = error
      if (attempt === options.retries) {
        break
      }

      const waitMs = options.baseDelayMs * Math.pow(2, attempt)
      await delay(waitMs)
      attempt += 1
    }
  }

  throw latestError
}
