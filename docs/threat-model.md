# Threat Model (Brief)

## Assets

- Local chapter/image files under `./data`
- Reader progress metadata
- Server-side ingest/image APIs

## Threats + Mitigations

- Malicious archive upload
  - Mitigations: extension and MIME checks, max archive/page size limits, max entry count.
- Path traversal via filenames or image requests
  - Mitigations: generated storage filenames and `safeResolveDataPath` validation.
- Endpoint abuse (ingest spam)
  - Mitigations: in-memory rate limiting per client identifier.
- Resource exhaustion during media processing
  - Mitigations: bounded concurrency + retry/backoff.
- Unsafe content exposure in image proxy
  - Mitigations: proxy resolves only DB-backed chapter/page paths; content-type nosniff header.

## Residual Risks

- In-memory rate limiting is process-local (not distributed).
- Local single-user profile model is not multi-tenant hardened.
- Archive decompression still depends on host resources; very large/deep archives are limited but not fully sandboxed.
