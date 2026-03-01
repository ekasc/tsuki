# BYO Service Contract (Future)

This document defines the external API boundary for reintroducing BYO upload/read support as a separate Node service.

## Scope

- The Tsuki Cloudflare Worker stays online-focused and does not ingest archives.
- The BYO service owns upload ingestion, image processing, persistence, and session policies.
- Tsuki consumes BYO endpoints over HTTP and does not execute `sharp` or SQLite on Worker request paths.

## API Endpoints

### `POST /byo/sessions`
Create a temporary BYO session.

Request:

```json
{
  "clientId": "optional-string",
  "userAgent": "optional-string"
}
```

Response `201`:

```json
{
  "sessionId": "string",
  "expiresAt": 0,
  "limits": {
    "maxArchiveBytes": 0,
    "maxChapters": 0
  }
}
```

### `POST /byo/ingest`
Upload a chapter archive into a session.

Request:
- `multipart/form-data`
- fields:
- `sessionId` (required)
- `archive` (required)
- `seriesTitle` (optional)
- `chapterTitle` (optional)
- `chapterNumber` (optional integer)

Response `201`:

```json
{
  "seriesId": "string",
  "chapterId": "string",
  "title": "string",
  "pageCount": 0
}
```

### `GET /byo/series/:id`
Resolve series detail and chapter list.

Response `200`:

```json
{
  "id": "string",
  "title": "string",
  "description": "string|null",
  "source": "local-upload",
  "chapters": [
    {
      "id": "string",
      "title": "string",
      "chapterNumber": 1,
      "sortIndex": 1,
      "pageCount": 0
    }
  ]
}
```

### `GET /byo/chapters/:id`
Resolve chapter manifest + progress.

Response `200`:

```json
{
  "manifest": {
    "chapterId": "string",
    "seriesId": "string",
    "title": "string",
    "chapterNumber": 1,
    "pageCount": 0,
    "pages": [
      {
        "id": "string",
        "chapterId": "string",
        "pageIndex": 0,
        "width": 0,
        "height": 0,
        "aspect": 0,
        "autoIsSpread": false,
        "splitSpread": null
      }
    ]
  },
  "progress": null
}
```

### `GET /byo/images/:id/:page`
Stream chapter image bytes (full-size or thumbnail/resize variants).

Query:
- `thumb=1` optional
- `w=<int>` optional
- `h=<int>` optional
- `crop=left|right` optional

Response:
- `200` image payload with cache headers + ETag
- `304` when `If-None-Match` matches

## Error Contract

Errors are JSON and align with Tsuki API behavior:

```json
{ "error": "message" }
```

Expected statuses:
- `400` invalid input
- `401` invalid/expired session
- `404` not found
- `413` archive too large
- `415` unsupported media
- `429` rate limited
- `500` internal error

## Non-Goals for This Contract

- No Worker-side archive ingestion.
- No Worker-local persistence for BYO assets.
- No offline mirroring or pre-cache policy definitions.
