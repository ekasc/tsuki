import dns from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'

import { HttpError } from '#/server/errors'

import { TtlCache } from './cache'

const dnsCache = new TtlCache<string, string[]>(60_000)

const blockedRanges = new BlockList()

blockedRanges.addSubnet('127.0.0.0', 8, 'ipv4')
blockedRanges.addSubnet('10.0.0.0', 8, 'ipv4')
blockedRanges.addSubnet('172.16.0.0', 12, 'ipv4')
blockedRanges.addSubnet('192.168.0.0', 16, 'ipv4')
blockedRanges.addSubnet('169.254.0.0', 16, 'ipv4')
blockedRanges.addSubnet('100.64.0.0', 10, 'ipv4')
blockedRanges.addAddress('169.254.169.254', 'ipv4')
blockedRanges.addAddress('100.100.100.200', 'ipv4')

blockedRanges.addAddress('::1', 'ipv6')
blockedRanges.addAddress('::', 'ipv6')
blockedRanges.addSubnet('fc00::', 7, 'ipv6')
blockedRanges.addSubnet('fe80::', 10, 'ipv6')

interface SafeFetchOptions {
  allowedHostnames: string[]
  maxRedirects?: number
}

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase()
}

function normalizeIpAddress(address: string): string {
  const withoutZone = address.split('%')[0] ?? address
  const lowered = withoutZone.toLowerCase()

  if (lowered.startsWith('::ffff:')) {
    const ipv4Part = lowered.slice('::ffff:'.length)
    if (isIP(ipv4Part) === 4) {
      return ipv4Part
    }
  }

  return lowered
}

function isBlockedIpAddress(address: string): boolean {
  const normalized = normalizeIpAddress(address)
  const family = isIP(normalized)

  if (family === 4) {
    return blockedRanges.check(normalized, 'ipv4')
  }

  if (family === 6) {
    return blockedRanges.check(normalized, 'ipv6')
  }

  return true
}

export function isHostnameAllowed(
  hostname: string,
  allowedHostnames: string[],
): boolean {
  const normalized = normalizeHostname(hostname)

  return allowedHostnames.some((entry) => {
    const candidate = normalizeHostname(entry)
    return normalized === candidate || normalized.endsWith(`.${candidate}`)
  })
}

async function resolveHostnameIps(hostname: string): Promise<string[]> {
  const normalizedHostname = normalizeHostname(hostname)
  const cached = dnsCache.get(normalizedHostname)

  if (cached) {
    return cached
  }

  const records = await dns.lookup(normalizedHostname, {
    all: true,
    verbatim: true,
  })

  const addresses = Array.from(
    new Set(records.map((record) => normalizeIpAddress(record.address))),
  )

  if (addresses.length === 0) {
    throw new HttpError(502, 'Unable to resolve upstream host')
  }

  dnsCache.set(normalizedHostname, addresses)
  return addresses
}

async function assertSafeDnsResolution(url: URL): Promise<void> {
  const host = normalizeHostname(url.hostname)
  const directIpFamily = isIP(host)

  if (directIpFamily !== 0) {
    if (isBlockedIpAddress(host)) {
      throw new HttpError(403, 'Blocked upstream host')
    }
    return
  }

  const ips = await resolveHostnameIps(host)

  for (const ip of ips) {
    if (isBlockedIpAddress(ip)) {
      throw new HttpError(403, 'Blocked upstream host')
    }
  }
}

export async function assertSafeUpstreamUrl(
  candidate: URL | string,
  allowedHostnames: string[],
): Promise<URL> {
  let parsed: URL

  try {
    parsed = candidate instanceof URL ? candidate : new URL(candidate)
  } catch {
    throw new HttpError(400, 'Invalid upstream URL')
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new HttpError(400, 'Only HTTP(S) upstream URLs are allowed')
  }

  if (parsed.username || parsed.password) {
    throw new HttpError(400, 'Upstream credentials are not allowed')
  }

  if (!isHostnameAllowed(parsed.hostname, allowedHostnames)) {
    throw new HttpError(403, 'Upstream host is not allowed')
  }

  await assertSafeDnsResolution(parsed)
  return parsed
}

function isRedirectStatus(status: number): boolean {
  return [301, 302, 303, 307, 308].includes(status)
}

export async function fetchWithSafeRedirects(
  input: URL | string,
  init: RequestInit,
  options: SafeFetchOptions,
): Promise<Response> {
  const maxRedirects = options.maxRedirects ?? 5
  let currentUrl = await assertSafeUpstreamUrl(input, options.allowedHostnames)
  let method = init.method ?? 'GET'
  let body = init.body

  for (
    let redirectCount = 0;
    redirectCount <= maxRedirects;
    redirectCount += 1
  ) {
    const response = await fetch(currentUrl, {
      ...init,
      method,
      body,
      redirect: 'manual',
    })

    if (!isRedirectStatus(response.status)) {
      return response
    }

    if (redirectCount === maxRedirects) {
      throw new HttpError(502, 'Too many upstream redirects')
    }

    const location = response.headers.get('location')

    if (!location) {
      throw new HttpError(502, 'Invalid upstream redirect response')
    }

    const nextUrl = new URL(location, currentUrl)
    currentUrl = await assertSafeUpstreamUrl(nextUrl, options.allowedHostnames)

    if (response.status === 303 && method !== 'GET' && method !== 'HEAD') {
      method = 'GET'
      body = undefined
    }
  }

  throw new HttpError(502, 'Failed to fetch upstream resource')
}
