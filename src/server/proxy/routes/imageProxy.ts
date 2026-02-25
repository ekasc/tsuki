import sharp from 'sharp'
import { HttpError } from '#/server/errors'

import { isApprovedImageUrl, proxyConfig } from '../server'
import { decodeBase64Url } from '../utils/base64url'
import { fetchWithSafeRedirects, isHostnameAllowed } from '../utils/security'

function pickHeader(headers: Headers, key: string): string | null {
    const value = headers.get(key)
    if (!value) {
        return null
    }
    return value
}

export async function proxyImageByEncodedUrl(
    encodedUrl: string,
    options: { crop?: 'left' | 'right' | null } = {},
): Promise<Response> {
    const decoded = decodeBase64Url(encodedUrl)
    let decodedUrl: URL

    try {
        decodedUrl = new URL(decoded)
    } catch {
        throw new HttpError(400, 'Invalid upstream URL')
    }
    const isApproved = isApprovedImageUrl(decoded)
    const isStaticallyAllowed = isHostnameAllowed(
        decodedUrl.hostname,
        proxyConfig.weebcentralImageHostAllowlist,
    )

    if (!isApproved && !isStaticallyAllowed) {
        throw new HttpError(403, 'Upstream host is not allowed')
    }

    const allowedHostnames = isApproved
        ? Array.from(
            new Set([
                decodedUrl.hostname,
                ...proxyConfig.weebcentralImageHostAllowlist,
            ]),
        )
        : proxyConfig.weebcentralImageHostAllowlist

    const upstreamResponse = await fetchWithSafeRedirects(
        decoded,
        {
            method: 'GET',
            headers: {
                Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
            },
        },
        {
            allowedHostnames,
            maxRedirects: proxyConfig.imageProxyMaxRedirects,
        },
    )

    if (!upstreamResponse.ok || !upstreamResponse.body) {
        throw new HttpError(
            502,
            `Upstream image request failed with status ${upstreamResponse.status}`,
        )
    }

    const headers = new Headers()
    headers.set(
        'Cache-Control',
        pickHeader(upstreamResponse.headers, 'cache-control') ??
        'public, max-age=604800, s-maxage=604800, immutable',
    )
    headers.set('X-Content-Type-Options', 'nosniff')

    if (options.crop) {
        const arrayBuffer = await upstreamResponse.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)

        let pipeline = sharp(buffer)
        const metadata = await pipeline.metadata()

        if (metadata.width && metadata.height) {
            const halfWidth = Math.floor(metadata.width / 2)
            pipeline = pipeline.extract({
                left: options.crop === 'right' ? halfWidth : 0,
                top: 0,
                width: halfWidth,
                height: metadata.height,
            })
        }

        const outputBuffer = await pipeline.webp({ quality: 84 }).toBuffer()

        headers.set('Content-Type', 'image/webp')
        headers.set('Content-Length', outputBuffer.length.toString())

        const etag = pickHeader(upstreamResponse.headers, 'etag')
        if (etag) {
            headers.set('ETag', `${etag}-crop-${options.crop}`)
        }
        const lastModified = pickHeader(upstreamResponse.headers, 'last-modified')
        if (lastModified) {
            headers.set('Last-Modified', lastModified)
        }

        return new Response(outputBuffer, {
            status: 200,
            headers,
        })
    }

    headers.set(
        'Content-Type',
        pickHeader(upstreamResponse.headers, 'content-type') ??
        'application/octet-stream',
    )

    const copyHeaders = ['content-length', 'etag', 'last-modified']

    for (const key of copyHeaders) {
        const value = pickHeader(upstreamResponse.headers, key)
        if (value) {
            headers.set(key, value)
        }
    }

    return new Response(upstreamResponse.body, {
        status: 200,
        headers,
    })
}
