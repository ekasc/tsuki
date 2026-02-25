# Tsuki Reader

Tsuki is a web manga reader focused on fast reading, RTL-first navigation, and a clean cross-device experience.

## Core Features

- RTL manga reading with `single`, `double`, and `scroll` modes.
- Desktop reader controls with keyboard shortcuts, zoom modes, and magnifier.
- Reading progress + history persistence per chapter.
- Content ingestion from local archives (`.cbz` / `.zip`) and remote chapter flows.

## Quick Start

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Testing

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
