# Connector Interface

## Contract

Defined in `src/connectors/connector.ts`:

- `getSeries(urlOrId)`
- `listChapters(series)`
- `getChapterManifest(chapter)`

## Implementations

- `DemoConnector` (`src/connectors/demo-connector.ts`)
  - Uses in-repo seeded demo data.
- `LocalUploadConnector` (`src/connectors/local-upload-connector.ts`)
  - Reads local-imported content from app storage.
- `CustomConnectorStub` (`src/connectors/custom-connector-stub.ts`)
  - Throws with warning:
    - Implement only for sources you have explicit rights/permission to access.

## Notes

- This repository intentionally does not include any site-specific scraping implementation.
