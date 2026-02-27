import { describe, expect, it } from 'vitest'

import {
  buildRemoteSeriesSourceUrl,
  detectRemoteProviderFromInput,
  detectRemoteProviderFromSeriesId,
  fromMangadexChapterId,
  fromMangadexSeriesId,
  isMangadexInput,
  remoteProviderLabel,
  toMangadexChapterId,
  toMangadexSeriesId,
} from './remote-provider'

describe('remote provider utilities', () => {
  it('builds and parses MangaDex prefixed IDs', () => {
    const seriesRaw = '4f9f8fb6-42d0-4a18-b0ff-4d64f5f57d4e'
    const chapterRaw = '6f9f8fb6-42d0-4a18-b0ff-4d64f5f57d4e'

    const seriesId = toMangadexSeriesId(seriesRaw)
    const chapterId = toMangadexChapterId(chapterRaw)

    expect(seriesId).toBe(`mds_${seriesRaw}`)
    expect(chapterId).toBe(`mdc_${chapterRaw}`)
    expect(fromMangadexSeriesId(seriesId)).toBe(seriesRaw)
    expect(fromMangadexChapterId(chapterId)).toBe(chapterRaw)
  })

  it('detects provider from URLs, UUIDs and prefixed IDs', () => {
    expect(
      isMangadexInput(
        'https://mangadex.org/title/4f9f8fb6-42d0-4a18-b0ff-4d64f5f57d4e',
      ),
    ).toBe(true)
    expect(
      isMangadexInput('4f9f8fb6-42d0-4a18-b0ff-4d64f5f57d4e'),
    ).toBe(true)
    expect(isMangadexInput('mds_4f9f8fb6-42d0-4a18-b0ff-4d64f5f57d4e')).toBe(
      true,
    )
    expect(
      detectRemoteProviderFromInput(
        'https://weebcentral.com/series/01J76XY9E3JSAWKXW3Q36SQ7C6',
      ),
    ).toBe('weebcentral')
    expect(
      detectRemoteProviderFromInput(
        'https://mangadex.org/chapter/6f9f8fb6-42d0-4a18-b0ff-4d64f5f57d4e',
      ),
    ).toBe('mangadex')
  })

  it('builds source labels and outbound links', () => {
    const mangadexSeriesId = 'mds_4f9f8fb6-42d0-4a18-b0ff-4d64f5f57d4e'

    expect(detectRemoteProviderFromSeriesId(mangadexSeriesId)).toBe('mangadex')
    expect(remoteProviderLabel('mangadex')).toBe('MangaDex')
    expect(remoteProviderLabel('weebcentral')).toBe('WeebCentral')
    expect(
      buildRemoteSeriesSourceUrl(mangadexSeriesId, 'mangadex'),
    ).toContain('/title/4f9f8fb6-42d0-4a18-b0ff-4d64f5f57d4e')
    expect(
      buildRemoteSeriesSourceUrl('01J76XY9E3JSAWKXW3Q36SQ7C6', 'weebcentral'),
    ).toContain('/series/01J76XY9E3JSAWKXW3Q36SQ7C6')
  })
})
