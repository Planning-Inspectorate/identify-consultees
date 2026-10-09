# Web app

`apps/manage`: Express, Nunjucks and GOV.UK Frontend on Node 24. Pages are server-rendered. Client JS only enhances them, mainly the maps.

## Layout

```
apps/manage/
  src/
    server.ts          # listen, trust proxy
    app/
      app.ts           # createApp: static assets, security headers, Nunjucks, router
      router.ts        # mounts feature routers (dev pages behind devPagesEnabled)
      config.ts        # env → typed config
      service.ts       # ManageService: db, logger, rulesetRunner, blob client
      maps/            # static map render, cache and serve; Defra vendor assets; results map config
      views/           # one folder per feature: index.ts router, controller, view-model, view.njk
      security/        # CSP and header helpers
      sass/            # GOV.UK and PINS overrides
    util/              # build, asset fingerprinting, static middleware, inline JSON
  public/              # client JS and images, fingerprinted into src/.static
  e2e/                 # Playwright journeys (need the seeded local database)
```

A request goes: `server.ts` → `createApp` → `buildRouter` (monitoring, `/vendor/*`, auth, then features) → a controller that queries `packages/database` or the Python function through `service`, builds a view model and renders Nunjucks. Map page config goes into the page as `<script type="application/json">` (`util/inline-json.ts`) and the client JS finds its containers by class.

## Routes

| Path                                                                        | Page                                                                                                                         |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `GET /`                                                                     | Project search (`q`), `pageSize` 25, 50 or 100, and `page`. SQL over `case_boundary` (`searchCaseBoundaries`)                |
| `GET, POST /consultees/:caseId`                                             | Project boundary page: map of the case's shapefiles, radios to confirm the file for the report. Posts on to the ruleset page |
| `GET /consultees/:caseId/boundary-map(.svg)`                                | Static boundary map image (AVIF, WebP or PNG from `Accept`; or SVG)                                                          |
| `GET, POST /consultees/:caseId/ruleset`                                     | Pick the ruleset. Posts on to the check page                                                                                 |
| `GET /consultees/:caseId/report?ruleset=…`                                  | Check page: report details and each category's consultee names (10 shown per category)                                       |
| `GET /consultees/:caseId/report/consultees?category=…`                      | One category's map and consultees, each with _Remove_ and **Why identified**                                                 |
| `GET, POST /consultees/:caseId/report/consultees/add`                       | Add a consultee by hand (name and reason)                                                                                    |
| `GET /consultees/:caseId/report/created`                                    | Report created: download link (placeholder) and the report's consultees by category, with why each is in it                  |
| `GET /consultees/:caseId/results`                                           | Every consultee identified, with why                                                                                         |
| `GET /consultees/:caseId/results/static-map(.svg)`                          | Static map image (AVIF, WebP or PNG from `Accept`; or SVG). `category` and `exclude` filter it                               |
| `/admin/upload-to-blob`, `/admin/import-reference-data`                     | Upload a file to blob storage; replace the reference-data tables from it. See [Data model and loading](./data/data-model.md) |
| `/terms-and-conditions`, `/accessibility-statement`, `/cookies`, `/contact` | Footer pages, reachable signed out                                                                                           |
| `/auth/*`, `/signed-out`, `/unauthenticated`, `/error/*`                    | Entra sign-in and error pages                                                                                                |
| `/vendor/*`                                                                 | Defra map bundles, rate limited, lazy Brotli                                                                                 |

Dev pages mount only when `devPagesEnabled` is on (not production, or `ENABLE_DEV_PAGES=true`):

| Path                                                 | What it is                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------------ |
| `/components`, `/components/interactive-map`         | GOV.UK component showcase and worked Defra map examples. Remove before go-live |
| `/map-layers-demo`                                   | Layer toggle experiment                                                        |
| `/consultee-areas-python`, `/consultee-areas-direct` | Nearby-area query through the Python function, or straight from Node           |
| `/items`                                             | Database connectivity check                                                    |

## The journey

1. Search on `/` and pick a project. Links use the case boundary's id: `resolveCase` 404s anything that isn't a UUID without touching the database. A case reference (`EN010025`) isn't unique, because a project can have several boundary files.
2. The project boundary page draws every stored shapefile as a toggleable "GIS shapefiles" map layer; the radios below confirm the single file carried into the report. When a case has only one file, a stand-in second file appears so the toggle can be exercised — submitting it resolves back to the real boundary. Picking a different real file continues the journey under that submission's own id.
3. _Continue_ leads to the ruleset radios; _Identify consultees_ leads to the check page: report details (project, reference, shapefile, ruleset — each with a _Change_ link) and each category's consultee names, capped at 10 with a "Showing 10 of N" note beyond that.
4. A category's **Change** link lists its consultees. _Remove_ adds `exclude=<consulteeAreaId>` to the URL. _Add consultee_ adds `add=<json>` (`{"c":category,"n":name,"r":reason}`). There's no server-side state, so the lists and rows always agree (`report/urls.ts`).
5. _Create report_ carries the same parameters to the created page: the run's consultees less removals, plus additions, each with **Why identified** (`consultees/reasons.ts`).

If the ruleset can't be run (function down, timeout, bad key) the pages say so instead of showing an empty list. With no database the search shows an empty list and logs the error.

## Auth

`AUTH_DISABLED=true` locally. Otherwise `/auth` is rate limited and everything after it needs an Entra login and group membership (`authGuards`). Footer pages and monitoring stay public.

## Changing the case or ruleset shape

Update the `home` and `consultees` view models, the unit tests beside them, and `e2e/fixtures.ts` (`SAMPLE_CASE_ID`, `SAMPLE_RULESET_ID` come from the dev seed).
