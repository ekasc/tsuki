import { describe, expect, it } from 'vitest'

import { __testing } from './weebcentral'

describe('weebcentral adapter parsing', () => {
  it('parses noisy chapter list markup with stable chapter metadata', () => {
    const html = `
      <div class="flex items-center" x-data="{ new_chapter: checkNewChapter('2026-02-21T00:49:06.496296Z') }">
        <a href="https://weebcentral.com/chapters/CHAPTER_A" class="hover:bg-base-300 flex-1 flex items-center p-2">
          <span class="me-2">
            <svg><style>.st0{fill:#000}</style><path d="M377.221 190.694"></path></svg>
          </span>
          <span class="grow flex items-center gap-2">
            <span class="">Chapter 244</span>
            <span class="flex gap-1 items-center link-info">Last Read</span>
          </span>
          <time class="text-datetime opacity-50" datetime="2026-02-21T00:49:06.496Z">2026-02-21T00:49:06.496296Z</time>
        </a>
      </div>
      <div class="flex items-center" x-data="{ new_chapter: checkNewChapter('2026-02-12T22:01:15.901436Z') }">
        <a href="https://weebcentral.com/chapters/CHAPTER_B" class="hover:bg-base-300 flex-1 flex items-center p-2">
          <span class="">Chapter 243</span>
          <time class="text-datetime opacity-50" datetime="2026-02-12T22:01:15.901Z">2026-02-12T22:01:15.901436Z</time>
        </a>
      </div>
    `

    const chapters = __testing.extractChaptersFromHtml(html)

    expect(chapters).toHaveLength(2)
    expect(chapters[0]).toMatchObject({
      id: 'CHAPTER_A',
      number: 244,
      title: 'Chapter 244',
      date: '2026-02-21T00:49:06.496Z',
    })
    expect(chapters[1]).toMatchObject({
      id: 'CHAPTER_B',
      number: 243,
      title: 'Chapter 243',
      date: '2026-02-12T22:01:15.901Z',
    })
  })

  it('supports full series and chapter URLs when parsing inputs', () => {
    const fromSeriesUrl = __testing.parseWeebcentralInput(
      'https://weebcentral.com/series/SERIES123/Slug-Title',
    )
    expect(fromSeriesUrl.seriesId).toBe('SERIES123')
    expect(fromSeriesUrl.chapterId).toBeNull()
    expect(fromSeriesUrl.url?.hostname).toBe('weebcentral.com')

    const fromChapterUrl = __testing.parseWeebcentralInput(
      'https://weebcentral.com/chapters/CHAPTER456?series_id=SERIES789',
    )
    expect(fromChapterUrl.chapterId).toBe('CHAPTER456')
    expect(fromChapterUrl.seriesId).toBe('SERIES789')
  })

  it('extracts image src attributes and ignores onerror fallback src', () => {
    const html = `
      <img src="https://cdn.example.org/page-1.jpg" onerror="this.onerror=null; this.src='/static/images/broken_image.jpg'" />
      <img src="/relative/page-2.jpg" onerror="this.src='/static/images/broken_image.jpg'" />
    `

    const urls = __testing.extractImageUrlsFromHtml(
      html,
      'https://weebcentral.com/chapters/CHAPTER456/images',
    )

    expect(urls).toEqual([
      'https://cdn.example.org/page-1.jpg',
      'https://weebcentral.com/relative/page-2.jpg',
    ])
  })
})
