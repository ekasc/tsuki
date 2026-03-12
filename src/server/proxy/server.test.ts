import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const originalEnv = { ...process.env }
const originalCaches = (globalThis as { caches?: unknown }).caches

describe('proxy image host allowlist', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
    delete process.env.WEBCENTRAL_CDN_HOSTS
    delete process.env.TSUKI_IMAGE_HOST_ALLOWLIST
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    ;(globalThis as { caches?: unknown }).caches = originalCaches
  })

  it('includes trusted MangaDex and WeebCentral hosts by default', async () => {
    const { proxyConfig } = await import('./server')

    expect(proxyConfig.weebcentralImageHostAllowlist).toEqual(
      expect.arrayContaining([
        'weebcentral.com',
        'planeptune.us',
        'mangadex.org',
        'mangadex.network',
        'uploads.mangadex.org',
      ]),
    )
  })

  it('merges legacy and new host env allowlists', async () => {
    process.env.WEBCENTRAL_CDN_HOSTS = 'cdn.weebcentral.net'
    process.env.TSUKI_IMAGE_HOST_ALLOWLIST =
      'at-home.mangadex.network,images.example.com'

    const { proxyConfig } = await import('./server')

    expect(proxyConfig.weebcentralImageHostAllowlist).toEqual(
      expect.arrayContaining([
        'cdn.weebcentral.net',
        'at-home.mangadex.network',
        'images.example.com',
      ]),
    )
  })

  it('approves hosts derived from image URLs', async () => {
    const { isApprovedImageHost, rememberApprovedImageHosts } = await import(
      './server'
    )
    await rememberApprovedImageHosts([
      'https://cdn.example.org/manga/chapter-1/001.webp',
    ])

    await expect(isApprovedImageHost('cdn.example.org')).resolves.toBe(true)
  })

  it('can hydrate approved hosts from shared cache across module reloads', async () => {
    const sharedCacheStore = new Map<string, Response>()
    ;(globalThis as { caches?: unknown }).caches = {
      default: {
        async put(request: Request, response: Response) {
          sharedCacheStore.set(request.url, response.clone())
        },
        async match(request: Request) {
          return sharedCacheStore.get(request.url)?.clone()
        },
      },
    }

    const firstImport = await import('./server')
    await firstImport.rememberApprovedImageHosts([
      'https://images.weebproxy-cdn.net/chapter/42/003.jpg',
    ])

    vi.resetModules()
    process.env = { ...originalEnv }
    delete process.env.WEBCENTRAL_CDN_HOSTS
    delete process.env.TSUKI_IMAGE_HOST_ALLOWLIST

    const secondImport = await import('./server')
    await expect(
      secondImport.isApprovedImageHost('images.weebproxy-cdn.net'),
    ).resolves.toBe(true)
  })
})
