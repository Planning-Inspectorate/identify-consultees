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

| Path                                                                        | Page                                                                                                                                                                                                            |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /`                                                                     | Project search (`q`), `pageSize` 25, 50 or 100, and `page`. SQL over `case_boundary` (`searchCaseBoundaries`)                                                                                                   |
| `GET, POST /consultees/:caseId`                                             | Project boundary page: map of the case's shapefiles, radios to confirm the file for the report. Posts on to the ruleset page                                                                                    |
| `GET /consultees/:caseId/boundary-map(.svg)`                                | Static boundary map image (AVIF, WebP or PNG from `Accept`; or SVG)                                                                                                                                             |
| `GET, POST /consultees/:caseId/ruleset`                                     | Pick the ruleset. Posts on to the check page                                                                                                                                                                    |
| `GET /consultees/:caseId/report?ruleset=…`                                  | Check page: report details and each category's consultee names (10 shown per category)                                                                                                                          |
| `GET /consultees/:caseId/report/consultees?category=…`                      | One category's map and consultees, each with _Remove_ and **Why identified**; removed consultees list under an expandable section; links to the add and remove pages                                            |
| `GET, POST /consultees/:caseId/report/consultees/add`                       | Add a consultee: a name, suggested from the category's nearby consultees as it's typed (autocomplete), and a reason                                                                                             |
| `GET, POST /consultees/:caseId/report/consultees/remove`                    | Remove a consultee (`match=<consulteeAreaId>` or `added=<index>`), recording the reason given                                                                                                                   |
| `GET /consultees/:caseId/report/created`                                    | Report created: the download link and the report's consultees by category, with why each is in it                                                                                                               |
| `GET /consultees/:caseId/report/download`                                   | The report as a ZIP: an Excel workbook and a PDF of each category's map (`report/export/`), from the created page's parameters                                                                                  |
| `GET /consultees/:caseId/results`                                           | Every consultee identified, with why                                                                                                                                                                            |
| `GET /consultees/:caseId/results/static-map(.svg)`                          | Static map image (AVIF, WebP or PNG from `Accept`; or SVG). `category` and `exclude` filter it                                                                                                                  |
| `/admin`, `/admin/database`                                                 | The admin section's overview, and what the database holds: each table's rows, the consultee areas by category, a filterable list of either table's rows, and one row whole. See [Admin section](#admin-section) |
| `/admin/upload-to-blob`, `/admin/import-reference-data`                     | Upload a file to blob storage; replace the reference-data tables from it. See [Data model and loading](./data/data-model.md)                                                                                    |
| `/admin/cbos-connection`, `/admin/import-from-cbos`, `/admin/cbos-files`    | Check the function can reach CBOS; import case boundaries from CBOS; debug the import: every file in CBOS's GIS Shapefiles folders, where it's stored, what it holds and whether the import reads it            |
| `/terms-and-conditions`, `/accessibility-statement`, `/cookies`, `/contact` | Footer pages, reachable signed out                                                                                                                                                                              |
| `/auth/*`, `/signed-out`, `/unauthenticated`, `/error/*`                    | Entra sign-in and error pages                                                                                                                                                                                   |
| `/vendor/*`                                                                 | Defra map bundles, rate limited, lazy Brotli                                                                                                                                                                    |

Dev pages mount only when `devPagesEnabled` is on (not production, or `ENABLE_DEV_PAGES=true`):

| Path                                                 | What it is                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------------ |
| `/components`, `/components/interactive-map`         | GOV.UK component showcase and worked Defra map examples. Remove before go-live |
| `/map-layers-demo`                                   | Layer toggle experiment                                                        |
| `/consultee-areas-python`, `/consultee-areas-direct` | Nearby-area query through the Python function, or straight from Node           |
| `/items`                                             | Database connectivity check                                                    |

## The journey

1. Search on `/` and pick a project. Links use the case boundary's id: `resolveCase` 404s anything that isn't a UUID without touching the database. A case reference (`EN010025`) isn't unique, because a project can have several boundary files.
2. The project boundary page draws every stored shapefile as a toggleable "GIS shapefiles" map layer, all visible to start with (and all on its static image), each styled by how recent it is; the radios below confirm the single file carried into the report. Picking a different real file continues the journey under that submission's own id.
3. _Continue_ leads to the ruleset radios; _Identify consultees_ leads to the check page: report details (project, reference, shapefile, ruleset — each with a _Change_ link) and each category's consultee names, capped at 10 with a "Showing 10 of N" note beyond that.
4. A category's **Change** link lists its consultees. _Remove_ opens a page that takes the removal reason, then adds `exclude=<json>` (`{"i":consulteeAreaId,"c":category,"n":name,"r":reason}` — a hand-added consultee's entry has no `i`, its `add` param is dropped) to the URL and returns with the **Removed consultees** section open. Below the table, the **Add consultee** link opens the Add a consultee page: a name and a reason (both required, mirroring the removal reason), posting back to itself; errors show on the same page. As the name is typed, the GOV.UK accessible autocomplete (`public/javascripts/consultee-autocomplete.js`; a native `datalist` without JavaScript) suggests the category's consultees only the nearby search found (the faint ones on its map), nearest first, with their distance. The name has to be a real consultee of the category: the server matches it (case and spacing aside) to the nearest nearby consultee of that name, else to the nearest of that name anywhere in the reference data (`findConsulteeAreaByName`). Any other name - a typo, or a made-up one - is refused with "<name> does not exist as a <category> consultee. Enter a valid consultee.", as is a name already listed in the category. It then adds `add=<json>` (`{"i":consulteeAreaId,"c":category,"n":name,"r":reason}`) and returns to the category page. A nearby consultee is drawn on the maps as identified (the static map's `include` param carries it); one further away isn't on the maps, but the report has its stored row. Links from before this check may still carry adds with no `i`; they're listed, with no area to draw. A bare `exclude=<consulteeAreaId>` still excludes (the static map's links use it) but lists no reason. There's no server-side state, so the lists and rows always agree (`report/urls.ts`). Each `add` and `exclude` entry travels **base64url-encoded** (`eyJ…`): Front Door's firewall scores plain JSON in a query string as an injection attempt and blocks the page ("The request is blocked."). Links carrying plain JSON, from before, still read. For the same reason the firewall leaves the add and remove forms' free-text `name` and `reason` fields out of its checks (`infrastructure/front-door.tf`).
5. _Create report_ carries the same parameters to the created page: the consultees the ruleset's conditions identified, less removals, plus additions, each with **Why identified** (`consultees/reasons.ts`). Consultees only the nearby search found are never in the report pages; the category maps show them fainter, as context.
6. The created page's download link sends a ZIP of the report: an Excel workbook, and a PDF of each category in the report's map (`maps/NN <category>.pdf`) drawn as its Change page draws it, with a key and the category's consultees listed with why. The workbook has a **Summary** tab (project, boundary file, ruleset, counts per tab, removals with reasons), then a tab per ruleset **Group** (Administrative boundaries, Public bodies, Energy, Transport, Other) listing each consultee with the columns [`config/report.yaml`](../config/report.yaml) sets: its fixed columns (by default name, category, region, why it's in the report, and Source - Ruleset or Manually added), then the metadata each category exports - every attribute by default, or the ones its settings list, under their headings, attributes sharing a heading sharing a column - blank where a consultee has none. Each consultee goes on the tab of the condition that identified it; a hand-added one, on its category's (a matched nearby one with its stored row), its Source "Manually added". **Other Cases** is a placeholder.

The report pages, their maps and the download share one ruleset run: the first to need it runs it and keeps it in the session (`runRulesetSafely`), without geometry or metadata, for an hour; a different case or ruleset replaces it. Nothing is stored beyond the session. Only the first page waits for the function (about 5s on a full data load).

The case maps (category pages, results, static images and the report's PDFs) open on the site with the category's `mapKm` around it ([`config/report.yaml`](../config/report.yaml); the results page's map, of every category, uses the default), and the boundary page's map on the shapefiles with `boundaryMapKm` ([`config/map-view.yaml`](../config/map-view.yaml)) around them - fitted to the 960x516 map in Web Mercator at the closest whole zoom (`computeFittedMapView`). That zoom is on 256px raster tiles, as the static images draw; the interactive map (MapLibre, 512px tiles) opens one level lower, which shows the same area (`interactiveZoom` in `consultees-map.js`). The interactive maps zoom out for the rest. Static images leave out path points beyond the map's edges (`visiblePathPoints`), so regional areas don't run to megabytes at that zoom.

If the ruleset can't be run (function down, timeout, bad key) the pages say so instead of showing an empty list. With no database the search shows an empty list and logs the error.

## Admin section

Internal tools for loading and checking an environment's data, all in `apps/manage/src/app/admin/`: one folder per page, a layout with a menu between them (`admin/layout.njk`, the list in `admin/navigation.ts`), and their tests. `createAdminRoutes` mounts them under `/admin`; `adminHeaderLink` adds **Admin** to the header. To add a page, add its folder, a route in `admin/index.ts` and an entry in `ADMIN_PAGES`. To take the section out of the service, delete the folder, the lines in `router.ts` and `app.ts` (and `testing/create-test-app.ts`) that import from it, and its paths in the `e2e/` page lists.

## Auth

`AUTH_DISABLED=true` locally. Otherwise `/auth` is rate limited and everything after it needs an Entra login and group membership (`authGuards`). Footer pages and monitoring stay public.

## Changing the case or ruleset shape

Update the `home` and `consultees` view models, the unit tests beside them, and `e2e/fixtures.ts` (`SAMPLE_CASE_ID`, `SAMPLE_RULESET_ID` come from the dev seed).
