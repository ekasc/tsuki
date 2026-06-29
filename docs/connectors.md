# Data Providers

## Contract

The `LocalLibraryProvider` interface is defined in `src/server/local-library/provider.ts`:

- `listSeries()` — return all local library series
- `getSeries(seriesId)` — return detailed series with chapters
- `deleteSeries(seriesId)` — delete a series and its files
- `getChapter(chapterId)` — return chapter manifest with page metadata
- `updateProgress(payload)` — persist reading progress
- `updatePageOverrides(chapterId, pageIndex, payload)` — set spread/split flags
- `getImageResponse(request, chapterId, pageIndex, options)` — serve images with caching

## Implementations

- **Node provider** (`src/server/local-library/providers/node-provider.ts`)
  - Full local library backed by SQLite + filesystem. Used when Node native modules are available.
- **Fixture provider** (`src/server/local-library/providers/fixture-provider.ts`)
  - In-memory demo data for testing and development.
- **Disabled provider** (`src/server/local-library/providers/disabled-provider.ts`)
  - Throws 503 for all operations. Active on Cloudflare deployments.

## Remote Proxy

Online content (WeebCentral, MangaDex) is served through the proxy layer at `src/server/proxy/`:
- `src/server/proxy/adapters/weebcentral.ts` — HTML scraping of series/chapter metadata
- `src/server/proxy/adapters/mangadex.ts` — MangaDex API v5 integration
- `src/server/proxy/routes/imageProxy.ts` — secured image proxy with SSRF protection
- `src/server/proxy/utils/security.ts` — DNS validation, blocklist, safe redirects

## Notes

- This repository does not include any site-specific scraping that circumvents access controls.
- Remote providers implement only the read path; all write/persistence goes through the local library provider.
