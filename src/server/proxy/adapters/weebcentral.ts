import { HttpError } from '#/server/errors'
import type { RemoteProvider } from '#/lib/remote-provider'

import type { ProxyServerConfig } from '../server'
import {
    chapterCache,
    proxyConfig,
    rememberApprovedImageHosts,
    rememberApprovedImageUrl,
    seriesCache,
} from '../server'
import { encodeBase64Url } from '../utils/base64url'
import {
    type UpstreamTelemetryContext,
    fetchWithWeebcentralPolicy,
} from '../utils/upstream-policy'

const CHAPTER_IMAGES_QUERY =
    'is_prev=False&current_page=1&reading_style=long_strip'
const FULL_CHAPTER_LIST_SUFFIX = '/full-chapter-list'

const ID_PATTERN = /^[A-Za-z0-9_-]+$/

export type SeriesDTO = {
    provider?: RemoteProvider
    id: string
    title: string
    author?: string
    description?: string
    coverUrl?: string
    chapters: Array<{
        id: string
        number: number
        title: string
        date?: string
    }>
}

export type ChapterDTO = {
    provider?: RemoteProvider
    seriesId: string
    chapterId: string
    pages: Array<{
        url: string
    }>
}

interface ParsedWeebcentralInput {
    original: string
    url: URL | null
    seriesId: string | null
    chapterId: string | null
    ambiguousId: string | null
}

interface ParsedChapter {
    id: string
    number: number
    title: string
    date?: string
    sourceIndex: number
}

function decodeHtml(input: string): string {
    return input
        .replaceAll('&amp;', '&')
        .replaceAll('&quot;', '"')
        .replaceAll('&#39;', "'")
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&nbsp;', ' ')
}

function stripHtml(input: string): string {
    return decodeHtml(
        input
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim(),
    )
}

function extractMetaContent(html: string, key: string): string | undefined {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const patterns = [
        new RegExp(
            `<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`,
            'i',
        ),
        new RegExp(
            `<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${escaped}["'][^>]*>`,
            'i',
        ),
        new RegExp(
            `<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`,
            'i',
        ),
        new RegExp(
            `<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${escaped}["'][^>]*>`,
            'i',
        ),
    ]

    for (const pattern of patterns) {
        const match = html.match(pattern)
        if (match?.[1]) {
            return stripHtml(match[1])
        }
    }

    return undefined
}

function extractPotentialId(value: string): string | null {
    const trimmed = value.trim()
    if (!ID_PATTERN.test(trimmed)) {
        return null
    }
    return trimmed
}

function tryParseUrl(input: string): URL | null {
    try {
        return new URL(input)
    } catch {
        return null
    }
}

function extractIdFromPath(pathname: string, marker: string): string | null {
    const segments = pathname.split('/').filter(Boolean)
    const markerIndex = segments.findIndex(
        (segment) => segment.toLowerCase() === marker.toLowerCase(),
    )

    if (markerIndex < 0) {
        return null
    }

    const candidate = segments[markerIndex + 1]
    if (!candidate) {
        return null
    }

    return extractPotentialId(candidate)
}

function parseWeebcentralInput(input: string): ParsedWeebcentralInput {
    const normalizedInput = input.trim()

    if (normalizedInput.length === 0) {
        throw new HttpError(400, 'Missing WeebCentral input')
    }

    const asUrl = tryParseUrl(normalizedInput)

    if (!asUrl) {
        const maybeId = extractPotentialId(normalizedInput)
        return {
            original: normalizedInput,
            url: null,
            seriesId: null,
            chapterId: null,
            ambiguousId: maybeId,
        }
    }

    const chapterIdFromQuery = extractPotentialId(
        asUrl.searchParams.get('chapter_id') ?? '',
    )
    const seriesIdFromQuery = extractPotentialId(
        asUrl.searchParams.get('series_id') ?? '',
    )

    const chapterIdFromPath =
        extractIdFromPath(asUrl.pathname, 'chapters') ??
        extractIdFromPath(asUrl.pathname, 'chapter')

    const seriesIdFromPath = extractIdFromPath(asUrl.pathname, 'series')

    return {
        original: normalizedInput,
        url: asUrl,
        seriesId: seriesIdFromQuery ?? seriesIdFromPath,
        chapterId: chapterIdFromQuery ?? chapterIdFromPath,
        ambiguousId: null,
    }
}

function parseChapterNumber(input: string, fallback: number): number {
    const chapterMatch = input.match(/chapter\s*([0-9]+(?:\.[0-9]+)?)/i)

    if (!chapterMatch?.[1]) {
        return fallback
    }

    const numeric = Number.parseFloat(chapterMatch[1])
    if (Number.isFinite(numeric)) {
        return numeric
    }

    return fallback
}

function parseChapterDate(input: string): string | undefined {
    const trimmed = input.trim()

    if (trimmed.length === 0) {
        return undefined
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        return trimmed
    }

    const parsed = Date.parse(trimmed)
    if (Number.isNaN(parsed)) {
        return undefined
    }

    return new Date(parsed).toISOString()
}

function canonicalizeChapterOrder(chapters: ParsedChapter[]): ParsedChapter[] {
    const sorted = [...chapters].sort((left, right) => {
        if (left.number !== right.number) {
            return right.number - left.number
        }

        return left.sourceIndex - right.sourceIndex
    })

    return sorted.map((chapter, index) => {
        if (Number.isFinite(chapter.number)) {
            return chapter
        }

        return {
            ...chapter,
            number: sorted.length - index,
        }
    })
}

function extractSeriesIdFromHtml(html: string): string | null {
    const patterns = [
        /["']series_id["']\s*[:=]\s*["']([A-Za-z0-9_-]+)["']/i,
        /\/series\/([A-Za-z0-9_-]+)/i,
    ]

    for (const pattern of patterns) {
        const match = html.match(pattern)
        if (match?.[1]) {
            return match[1]
        }
    }

    return null
}

function extractAuthorFromHtml(html: string): string | undefined {
    const patterns = [
        /["']author["']\s*:\s*["']([^"']+)["']/i,
        /Author<\/[^>]*>\s*<[^>]*>\s*([^<]+)/i,
    ]

    for (const pattern of patterns) {
        const match = html.match(pattern)
        if (match?.[1]) {
            const value = stripHtml(match[1])
            if (value.length > 0) {
                return value
            }
        }
    }

    return undefined
}

function extractTitleFromHtml(html: string, fallback: string): string {
    const ogTitle = extractMetaContent(html, 'og:title')
    if (ogTitle) {
        return ogTitle
    }

    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
    if (titleMatch?.[1]) {
        return stripHtml(titleMatch[1])
    }

    return fallback
}

function normalizeSeriesTitle(input: string): string {
    return input
        .replace(/\s*[-|]\s*(?:read\s+)?manga.*$/i, '')
        .replace(/\s*[-|]\s*weebcentral\s*$/i, '')
        .replace(/\s*chapter\s*\d+(?:\.\d+)?\s*$/i, '')
        .replace(/\s+/g, ' ')
        .trim()
}

function parseJsonTitleCandidate(value: unknown): string | undefined {
    if (!value || typeof value !== 'object') {
        return undefined
    }

    const record = value as Record<string, unknown>
    const titleFields = [record.name, record.headline, record.alternativeHeadline]

    for (const field of titleFields) {
        if (typeof field === 'string') {
            const normalized = normalizeSeriesTitle(stripHtml(field))
            if (normalized.length > 0) {
                return normalized
            }
        }
    }

    if (Array.isArray(record['@graph'])) {
        for (const entry of record['@graph']) {
            const nested = parseJsonTitleCandidate(entry)
            if (nested) {
                return nested
            }
        }
    }

    return undefined
}

function extractSeriesTitle(html: string, fallback: string): string {
    const scriptPattern =
        /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi

    for (const match of html.matchAll(scriptPattern)) {
        const candidate = match[1]?.trim()
        if (!candidate) {
            continue
        }

        try {
            const parsed = JSON.parse(candidate) as unknown
            if (Array.isArray(parsed)) {
                for (const item of parsed) {
                    const nested = parseJsonTitleCandidate(item)
                    if (nested) {
                        return nested
                    }
                }
            } else {
                const nested = parseJsonTitleCandidate(parsed)
                if (nested) {
                    return nested
                }
            }
        } catch {
            // Ignore malformed JSON-LD blocks.
        }
    }

    const headingWithClassMatch = html.match(
        /<h1[^>]*class=["'][^"']*(?:title|name|series)[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i,
    )
    if (headingWithClassMatch?.[1]) {
        const normalized = normalizeSeriesTitle(stripHtml(headingWithClassMatch[1]))
        if (normalized.length > 0) {
            return normalized
        }
    }

    const firstHeadingMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
    if (firstHeadingMatch?.[1]) {
        const normalized = normalizeSeriesTitle(stripHtml(firstHeadingMatch[1]))
        if (normalized.length > 0) {
            return normalized
        }
    }

    const jsonStringTitleMatch = html.match(
        /["'](?:seriesName|mangaName|title|name)["']\s*:\s*["']([^"']{2,200})["']/i,
    )
    if (jsonStringTitleMatch?.[1]) {
        const normalized = normalizeSeriesTitle(stripHtml(jsonStringTitleMatch[1]))
        if (normalized.length > 0) {
            return normalized
        }
    }

    return normalizeSeriesTitle(extractTitleFromHtml(html, fallback)) || fallback
}

function parseJsonDescriptionCandidate(value: unknown): string | undefined {
    if (!value || typeof value !== 'object') {
        return undefined
    }

    const record = value as Record<string, unknown>
    if (typeof record.description === 'string') {
        const cleaned = stripHtml(record.description)
        if (cleaned.length > 24) {
            return cleaned
        }
    }

    if (Array.isArray(record['@graph'])) {
        for (const entry of record['@graph']) {
            const nested = parseJsonDescriptionCandidate(entry)
            if (nested) {
                return nested
            }
        }
    }

    return undefined
}

function extractSeriesDescription(html: string): string | undefined {
    const scriptPattern =
        /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    for (const match of html.matchAll(scriptPattern)) {
        const candidate = match[1]?.trim()
        if (!candidate) {
            continue
        }

        try {
            const parsed = JSON.parse(candidate) as unknown
            if (Array.isArray(parsed)) {
                for (const item of parsed) {
                    const nested = parseJsonDescriptionCandidate(item)
                    if (nested) {
                        return nested
                    }
                }
            } else {
                const nested = parseJsonDescriptionCandidate(parsed)
                if (nested) {
                    return nested
                }
            }
        } catch {
            // Ignore malformed JSON-LD blocks.
        }
    }

    const sectionPatterns = [
        /<h[1-6][^>]*>\s*(?:Synopsis|Summary|Description)\s*<\/h[1-6]>\s*<p[^>]*>([\s\S]*?)<\/p>/i,
        /(?:Synopsis|Summary|Description)<\/[^>]+>\s*<[^>]*>\s*([\s\S]*?)\s*<\/p>/i,
        /["'](?:synopsis|summary|description)["']\s*:\s*["']([\s\S]{30,3000}?)["']/i,
    ]

    for (const pattern of sectionPatterns) {
        const match = html.match(pattern)
        if (!match?.[1]) {
            continue
        }

        const cleaned = stripHtml(match[1])
        if (cleaned.length > 24) {
            return cleaned
        }
    }

    const metaDescription = extractMetaContent(html, 'description')
    if (!metaDescription) {
        return undefined
    }

    const genericMeta = /(?:read|chapters?).*(?:weebcentral|manga)/i.test(
        metaDescription,
    )
    return genericMeta ? undefined : metaDescription
}

function normalizeTitle(chapterTitle: string, chapterNumber: number): string {
    const withoutPrefix = chapterTitle
        .replace(/(?:chapter|ch\.?)\s*[0-9]+(?:\.[0-9]+)?\s*[:\-]?\s*/i, '')
        .trim()

    if (withoutPrefix.length > 0) {
        return withoutPrefix
    }

    return `Chapter ${chapterNumber}`
}

function stripNoisyChapterMarkup(html: string): string {
    return html
        .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
}

function extractChapterLabel(anchorHtml: string): string {
    const labeledSpanMatch = anchorHtml.match(
        /<span[^>]*>\s*((?:Chapter|Ch\.?)\s*[0-9]+(?:\.[0-9]+)?(?:[^<]*)?)\s*<\/span>/i,
    )

    if (labeledSpanMatch?.[1]) {
        return stripHtml(labeledSpanMatch[1])
    }

    const cleaned = stripNoisyChapterMarkup(anchorHtml)
    return stripHtml(cleaned)
}

function extractChapterDateNearAnchor(
    fullHtml: string,
    anchorEndIndex: number,
): string | undefined {
    const trailingWindow = fullHtml.slice(anchorEndIndex, anchorEndIndex + 800)

    const datetimeMatch = trailingWindow.match(
        /<time[^>]*datetime=["']([^"']+)["']/i,
    )

    if (datetimeMatch?.[1]) {
        return parseChapterDate(datetimeMatch[1])
    }

    const timestampMatch = trailingWindow.match(
        /checkNewChapter\(["']([^"']+)["']\)/i,
    )

    if (timestampMatch?.[1]) {
        return parseChapterDate(timestampMatch[1])
    }

    return undefined
}

function extractChapterDateFromAnchorHtml(
    anchorHtml: string,
): string | undefined {
    const datetimeMatch = anchorHtml.match(/<time[^>]*datetime=["']([^"']+)["']/i)

    if (datetimeMatch?.[1]) {
        return parseChapterDate(datetimeMatch[1])
    }

    const timestampMatch = anchorHtml.match(
        /checkNewChapter\(["']([^"']+)["']\)/i,
    )
    if (timestampMatch?.[1]) {
        return parseChapterDate(timestampMatch[1])
    }

    return undefined
}

function extractChaptersFromHtml(html: string): ParsedChapter[] {
    const chapterById = new Map<string, ParsedChapter>()
    const anchorPattern =
        /<a[^>]+href=["']([^"']*\/chapters\/([A-Za-z0-9_-]+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi

    let sourceIndex = 0
    let match: RegExpExecArray | null

    while ((match = anchorPattern.exec(html)) !== null) {
        const chapterId = extractPotentialId(match[2] ?? '')
        if (!chapterId || chapterById.has(chapterId)) {
            continue
        }

        const anchorHtml = match[3] ?? ''
        const anchorText = extractChapterLabel(anchorHtml)
        const chapterNumber = parseChapterNumber(anchorText, sourceIndex + 1)
        const chapterTitle = normalizeTitle(anchorText, chapterNumber)
        const chapterDate =
            extractChapterDateFromAnchorHtml(anchorHtml) ??
            extractChapterDateNearAnchor(html, anchorPattern.lastIndex) ??
            parseChapterDate(anchorText.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? '')

        chapterById.set(chapterId, {
            id: chapterId,
            number: chapterNumber,
            title: chapterTitle,
            date: chapterDate,
            sourceIndex,
        })
        sourceIndex += 1
    }

    // Prefer anchor-derived chapters whenever available. Script payloads
    // can include preview/current entries that inflate the chapter count.
    if (chapterById.size > 0) {
        return canonicalizeChapterOrder(Array.from(chapterById.values()))
    }

    const scriptPattern =
        /["']chapter(?:_id)?["']\s*[:=]\s*["']([A-Za-z0-9_-]+)["'][\s\S]{0,120}?["']number["']\s*:\s*([0-9]+(?:\.[0-9]+)?)/gi

    while ((match = scriptPattern.exec(html)) !== null) {
        const chapterId = extractPotentialId(match[1] ?? '')
        if (!chapterId || chapterById.has(chapterId)) {
            continue
        }

        const numeric = Number.parseFloat(match[2] ?? '')
        if (!Number.isFinite(numeric)) {
            continue
        }

        chapterById.set(chapterId, {
            id: chapterId,
            number: numeric,
            title: `Chapter ${numeric}`,
            sourceIndex,
        })
        sourceIndex += 1
    }

    return canonicalizeChapterOrder(Array.from(chapterById.values()))
}

function extractImageUrlsFromHtml(html: string, responseUrl: string): string[] {
    const imagePattern = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi
    const urls: string[] = []
    const seen = new Set<string>()
    let match: RegExpExecArray | null

    while ((match = imagePattern.exec(html)) !== null) {
        const src = match[1]?.trim()
        if (!src) {
            continue
        }

        let absolute: URL

        try {
            absolute = new URL(src, responseUrl)
        } catch {
            continue
        }

        if (!['http:', 'https:'].includes(absolute.protocol)) {
            continue
        }

        const asString = absolute.toString()
        if (seen.has(asString)) {
            continue
        }

        seen.add(asString)
        urls.push(asString)
    }

    return urls
}

async function fetchTextWithWeebcentralGuards(
    input: URL | string,
    config: ProxyServerConfig,
    options: {
        allowedHostnames?: string[]
        cacheClass?: 'metadata' | 'image'
        bypassCloudflareCache?: boolean
        telemetry?: UpstreamTelemetryContext
    } = {},
): Promise<{
    text: string
    responseUrl: string
}> {
    const response = await fetchWithWeebcentralPolicy(
        input,
        {
            method: 'GET',
            headers: {
                Accept: 'text/html,application/xhtml+xml',
            },
        },
        {
            allowedHostnames: options.allowedHostnames ?? ['weebcentral.com'],
            maxRedirects: config.imageProxyMaxRedirects,
            cacheClass: options.cacheClass ?? 'metadata',
            bypassCloudflareCache: options.bypassCloudflareCache,
            telemetry: options.telemetry,
        },
        config,
    )

    if (!response.ok) {
        throw new HttpError(
            502,
            `Upstream request failed with status ${response.status}`,
        )
    }

    const text = await response.text()

    if (text.trim().length === 0) {
        throw new HttpError(502, 'Empty upstream response')
    }

    return {
        text,
        responseUrl: response.url,
    }
}

async function resolveSeriesIdFromChapterInput(
    parsedInput: ParsedWeebcentralInput,
    config: ProxyServerConfig,
    options?: { bypassCache?: boolean; telemetry?: UpstreamTelemetryContext },
): Promise<string> {
    if (parsedInput.chapterId) {
        const chapterPageUrl =
            parsedInput.url ??
            new URL(`/chapters/${parsedInput.chapterId}`, config.weebcentralOrigin)
        const { text } = await fetchTextWithWeebcentralGuards(
            chapterPageUrl,
            config,
            {
                cacheClass: 'metadata',
                bypassCloudflareCache: options?.bypassCache,
                telemetry: options?.telemetry,
            },
        )
        const seriesId = extractSeriesIdFromHtml(text)

        if (!seriesId) {
            throw new HttpError(502, 'Unable to resolve series_id from chapter page')
        }

        return seriesId
    }

    if (parsedInput.ambiguousId) {
        const chapterPageUrl = new URL(
            `/chapters/${parsedInput.ambiguousId}`,
            config.weebcentralOrigin,
        )
        const { text } = await fetchTextWithWeebcentralGuards(
            chapterPageUrl,
            config,
            {
                cacheClass: 'metadata',
                bypassCloudflareCache: options?.bypassCache,
                telemetry: options?.telemetry,
            },
        )
        const seriesId = extractSeriesIdFromHtml(text)

        if (!seriesId) {
            throw new HttpError(502, 'Unable to resolve series_id from chapter page')
        }

        return seriesId
    }

    throw new HttpError(400, 'Unable to resolve series input')
}

async function fetchSeriesDtoBySeriesId(
    seriesId: string,
    config: ProxyServerConfig,
    options?: { bypassCache?: boolean; telemetry?: UpstreamTelemetryContext },
): Promise<SeriesDTO> {
    const cacheKey = `series:v2:${seriesId}`

    const fetchSeriesPayload = async () => {
        const seriesUrl = new URL(`/series/${seriesId}`, config.weebcentralOrigin)
        const { text: seriesHtml } = await fetchTextWithWeebcentralGuards(
            seriesUrl,
            config,
            {
                cacheClass: 'metadata',
                bypassCloudflareCache: options?.bypassCache,
                telemetry: options?.telemetry,
            },
        )
        const chapterListUrl = new URL(
            `/series/${seriesId}${FULL_CHAPTER_LIST_SUFFIX}`,
            config.weebcentralOrigin,
        )

        let chapterListHtml = ''

        try {
            const response = await fetchTextWithWeebcentralGuards(
                chapterListUrl,
                config,
                {
                    cacheClass: 'metadata',
                    bypassCloudflareCache: options?.bypassCache,
                    telemetry: options?.telemetry,
                },
            )
            chapterListHtml = response.text
        } catch {
            chapterListHtml = ''
        }

        const parsedFromFullList = extractChaptersFromHtml(chapterListHtml)
        const parsedChapters =
            parsedFromFullList.length > 0
                ? parsedFromFullList
                : extractChaptersFromHtml(seriesHtml)

        const chapters = parsedChapters.map((chapter) => ({
            id: chapter.id,
            number: chapter.number,
            title: chapter.title,
            date: chapter.date,
        }))

        if (chapters.length === 0) {
            throw new HttpError(502, 'No chapters found for series')
        }

        return {
            provider: 'weebcentral' as const,
            id: seriesId,
            title: extractSeriesTitle(seriesHtml, `Series ${seriesId}`),
            author: extractAuthorFromHtml(seriesHtml),
            description: extractSeriesDescription(seriesHtml),
            coverUrl: extractMetaContent(seriesHtml, 'og:image'),
            chapters,
        }
    }

    if (options?.bypassCache) {
        const freshPayload = await fetchSeriesPayload()
        seriesCache.set(
            cacheKey,
            freshPayload,
            config.seriesCacheTtlMs,
            config.seriesCacheStaleTtlMs,
        )
        return freshPayload
    }

    return seriesCache.getOrSetWithStaleFallback(
        cacheKey,
        fetchSeriesPayload,
        config.seriesCacheTtlMs,
        config.seriesCacheStaleTtlMs,
    )
}

async function resolveSeriesFromInput(
    input: string,
    config: ProxyServerConfig,
    options?: { bypassCache?: boolean; telemetry?: UpstreamTelemetryContext },
): Promise<SeriesDTO> {
    const parsed = parseWeebcentralInput(input)

    if (parsed.seriesId) {
        return fetchSeriesDtoBySeriesId(parsed.seriesId, config, options)
    }

    if (parsed.chapterId || parsed.url) {
        const resolvedSeriesId = await resolveSeriesIdFromChapterInput(
            parsed,
            config,
            options,
        )
        return fetchSeriesDtoBySeriesId(resolvedSeriesId, config, options)
    }

    if (parsed.ambiguousId) {
        try {
            return await fetchSeriesDtoBySeriesId(parsed.ambiguousId, config, options)
        } catch {
            const resolvedSeriesId = await resolveSeriesIdFromChapterInput(
                parsed,
                config,
                options,
            )
            return fetchSeriesDtoBySeriesId(resolvedSeriesId, config, options)
        }
    }

    throw new HttpError(400, 'Invalid WeebCentral series input')
}

async function resolveChapterIdFromInput(
    input: string,
    config: ProxyServerConfig,
    options?: { telemetry?: UpstreamTelemetryContext },
): Promise<{
    seriesId: string
    chapterId: string
}> {
    const parsed = parseWeebcentralInput(input)

    if (parsed.chapterId) {
        const seriesId = await resolveSeriesIdFromChapterInput(parsed, config, {
            telemetry: options?.telemetry,
        })
        return {
            seriesId,
            chapterId: parsed.chapterId,
        }
    }

    if (parsed.seriesId) {
        const seriesDto = await fetchSeriesDtoBySeriesId(parsed.seriesId, config, {
            telemetry: options?.telemetry,
        })
        const firstChapter = seriesDto.chapters[0]

        if (!firstChapter) {
            throw new HttpError(404, 'No chapters found for this series')
        }

        return {
            seriesId: seriesDto.id,
            chapterId: firstChapter.id,
        }
    }

    if (parsed.ambiguousId) {
        try {
            const seriesId = await resolveSeriesIdFromChapterInput(parsed, config, {
                telemetry: options?.telemetry,
            })
            return {
                seriesId,
                chapterId: parsed.ambiguousId,
            }
        } catch {
            const seriesDto = await fetchSeriesDtoBySeriesId(
                parsed.ambiguousId,
                config,
                { telemetry: options?.telemetry },
            )
            const firstChapter = seriesDto.chapters[0]

            if (!firstChapter) {
                throw new HttpError(404, 'No chapters found for this series')
            }

            return {
                seriesId: seriesDto.id,
                chapterId: firstChapter.id,
            }
        }
    }

    throw new HttpError(400, 'Invalid WeebCentral chapter input')
}

async function fetchChapterPages(
    chapterId: string,
    config: ProxyServerConfig,
    options?: { telemetry?: UpstreamTelemetryContext },
): Promise<string[]> {
    const chapterImagesUrl = new URL(
        `/chapters/${chapterId}/images?${CHAPTER_IMAGES_QUERY}`,
        config.weebcentralOrigin,
    )

    const response = await fetchWithWeebcentralPolicy(
        chapterImagesUrl,
        {
            method: 'GET',
            headers: {
                Accept: 'text/html,*/*',
            },
        },
        {
            allowedHostnames: config.weebcentralImageHostAllowlist,
            maxRedirects: config.imageProxyMaxRedirects,
            cacheClass: 'metadata',
            telemetry: options?.telemetry,
        },
        config,
    )

    if (!response.ok) {
        throw new HttpError(
            502,
            `Upstream chapter image request failed with status ${response.status}`,
        )
    }

    const html = await response.text()
    const imageUrls = extractImageUrlsFromHtml(html, response.url)

    if (imageUrls.length === 0) {
        throw new HttpError(502, 'No chapter images found')
    }

    await rememberApprovedImageHosts(imageUrls)

    for (const imageUrl of imageUrls) {
        rememberApprovedImageUrl(imageUrl)
    }

    return imageUrls
}

function toProxiedImagePath(url: string): string {
    return `/v1/image/${encodeBase64Url(url)}`
}

export async function getWeebcentralSeries(
    input: string,
    config: ProxyServerConfig = proxyConfig,
    options?: { bypassCache?: boolean; telemetry?: UpstreamTelemetryContext },
): Promise<SeriesDTO> {
    return resolveSeriesFromInput(input, config, options)
}

export async function getWeebcentralChapter(
    input: string,
    config: ProxyServerConfig = proxyConfig,
    options?: { telemetry?: UpstreamTelemetryContext },
): Promise<ChapterDTO> {
    const resolved = await resolveChapterIdFromInput(input, config, options)
    const cacheKey = `chapter:${resolved.chapterId}`

    return chapterCache.getOrSetWithStaleFallback(
        cacheKey,
        async () => {
      const pages = await fetchChapterPages(resolved.chapterId, config, options)
      const proxiedPages = pages.map((url) => ({
        url: toProxiedImagePath(url),
      }))

      return {
        provider: 'weebcentral' as const,
        seriesId: resolved.seriesId,
        chapterId: resolved.chapterId,
        pages: proxiedPages,
      }
    },
        config.chapterCacheTtlMs,
        config.chapterCacheStaleTtlMs,
    )
}

export const __testing = {
    extractChaptersFromHtml,
    extractImageUrlsFromHtml,
    extractSeriesIdFromHtml,
    parseWeebcentralInput,
}
