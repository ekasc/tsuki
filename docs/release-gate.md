# Automated Ship Gate

## Local Repro

- Full PR gate: `pnpm test:ci`
- PWA audit (main/nightly parity): `pnpm test:lighthouse`
- v1 online-release lock checks: `pnpm verify:release:v1`

For the current first-release scope, use:
- `/Users/ekassinghchhabra/Projects/ts/suki/docs/release-v1-online-checklist.md`

## CI Workflows

- `/Users/ekassinghchhabra/Projects/ts/suki/.github/workflows/ci.yml`
  - `quality`
  - `e2e-desktop`
  - `e2e-mobile`
  - `visual-regression`
- `/Users/ekassinghchhabra/Projects/ts/suki/.github/workflows/pwa-audit.yml`
  - `pwa-audit` on `main` pushes and nightly schedule

## Branch Protection (GitHub Settings)

Configure branch protection for `main` with required status checks:

- `quality`
- `e2e-desktop`
- `e2e-mobile`
- `visual-regression`

`pwa-audit` should be used for release decisioning on `main`, but does not need to block every PR merge.

## Visual Baseline Updates

Visual snapshots are committed and gated in CI. Update only in explicit snapshot PRs:

- `pnpm exec playwright test tests/e2e/visual-reader.spec.ts --update-snapshots`
