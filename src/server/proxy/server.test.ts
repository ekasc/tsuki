import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const originalEnv = { ...process.env }

describe('proxy image host allowlist', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
    delete process.env.WEBCENTRAL_CDN_HOSTS
    delete process.env.TSUKI_IMAGE_HOST_ALLOWLIST
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('includes trusted MangaDex and WeebCentral hosts by default', async () => {
    const { proxyConfig } = await import('./server')

    expect(proxyConfig.weebcentralImageHostAllowlist).toEqual(
      expect.arrayContaining([
        'weebcentral.com',
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
})
