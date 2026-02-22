# ADR-0001: Local-First Reader Architecture

## Status

Accepted

## Context

The product must provide a legally safe reading experience with local ingestion and a demo data path, while avoiding scraping connectors.

## Decision

- Use TanStack Start + React + TypeScript for app shell/routes.
- Persist manifests and progress in local SQLite via Drizzle schema/migrations.
- Store extracted pages and thumbnails under `./data`.
- Provide API routes for ingest, manifest delivery, progress updates, and image proxy.
- Seed legal demo content at first run for immediate reader testing.
- Keep connector abstraction with explicit warning-only custom stub.

## Consequences

- Portable local development setup with no remote content dependency.
- Reader correctness is testable with deterministic demo chapters.
- Security-sensitive ingest/image paths are centralized in server modules.
