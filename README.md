# Tsuki Reader

Tsuki is a web manga reader focused on fast reading, RTL-first navigation, and a clean cross-device experience.

## Core Features

- RTL manga reading with `single`, `double`, and `scroll` modes.
- Desktop reader controls with keyboard shortcuts, zoom modes, and magnifier.
- Reading progress + history persistence per chapter.
- Online-first chapter reading flow with WeebCentral integration.

## Quick Start

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy (Cloudflare)

```bash
pnpm deploy:cloudflare:dry
pnpm deploy:cloudflare
```

This deploys a single Cloudflare Worker that serves the app and API routes.
Default Cloudflare mode is online-reader focused (`TSUKI_LOCAL_LIBRARY_ENABLED=0`), so local file upload/library APIs are disabled.
Production domain is configured via `wrangler.jsonc` as `https://tsukireader.com`.

### GitHub Actions deploy (`main` -> production)

The CI workflow deploys to Cloudflare automatically after all checks pass on pushes to `main`.
Set these repository secrets first:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

If you split frontend and backend:
- Build frontend with `VITE_API_BASE_URL=https://your-backend-origin`.
- Run backend where Node native modules are available and set `TSUKI_LOCAL_LIBRARY_ENABLED=1` there.

## Testing

Run the v1 online release lock checks:

```bash
pnpm verify:release:v1
```

Run the full local ship gate:

```bash
pnpm test:ci
```

Run the PWA/performance audit:

```bash
pnpm test:lighthouse
```

If you intentionally changed reader visuals, update snapshots in a dedicated PR:

```bash
pnpm exec playwright test tests/e2e/visual-reader.spec.ts --update-snapshots
```

Release checklist: `/Users/ekassinghchhabra/Projects/ts/suki/docs/release-v1-online-checklist.md`

## Contributing

1. Create a focused branch for one change set.
2. Install dependencies with `pnpm install` and run locally with `pnpm dev`.
3. Keep changes scoped and avoid unrelated refactors in the same PR.
4. Run `pnpm test:ci` before opening a PR.
5. Include a clear PR description:
   - what changed
   - why it changed
   - test evidence (and screenshots for UI changes)
6. For visual updates, call out snapshot changes explicitly in the PR.
