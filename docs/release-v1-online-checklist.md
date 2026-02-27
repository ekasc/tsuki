# Tsuki v1 Online Release Checklist

This checklist is for the first public release in online-reader mode with BYO uploads disabled on Cloudflare.

## 1) Deployment Mode Lock (BYO Off)

- [ ] `pnpm verify:release:v1` passes.
- [ ] `wrangler.jsonc` keeps `vars.TSUKI_LOCAL_LIBRARY_ENABLED = "0"`.
- [ ] Cloudflare build/deploy scripts keep `VITE_LOCAL_LIBRARY_ENABLED=0`.

## 2) Quality Gate (Must Pass)

- [ ] `pnpm test:type`
- [ ] `pnpm test:unit`
- [ ] `pnpm build`
- [ ] `pnpm test:e2e:desktop`
- [ ] `pnpm test:e2e:mobile`
- [ ] `pnpm test:visual`

## 3) Mainline Audit

- [ ] `pwa-audit` workflow runs on `main` and nightly.
- [ ] Lighthouse artifact exists for push/nightly runs.

## 4) Branch Protection

- [ ] `quality` required on `main`.
- [ ] `e2e-desktop` required on `main`.
- [ ] `e2e-mobile` required on `main`.
- [ ] `visual-regression` required on `main`.

## 5) Release Command Set

```bash
pnpm verify:release:v1
pnpm test:ci
pnpm deploy:cloudflare:dry
pnpm deploy:cloudflare
```
