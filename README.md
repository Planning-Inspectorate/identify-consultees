# Identify consultees

Finds who must be consulted about a Nationally Significant Infrastructure Project, by screening its site boundary against consultee areas.

| Path | What |
| ---- | ---- |
| `apps/manage` | Web app: Express, Nunjucks, GOV.UK Frontend |
| `apps/function-python` | Python Azure Function: runs the screening, and reads CBOS |
| `packages/database` | Prisma schema, migrations, geospatial SQL, rulesets, data import |
| `config` | **What the service does**: rulesets, report, map and distance settings. See [`config/README.md`](./config/README.md) |
| `infrastructure` | Terraform for Azure |

## Before go-live: code to remove

> **The code below is temporary — it exists for development and QA, not for the live service.** Each item is already gated off in production, but delete it before go-live so nothing temporary ships in the image. The wider go-live checklist (data, sizing, sign-offs) is in [`kt-docs/overview.md` → Before go-live](./kt-docs/overview.md#before-go-live).

Every item is marked in the code with `TEMPORARY - remove before go-live` — `grep -rn "remove before go-live"` finds them all. Delete each item's tests, e2e entries and docs notes with it; the 100% coverage gate will flag any that are missed.

| What                                                                                                                            | Gated by                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [Dev pages](#dev-pages): component showcase, map demos, error-scenario and query-comparison pages                               | `devPagesEnabled` — off when `NODE_ENV=production` unless `ENABLE_DEV_PAGES=true`       |
| [`?test-fail=` fault triggers](#qa-fault-triggers): forced map/ruleset/download failures for QA                                  | `testFaultsEnabled` — off where `ENVIRONMENT=prod` (`infrastructure/app-web.tf`)        |
| [Hidden footer links](#hidden-footer-links): terms and accessibility statement hidden pending content audit                     | not gated — pages are reachable, their footer links are hidden by CSS                 |

### Dev pages

Prototype and debug pages under `apps/manage/src/app/views/`, mounted only while `devPagesEnabled` is on (`config.ts`; on locally, on deployed environments via `ENABLE_DEV_PAGES`):

| Route                                    | Folder to delete                | What it is                                                    |
| ---------------------------------------- | ------------------------------- | ------------------------------------------------------------- |
| `/components`, `/components/:component`  | `views/components/`             | GOV.UK Frontend component showcase (`?components=true` reveals its nav item) |
| `/components/interactive-map/*`          | `views/interactive-map-examples/` | Worked Defra interactive-map examples                        |
| `/map-layers-demo`                       | `views/map-layers-demo/`        | Map layer toggle experiment                                   |
| `/error-test/*`                          | `views/error-test/`             | Error-scenario index for QA (rendered error pages, forced 500, CSRF and rate-limit demos) |
| `/consultee-areas-python`, `.../run`     | `views/consultee-areas-python/` | Nearby-area query through the Python function                 |
| `/consultee-areas-direct`, `.../run`     | `views/consultee-areas-direct/` | The same query straight from Node, for comparison             |

Then remove their supporting code and wiring:

- `apps/manage/src/app/maps/`: `interactive-map-examples.ts`, `interactive-map-examples-data.ts`, `map-layers-demo-geojson.ts` (and their `.test.ts`), plus the demo builders in `sample-geojson.ts` (`buildProjectSiteGeojson`, `buildConsulteeAreaGeojson` — keep `MAP_VIEWPORT` and the GeoJson types; the real maps use them)
- `apps/manage/src/public/javascripts/`: `map-layers-demo.js`, `interactive-map-examples.js` (and their `.test.js`)
- `apps/manage/src/app/sass/style.scss`: `.pins-component-example`
- `apps/manage/src/app/router.ts`: the `if (service.devPagesEnabled)` mount block and the six dev-router imports
- `apps/manage/src/app/config.ts`: `devPagesEnabled` and `ENABLE_DEV_PAGES`; `apps/manage/src/app/service.ts`: the getter; `apps/manage/.env.example`: the `ENABLE_DEV_PAGES` note
- `apps/manage/src/util/config-middleware.ts`: `showComponentsNav` and the `mapLayersDemoJs` / `interactiveMapExamplesJs` locals; `apps/manage/src/app/views/layouts/components/header.njk`: the "Components" nav item (`showComponents` block)
- `apps/manage/src/app/testing/`: the dev-page locals in `a11y.ts` and `devPagesEnabled: true` in `create-test-app.ts`
- Tests: the dev-page cases in `apps/manage/src/app/pages.a11y.test.ts`, `router.test.ts`, `config.test.ts`, and the dev-page entries in `apps/manage/e2e/pages.a11y.spec.ts`, `pages.render.spec.ts`, `pages.visual.spec.ts`, `journeys.e2e.spec.ts`
- Docs: the dev-pages table in `kt-docs/web-app.md`, "Dev-only error pages" in `kt-docs/error-pages.md`, this section

Verify `ENABLE_DEV_PAGES` is not set on the production app — nothing in `infrastructure/` sets it today, so the routes already 404 on prod.

### QA fault triggers

The `?test-fail=<map|ruleset|download>` triggers force the error states so QA can exercise them on a deployed environment: `map` fails only the request carrying the parameter; `ruleset` and `download` are stored in the session until `?test-fail=off` (see [`kt-docs/error-pages.md`](./kt-docs/error-pages.md)). On everywhere but prod via `Config.testFaultsEnabled` (`ENVIRONMENT !== 'prod'`). Remove:

- `apps/manage/src/app/views/consultees/test-faults.ts` and `test-faults.test.ts`
- the `testFaultMiddleware` mount and import in `apps/manage/src/app/views/consultees/index.ts`
- the fault branches in `run-ruleset.ts` (ruleset), `project/controller.ts` (map), `report/controller.ts` and `report/export/controller.ts` (download)
- `testFaultsEnabled` in `apps/manage/src/app/config.ts` (and the `ENVIRONMENT` env read, if nothing else uses it) and `apps/manage/src/app/service.ts`; `testFaultsEnabled: true` in `apps/manage/src/app/testing/create-test-app.ts`
- the fault cases in `config.test.ts`, `router.test.ts`, `run-ruleset.test.ts`, `project/controller.test.ts`, `report/controller.test.ts`, `report/export/controller.test.ts` (same folders)
- the "Forced failure triggers" section in `kt-docs/error-pages.md`

### Hidden footer links

`/terms-and-conditions` and `/accessibility-statement` are live routes whose footer links are hidden until their content has had a proper audit — `hidden: true` in `footerLinks` in `apps/manage/src/util/config-middleware.ts`, styled by `.pins-footer__item--hidden` in `apps/manage/src/app/sass/style.scss` (mirrored in `apps/manage/src/app/testing/a11y.ts`). After the audit, remove the `hidden` flags; the CSS class can go once nothing uses it.

### Machine-readable inventory

```yaml
# Machine-readable copy of this section - keep in sync. `grep -rn "remove before go-live"` finds the markers.
remove_before_go_live:
  - name: dev-pages
    gated_by: devPagesEnabled (ENABLE_DEV_PAGES; off in NODE_ENV=production)
    delete:
      - apps/manage/src/app/views/components/
      - apps/manage/src/app/views/interactive-map-examples/
      - apps/manage/src/app/views/map-layers-demo/
      - apps/manage/src/app/views/error-test/
      - apps/manage/src/app/views/consultee-areas-python/
      - apps/manage/src/app/views/consultee-areas-direct/
      - apps/manage/src/app/maps/interactive-map-examples.ts
      - apps/manage/src/app/maps/interactive-map-examples-data.ts
      - apps/manage/src/app/maps/map-layers-demo-geojson.ts
      - apps/manage/src/public/javascripts/map-layers-demo.js
      - apps/manage/src/public/javascripts/interactive-map-examples.js
    edit:
      - apps/manage/src/app/router.ts # dev-pages mount block + six imports
      - apps/manage/src/app/config.ts # devPagesEnabled, ENABLE_DEV_PAGES
      - apps/manage/src/app/service.ts # devPagesEnabled getter
      - apps/manage/src/util/config-middleware.ts # showComponentsNav, demo JS locals
      - apps/manage/src/app/maps/sample-geojson.ts # demo builders only; keep MAP_VIEWPORT + types
      - apps/manage/src/app/sass/style.scss # .pins-component-example
      - apps/manage/src/app/views/layouts/components/header.njk # Components nav item
      - apps/manage/src/app/testing/a11y.ts # demo pageLocals
      - apps/manage/src/app/testing/create-test-app.ts # devPagesEnabled
      - apps/manage/.env.example # ENABLE_DEV_PAGES
      - apps/manage/src/app/pages.a11y.test.ts # dev-page cases
      - apps/manage/src/app/router.test.ts # dev-page mount cases
      - apps/manage/src/app/config.test.ts # dev-page flag cases
      - apps/manage/e2e/pages.a11y.spec.ts # dev-page entries
      - apps/manage/e2e/pages.render.spec.ts # dev-page entries
      - apps/manage/e2e/pages.visual.spec.ts # dev-page entries
      - apps/manage/e2e/journeys.e2e.spec.ts # map-layers-demo check
      - kt-docs/web-app.md # dev-pages table
      - kt-docs/error-pages.md # "Dev-only error pages" section
  - name: qa-test-fault-triggers
    gated_by: testFaultsEnabled (ENVIRONMENT != 'prod')
    delete:
      - apps/manage/src/app/views/consultees/test-faults.ts
      - apps/manage/src/app/views/consultees/test-faults.test.ts
    edit:
      - apps/manage/src/app/views/consultees/index.ts # testFaultMiddleware mount
      - apps/manage/src/app/views/consultees/run-ruleset.ts # 'ruleset' fault branch
      - apps/manage/src/app/views/consultees/project/controller.ts # 'map' fault branches
      - apps/manage/src/app/views/consultees/report/controller.ts # 'download' fault branch
      - apps/manage/src/app/views/consultees/report/export/controller.ts # 'download' fault branch
      - apps/manage/src/app/config.ts # testFaultsEnabled, ENVIRONMENT
      - apps/manage/src/app/service.ts # testFaultsEnabled getter
      - apps/manage/src/app/testing/create-test-app.ts # testFaultsEnabled
      - apps/manage/src/app/config.test.ts # fault-flag cases
      - apps/manage/src/app/router.test.ts # fault cases
      - apps/manage/src/app/views/consultees/run-ruleset.test.ts # fault cases
      - apps/manage/src/app/views/consultees/project/controller.test.ts # fault cases
      - apps/manage/src/app/views/consultees/report/controller.test.ts # fault cases
      - apps/manage/src/app/views/consultees/report/export/controller.test.ts # fault cases
      - kt-docs/error-pages.md # "Forced failure triggers" section
  - name: hidden-footer-links
    gated_by: none
    action: un-hide after the content audit passes
    edit:
      - apps/manage/src/util/config-middleware.ts # hidden: true on terms + accessibility-statement
      - apps/manage/src/app/sass/style.scss # .pins-footer__item--hidden (once unused)
      - apps/manage/src/app/testing/a11y.ts # footerLinks mirror
```

## Run it locally

You need Node.js 24 ([`.nvmrc`](./.nvmrc)), Docker, Python 3.12 and Azure Functions Core Tools (`npm install -g azure-functions-core-tools@4`).

```bash
nvm use
npm run check-toolchain
npm ci
npm start
```

Then open http://localhost:8090. `npm start` writes the `.env` files (sign-in disabled), starts SQL Server in Docker on port 1434, migrates and seeds it, and runs the Python function (port 7071) and the web app. `Ctrl+C` stops them; `docker compose down` stops SQL Server.

> **`npm start` and `npm run db-seed` replace the consultee areas in use with the 80-area sample.** Case boundaries are merged. If you've loaded the full reference data locally, apply migrations with `npm run db-migrate-prod` and start the app and function without `npm start`.

On Apple Silicon, SQL Server runs under `linux/amd64` emulation (Azure SQL Edge has no `GEOGRAPHY`). Sign-in, settings and troubleshooting: [`kt-docs/local-development.md`](./kt-docs/local-development.md).

## Scripts

| Script | What |
| ------ | ---- |
| `npm start` | Everything above |
| `npm run db-migrate-prod` | Apply migrations. To write one, see [`packages/database/src/README.md`](./packages/database/src/README.md) |
| `npm run db-seed` | Load the sample data (replaces the consultee areas in use) |
| `npm run db-import -- --type=<consultee-areas\|case-boundaries> --file=<path>` | Import a GeoJSON file |
| `npm run db-import-from-blob -- --type=<...> --blob=<name>` | Import a GeoJSON blob from the app's storage |
| `npm run lint`, `npm run check-types`, `npm run format-prettier-check` | Static checks |
| `npm test` | Unit tests, the 100% coverage gate and Playwright (needs the seeded database) |
| `npm run playwright:install` | Install the Playwright browsers, once |

## Read next

- [`kt-docs/`](./kt-docs/README.md): how the service works, starting with the [overview](./kt-docs/overview.md)
- [`CONTRIBUTING.md`](./CONTRIBUTING.md): branches, commits and PRs
- [`AGENTS.md`](./AGENTS.md): GDS, maps, toolchain and PR rules, for agents and people
- [`ACCESSIBILITY.md`](./ACCESSIBILITY.md), [`SECURITY.md`](./SECURITY.md)

## Editors

`npm run check-types` uses [`tsconfig.check.json`](./tsconfig.check.json) (stricter, TypeScript 7). The root [`tsconfig.json`](./tsconfig.json) stays compatible with the editor's TypeScript service: in VS Code or Cursor, choose **Use Workspace Version** if asked. WebStorm run configurations are included; set the Node interpreter under Settings > Languages and Frameworks > Node.js.
