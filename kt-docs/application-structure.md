# Application structure

**Status:** Current for `apps/manage` layout; Partial where comments still reference older spike paths.

## Top-level manage app

```
apps/manage/
  src/
    server.ts              # HTTP listen, trust proxy
    app/
      app.ts               # createApp / static asset prep
      router.ts            # mounts feature routers
      config.ts            # env → typed config
      service.ts           # ManageService wiring
      nunjucks.ts          # template engine setup
      maps/                # static map render/cache/serve, Defra vendor assets, case GeoJSON
      views/               # route modules + Nunjucks templates
      security/            # CSP / OWASP header helpers
      sass/                # GOV.UK + PINS overrides
      testing/             # create-test-app helpers
    util/                  # build, fingerprint, static middleware, auth, inline-JSON helpers
  e2e/                     # Playwright specs (run against the seeded local DB)
  public/                  # client assets copied/fingerprinted into .static
```

## `src/app/views/` — feature modules

Each feature typically has:

| File              | Role                                   |
| ----------------- | -------------------------------------- |
| `index.ts`        | Express router for the feature         |
| `*/controller.ts` | Request handlers / view-model assembly |
| `*/view-model.ts` | Types for template data                |
| `*/view.njk`      | Nunjucks page                          |

Notable features:

| Folder                         | Mount                          | Notes                                                                                   |
| ------------------------------ | ------------------------------ | --------------------------------------------------------------------------------------- |
| `home/`                        | `/`                            | DB-backed project search + paginated list                                               |
| `consultees/`                  | `/consultees`                  | `ruleset/` picker + `results/` page, per-results static maps                            |
| `map-layers-demo/`             | `/map-layers-demo`             | Prototype layer toggles                                                                 |
| `components/`                  | `/components`                  | Component showcase; mounts `interactive-map-examples/` at `/components/interactive-map` |
| `consultee-areas-python/`      | `/consultee-areas-python`      | Track B bridge UI                                                                       |
| `consultee-areas-direct/`      | `/consultee-areas-direct`      | Same query straight from Node (no Python)                                               |
| `admin-upload-to-blob/`        | `/admin/upload-to-blob`        | Upload a file to the app's blob container (managed identity)                            |
| `admin-import-reference-data/` | `/admin/import-reference-data` | Import the known reference-data blobs into SQL                                          |
| `items/`                       | `/items`                       | Placeholder + DB connectivity check                                                     |
| `signed-out/`                  | `/signed-out`                  | Post-sign-out page                                                                      |
| `layouts/`                     | —                              | `main.njk`, form layouts, header partial                                                |
| `static/error/`                | `/error`                       | Firewall / static error pages                                                           |
| `errors/`                      | —                              | 401 / 403 / 404 / 500 templates                                                         |

## Templates and GOV.UK

- Layout extends `govuk/template.njk` via `views/layouts/main.njk`
- Page components **must** come from `govuk/components/*/macro.njk` imports
- Shared map progressive-enhancement partial: `views/partials/consultee-map-region.njk`
- PINS header/nav wrappers live under `views/layouts/components/`
- Footer uses `pinsFooter` from `@planning-inspectorate/core`

## Data and sample data

| Module / path                                          | Purpose                                                                                       |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `packages/database/src/geospatial/*`                   | `case-boundaries`, `consultee-areas`, `rulesets`, `wkt` — the real query layer                |
| `packages/database/src/seed/*`                         | Dev seed + GeoJSON import (`import-cli`, `import-from-blob`, `geojson-import`)                |
| `apps/function-python/setup_database/sample_data/`     | The bundled sample GeoJSON the dev seed loads (real UK boundary exports)                      |
| `packages/database/src/geospatial/example_ruleset.csv` | The one real ruleset export `RULESETS` is built from                                          |
| `app/maps/sample-geojson.ts`                           | Shared map viewport constants + GeoJSON helpers used by demos/examples                        |
| `app/maps/map-layers-demo-geojson.ts`                  | Overlay demo features                                                                         |
| `app/maps/case-geojson.ts`                             | Builds the results map config (project, matches, nearby areas, search area, category colours) |
| `app/maps/interactive-map-examples-data.ts`            | Worked Defra examples for `/components/interactive-map`                                       |

## Maps and shared utilities

| Area                               | Purpose                                                              |
| ---------------------------------- | -------------------------------------------------------------------- |
| `app/maps/serve-static-map.ts`     | Assembles the cached response: AVIF/WebP/PNG negotiation + SVG route |
| `app/maps/static-map.ts`           | Tile fetching (OSM / optional Google Static) + SVG render            |
| `app/maps/static-map-raster.ts`    | `sharp` compositing of tiles + overlay into AVIF/WebP/PNG            |
| `app/maps/static-map-cache.ts`     | ETag fingerprint + `Cache-Control` behaviour                         |
| `app/maps/vendor.ts`               | Rate-limited Defra vendor asset router with lazy Brotli              |
| `app/maps/geometry-bounds.ts`      | Fit bounds helper (prepared for upload-style maps)                   |
| `util/static-assets-middleware.ts` | Fingerprinted static serving + rate limit                            |
| `util/fingerprint-assets.ts`       | Build-time asset hashing / Brotli                                    |
| `util/vendor-assets.ts`            | Defra vendor roots + build-time entry copying                        |
| `util/inline-json.ts`              | Safe `<script type="application/json">` embedding for page config    |

## Request pipeline (mental model)

1. `server.ts` creates the app and listens
2. `createApp` attaches static middleware, security headers, Nunjucks, router
3. `buildRouter` registers monitoring, the Defra vendor router, auth (optional), then feature routes
4. Controllers query `packages/database` via `service.db`, build view models, and `res.render(...)` Nunjucks templates
5. Client JS enhances maps from `<script type="application/json">` page config (containers found by class - `.app-consultee-map`, `.app-map-layers-demo`, `.app-interactive-map-example`)

## Related pages

- [Routes and user journeys](./routes-and-user-journeys.md)
- [GOV.UK Frontend conventions](./govuk-frontend-conventions.md)
- [Maps](./maps.md)
