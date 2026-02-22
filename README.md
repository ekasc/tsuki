# Suki Reader (TanStack Start)

Local-first manga/comic reader built with TanStack Start + React + TypeScript.

## Scope

This project intentionally ships only:

1. Local CBZ/ZIP import (plus local folder-backed demo seed).
2. Legal in-repo demo connector/data.
3. Connector interface + `CustomConnectorStub` with explicit permission warning.

No site-specific scraping connectors are implemented.

## Features

- Library -> series -> chapter -> reader flow.
- Reader modes:
  - Single-page paging
  - Two-page paging
  - Continuous scroll (virtualized)
- Drag-and-drop archive import.
- Reading history panel on Library (localStorage-backed).
- LTR keyboard navigation:
  - `ArrowRight` next
  - `ArrowLeft` previous
- Two-page safety invariant: never renders 3 pages at once.
- Spread detection is automatic from page width (no manual spread/single marking UI).
- Progress persistence per chapter (mode, direction, zoom, page/step).
- Secure ingest path:
  - ZIP/CBZ file validation and size limits
  - Rate-limited ingestion endpoint
  - Safe storage path handling
  - Thumbnail generation and dimension extraction with retry/backoff
- Image proxy endpoint with cache headers + optional resize cache.

## Assumptions

- Single local profile (`profileId = local`) for progress.
- Local storage root is `./data`.
- Default spread threshold is `width >= medianSingleWidth * 1.35`.
- Uploading an archive creates a new series and chapter by default.

## How To Run

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## How To Test

```bash
pnpm lint
pnpm test
pnpm playwright test
```

## Key Architecture

- App routes/UI: `src/routes/`
- Reader core and pairing logic: `src/lib/reader/pairing.ts`
- Reader components: `src/components/reader/`
- Server bootstrap + APIs: `src/server/bootstrap.ts`, `src/routes/api.*.ts`
- Ingest pipeline: `src/server/ingest/import-archive.ts`
- Demo seed data generation: `src/server/ingest/seed-demo.ts`
- Image proxy/caching: `src/server/image-service.ts`
- SQLite + Drizzle schema: `src/server/db/schema.ts`, `drizzle/0000_initial_schema.sql`
- Connectors: `src/connectors/`

## Pairing Algorithm + Tuning

- Core module: `src/lib/reader/pairing.ts`
- Behavior:
  - Spread at `i` -> render alone (or split into exactly two halves if split enabled)
  - Non-spread at `i` pairs with `i+1` only when `i+1` exists and is not spread
  - Consequence: max 2 render units in two-page mode
- Tuning knobs:
  - `DEFAULT_SPREAD_CONFIG.widthMultiplier` (default `1.35`)

## Additional Docs

- Connector interface details: `docs/connectors.md`
- Architecture decision record: `docs/adrs/0001-local-first-reader-architecture.md`
- Threat model: `docs/threat-model.md`
