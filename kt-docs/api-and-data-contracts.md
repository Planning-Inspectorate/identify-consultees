# API and data contracts

**Status:** Partial — few JSON APIs today; most UI is HTML. Capture conventions so new endpoints stay consistent.

## What exists today

| Surface                                   | Type                                                        | Notes                                                                     |
| ----------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------- |
| Most manage routes                        | HTML (Nunjucks)                                             | Primary contract is view-models → templates                               |
| Python `POST /api/run-ruleset`            | JSON, server to server                                      | The consultee intersection logic — see [Run ruleset](#run-ruleset) below  |
| `GET/POST /consultee-areas-python`        | HTML wrapping JSON from Python                              | Server-side `fetch` with `x-api-key`; browser never calls Python directly |
| `GET/POST /consultee-areas-direct`        | HTML wrapping `consultee_area` rows                         | Same data, straight from Node → SQL                                       |
| `POST /admin/upload-to-blob/run`          | `multipart/form-data` upload                                | File → blob container via managed identity                                |
| `POST /admin/import-reference-data/run-*` | HTML                                                        | Blob → SQL import (`geojson-import`)                                      |
| Static map routes                         | `image/avif`, `image/webp`, `image/png`, or `image/svg+xml` | `Accept`-negotiated (`Vary: Accept`) + cache headers + ETag               |
| Map config on results pages               | JSON in `<script type="application/json">`                  | Small config for client map init — not full DB dumps                      |
| Monitoring / health                       | From shared core controllers                                | Used by platform probes                                                   |

There is no large public JSON “cases API” in manage yet.

## Run ruleset

`POST {function}/api/run-ruleset` on the Python function, called only by the manage app (`apps/manage/src/app/ruleset-runner.ts`). Requires the `x-api-key` shared secret.

Request:

```json
{
	"siteWkt": "POLYGON((...))",
	"nearbyRadiusMetres": 20000,
	"rules": [
		{ "id": "hospital", "logicType": "intersection", "categories": ["Hospital"], "bufferMetres": 10000 },
		{
			"id": "a_bordering_b_host_parish_comm_council",
			"logicType": "bordering",
			"categories": ["Parish Council"],
			"hostCategory": "Parish Council"
		}
	]
}
```

`bufferMetres` defaults to 0 (must touch the site). Distances are capped at 500km, rules at 500 and categories at 50 per rule; anything malformed is a 400 with `{ "error": "..." }` and never reaches the database.

Response (200):

```json
{
	"matches": [
		{
			"feature": {
				"id": "<lowercase uuid>",
				"properties": {
					"consulteeCategory": "Hospital",
					"consultee": "...",
					"region": "...",
					"caseReference": null,
					"documentId": null,
					"consulteeId": null,
					"organisationId": null,
					"currentVersion": 1,
					"metadata": {}
				},
				"geometryWkt": "POINT (...)"
			},
			"distanceMetres": 6512.3
		}
	],
	"allNearby": [{ "feature": { "id": "...", "properties": { "...": "..." } }, "distanceMetres": 0 }]
}
```

- `matches`: the union of every condition, de-duplicated, nearest first (ties by id), each with its original geometry as WKT
- `allNearby`: every area within `nearbyRadiusMetres`, any category except Railway, without geometry
- Ids are lowercase, matching what the manage app's own Prisma queries return — it uses them to look up display geometry and in `exclude=` URLs
- Errors: 401 (bad key), 500 `{ "error": "Failed to run the ruleset" }` (no internal detail)

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
