# Screening service

The screening (which consultees a project needs) runs in the Python Function App, `apps/function-python`. The web app calls it for every page that shows a ruleset's results: the project page, the report pages and the static map. How the engine works inside is in [Screening engine](./data/screening-engine.md); the function's layout and setup are in its [README](../apps/function-python/README.md).

## The call

1. `service.rulesetRunner` (`apps/manage/src/app/ruleset-runner.ts`) posts to `/api/run-ruleset`, resolved next to `PYTHON_FUNCTION_URL` (which names the `consultee-areas` route, so one setting covers both), with the `x-api-key` header.
2. The body carries the site as WKT, the nearby radius and the selected ruleset's conditions. The definitions stay in the web app (`packages/database/src/geospatial/rulesets.ts`, built from the ruleset CSV), which also uses them to explain each consultee.
3. The function validates the body (`intersector/api.py`), runs `run_ruleset` (`intersector/screening.py`) and returns the consultees with their reasons.
4. `runRulesetSafely` turns any failure (URL unset, unreachable, 60s timeout, non-2xx) into a "The ruleset could not be run" banner with a Try again link.

There's no fallback in Node, on purpose: one implementation, not two that could quietly disagree. Search, the pickers and the footer pages work without the function.

## `POST /api/run-ruleset`

Request:

```json
{
	"siteWkt": "POLYGON((...))",
	"nearbyRadiusMetres": 20000,
	"nearbyRadiusMetresByCategory": { "Parish Council": 5000, "Hospital": 0 },
	"includeGeometry": false,
	"boundingBoxAbovePoints": 2000,
	"boundingBox": false,
	"dataset": "2026Q4",
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

`bufferMetres` defaults to 0 (must touch the site). Distances are capped at 500km, rules at 500 and categories at 50 per rule. Anything malformed is a 400 with `{ "error": "..." }` and never reaches the database.

Response (200):

```json
{
	"consultees": [
		{
			"feature": {
				"id": "<lowercase uuid>",
				"properties": { "consulteeCategory": "Hospital", "consultee": "...", "region": "...", "...": "..." },
				"geometryWkt": "POINT (...)"
			},
			"distanceMetres": 6512.3,
			"reasons": [
				{ "type": "condition", "conditionId": "hospital" },
				{ "type": "nearby", "radiusMetres": 20000 }
			]
		}
	],
	"siteScreenedAs": "outline"
}
```

- `nearbyRadiusMetresByCategory` (optional): a category's own nearby distance, overriding `nearbyRadiusMetres`; 0 means never nearby. The web app sends [`config/nearby-consultees.yaml`](../config/nearby-consultees.yaml).
- `consultees`: each consultee once, nearest first (ties by id). The union of every condition's matches and every area within its category's nearby distance (else `nearbyRadiusMetres`) (any category except Railway).
- `reasons`: at least one. A `condition` for each condition met, in the ruleset's order, then `nearby` if within the radius. The web app turns them into **Why identified** text (`views/consultees/reasons.ts`).
- `includeGeometry` (optional, default `true`): whether condition matches carry `geometryWkt`. The web app sends `false`: its maps draw every consultee from its own display geometry. Leaving geometry out means it's never read, which about halves a run (EN0110007: 3.9s and 75MB to 2.0s and 0.13MB, with the full reference data loaded locally).
- `geometryWkt`: only for condition matches, and only when `includeGeometry` is `true`.
- `boundingBoxAbovePoints` (optional): screen a site whose outline, simplified to 10m, has more points than this against its bounding box instead: the rectangle of longitude and latitude around it, 1km wider all round (`queries.bounding_box`). The web app sends [`config/screening.yaml`](../config/screening.yaml)'s, 2,000 to start. Without it the outline is always screened.
- `boundingBox` (optional, default `false`): screen the bounding box whatever the site's detail. The web app asks for it when a run on the outline fails or times out.
- `dataset` (optional): a quarter's consultee areas to screen (`2026Q4`, its table `consultee_area_2026Q4`) rather than the dataset in use (the `consultee_area` synonym - see [Data model and loading](./data/data-model.md#loading)). One with no table is a 400 `{ "error": "There is no 2025Q1 dataset" }`. The web app doesn't send it yet.
- `siteScreenedAs`: `outline`, or `boundingBox`. A box finds every consultee the outline would and more: for a long, diagonal site, many that aren't near it (the most detailed local site: 708 "host" parishes against 89). The web app warns on the check and category pages, and the workbook's Summary says so.
- Ids are lowercase, matching the web app's Prisma queries, which use them for display geometry and `exclude=` URLs.
- Errors: 401 for a bad or missing key; 500 `{ "error": "Failed to run the ruleset" }` with no internal detail.

## Other routes

| Route                                           | What it does                                                                                                                                                                                             |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health`                               | Checks the database is reachable. No key                                                                                                                                                                 |
| `GET /api/cbos/health`                          | Signs in to CBOS's database and document storage as the app's identity and reports each - for checking access from the command line                                                                      |
| `GET /api/cbos/boundary-files`                  | Every case boundary file CBOS has converted to GeoJSON, every version (see [Data model and loading](./data/data-model.md#case-boundaries-from-cbos))                                                     |
| `GET /api/cbos/boundary-files/{guid}/{version}` | One file's GeoJSON. The blob path comes from CBOS's database, never the caller                                                                                                                           |
| `GET /api/consultee-areas`                      | Nearby `consultee_area` rows as WKT. Used by the `/consultee-areas-python` dev page; `/consultee-areas-direct` runs the same query from Node, to tell "the function is down" from "the database is down" |

## Security

Both data routes fail closed: with `CONSULTEE_AREAS_API_KEY` unset they return 500, and a wrong or missing `x-api-key` gets 401. In Azure, Terraform generates the key, stores it in Key Vault and gives it to both apps; the function sits behind a private endpoint (`infrastructure/app-function.tf`). Locally `npm start` gives both apps the same key. The browser never calls the function.

## Tests

CI doesn't run the function, so the web app's tests stand in for it: controller tests inject `rulesetRunnerReturning` or `failingRulesetRunner`, and the Playwright test server uses `buildDatabaseRulesetRunner` (`apps/manage/src/app/testing/ruleset-runner-stub.ts`), a deliberately simple database query. The real logic is tested with pytest in `apps/function-python`.

## Adding a route

Add it in `function_app.py` with the same key check, keep the web app's caller resilient (catch, log, show an error; never crash the page), stub `fetch` in its tests, and document the contract here.
