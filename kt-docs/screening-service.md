# Screening service

The screening (which consultees a project needs) runs in the Python Function App, `apps/function-python`. The web app calls it for every page that shows a ruleset's results: the project page, the report pages, the results page and the static map. How the engine works inside is in [Screening engine](./data/screening-engine.md); the function's layout and setup are in its [README](../apps/function-python/README.md).

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
	]
}
```

- `consultees`: each consultee once, nearest first (ties by id). The union of every condition's matches and every area within `nearbyRadiusMetres` (any category except Railway).
- `reasons`: at least one. A `condition` for each condition met, in the ruleset's order, then `nearby` if within the radius. The web app turns them into **Why identified** text (`views/consultees/reasons.ts`).
- `geometryWkt`: only for condition matches. The map draws every consultee from the web app's own display geometry.
- Ids are lowercase, matching the web app's Prisma queries, which use them for display geometry and `exclude=` URLs.
- Errors: 401 for a bad or missing key; 500 `{ "error": "Failed to run the ruleset" }` with no internal detail.

## Other routes

| Route                      | What it does                                                                                                                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health`          | Checks the database is reachable. No key                                                                                                                                                                 |
| `GET /api/consultee-areas` | Nearby `consultee_area` rows as WKT. Used by the `/consultee-areas-python` dev page; `/consultee-areas-direct` runs the same query from Node, to tell "the function is down" from "the database is down" |

## Security

Both data routes fail closed: with `CONSULTEE_AREAS_API_KEY` unset they return 500, and a wrong or missing `x-api-key` gets 401. In Azure, Terraform generates the key, stores it in Key Vault and gives it to both apps; the function sits behind a private endpoint (`infrastructure/app-function.tf`). Locally `npm start` gives both apps the same key. The browser never calls the function.

## Tests

CI doesn't run the function, so the web app's tests stand in for it: controller tests inject `rulesetRunnerReturning` or `failingRulesetRunner`, and the Playwright test server uses `buildDatabaseRulesetRunner` (`apps/manage/src/app/testing/ruleset-runner-stub.ts`), a deliberately simple database query. The real logic is tested with pytest in `apps/function-python`.

## Adding a route

Add it in `function_app.py` with the same key check, keep the web app's caller resilient (catch, log, show an error; never crash the page), stub `fetch` in its tests, and document the contract here.
