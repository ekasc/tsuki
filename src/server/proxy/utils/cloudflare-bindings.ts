interface CloudflareWorkersModule {
  env?: Record<string, unknown>
}

export interface CloudflareRateLimitResult {
  success?: boolean
}

export interface CloudflareRateLimitBinding {
  limit(input: { key: string }): Promise<CloudflareRateLimitResult>
}

export interface CloudflareAnalyticsBinding {
  writeDataPoint(point: {
    blobs?: string[]
    doubles?: number[]
    indexes?: string[]
  }): void
}

let cachedEnvPromise: Promise<Record<string, unknown> | null> | null = null

function hasObjectValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function loadCloudflareWorkersModule(): Promise<CloudflareWorkersModule | null> {
  try {
    const loader = Function(
      'return import("cloudflare:workers")',
    ) as () => Promise<CloudflareWorkersModule>
    return await loader()
  } catch {
    return null
  }
}

async function resolveCloudflareEnvFromModule(): Promise<Record<string, unknown> | null> {
  const module = await loadCloudflareWorkersModule()
  if (!module || !hasObjectValue(module.env)) {
    return null
  }

  return module.env
}

function resolveCloudflareEnvFromGlobal(): Record<string, unknown> | null {
  const candidate = (globalThis as { __cloudflareEnv?: unknown }).__cloudflareEnv

  if (!hasObjectValue(candidate)) {
    return null
  }

  return candidate
}

export async function getCloudflareEnvBindings(): Promise<Record<string, unknown> | null> {
  if (cachedEnvPromise) {
    return cachedEnvPromise
  }

  cachedEnvPromise = (async () => {
    const fromModule = await resolveCloudflareEnvFromModule()
    if (fromModule) {
      return fromModule
    }

    return resolveCloudflareEnvFromGlobal()
  })()

  return cachedEnvPromise
}

export async function getCloudflareBinding<T>(
  bindingName: string,
): Promise<T | null> {
  const envBindings = await getCloudflareEnvBindings()
  if (!envBindings) {
    return null
  }

  const binding = envBindings[bindingName]
  if (!binding) {
    return null
  }

  return binding as T
}

export function resetCloudflareBindingCacheForTests() {
  cachedEnvPromise = null
}
