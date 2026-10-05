# API and data contracts

**Status:** Partial — few JSON APIs today; most UI is HTML. Capture conventions so new endpoints stay consistent.

## What exists today

| Surface                                   | Type                                                        | Notes                                                                     |
| ----------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------- |
| Most manage routes                        | HTML (Nunjucks)                                             | Primary contract is view-models → templates                               |
| `GET/POST /consultee-areas-python`        | HTML wrapping JSON from Python                              | Server-side `fetch` with `x-api-key`; browser never calls Python directly |
| `GET/POST /consultee-areas-direct`        | HTML wrapping `consultee_area` rows                         | Same data, straight from Node → SQL                                       |
| `POST /admin/upload-to-blob/run`          | `multipart/form-data` upload                                | File → blob container via managed identity                                |
| `POST /admin/import-reference-data/run-*` | HTML                                                        | Blob → SQL import (`geojson-import`)                                      |
| Static map routes                         | `image/avif`, `image/webp`, `image/png`, or `image/svg+xml` | `Accept`-negotiated (`Vary: Accept`) + cache headers + ETag               |
| Map config on results pages               | JSON in `<script type="application/json">`                  | Small config for client map init — not full DB dumps                      |
| Monitoring / health                       | From shared core controllers                                | Used by platform probes                                                   |

There is no large public JSON “cases API” in manage yet.

## GeoJSON / WGS84 conventions

| Convention        | Guidance                                                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Axis order        | GeoJSON `[longitude, latitude]`                                                                                             |
| CRS               | WGS84 (CRS84) for web maps unless explicitly documented otherwise                                                           |
| FeatureCollection | Preferred unit between Node map helpers and client config                                                                   |
| SQL geometry      | Stored spatially in SQL Server; Python returns WKT via `STAsText()` for transport where needed                              |
| Large geometries  | Prefer separate map/data endpoints or server-side static render — **do not** embed huge coordinate arrays in HTML templates |

## Error handling patterns

| Layer                 | Pattern                                                                                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| HTML pages            | Render error text / GOV.UK error summary; keep HTTP 200 for handled soft failures where that is existing behaviour (Python bridge) or use appropriate status for hard failures |
| Missing optional deps | Soft fail with message (Python URL unset)                                                                                                                                      |
| Auth                  | 401 unauthenticated page; group failures via shared guards                                                                                                                     |
| Static map            | Cache miss may fetch upstream; failures should not unhandled-reject the whole app                                                                                              |

When adding JSON endpoints, prefer:

- Consistent `{ error: { code, message } }` or problem+json (decide explicitly)
- No stack traces to browsers
- No connection strings or tokens in bodies/logs at info level

## Keeping large geometry out of HTML

Checklist for new map pages:

1. Put coordinates in dedicated JSON endpoints or compact config only if small
2. Prefer static-map images for noscript instead of inline SVG with thousands of points (unless already justified)
3. Fingerprint and cache map assets
4. Never print full GeoJSON into Nunjucks for “convenience”

## Related pages

- [Maps](./maps.md)
- [Node–Python integration](./node-python-integration.md)
