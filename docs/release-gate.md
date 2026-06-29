# Automated Ship Gate

## Local Repro

- Full PR gate: `pnpm test:ci`
- PWA audit (main/nightly parity): `pnpm test:lighthouse`
- v1 online-release lock checks: `pnpm verify:release:v1`

For the current first-release scope, see:
- `docs/release-v1-online-checklist.md`

## CI Workflows

- `.github/workflows/ci.yml`
  - `quality` (typecheck + unit tests + build)
  - `deploy-cloudflare` (on main push, after quality passes)
- `.github/workflows/pwa-audit.yml`
  - `pwa-audit` on `main` pushes and nightly schedule

### Notes

E2E tests (`test:e2e:desktop`, `test:e2e:mobile`) are defined but not yet wired into CI —
they require Playwright browsers and a web server setup. Run them locally with:

```bash
pnpm test:e2e:desktop
pnpm test:e2e:mobile
```

## Branch Protection (GitHub Settings)

Configure branch protection for `main` with required status checks:

- `quality`

## Visual Baseline Updates

Visual snapshots are committed and gated in CI. Update only in explicit snapshot PRs:

- `pnpm exec playwright test tests/e2e/visual-reader.spec.ts --update-snapshots`
