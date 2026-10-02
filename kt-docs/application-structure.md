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
      data/                # fixture datasets (dummy geometries)
      maps/                # static map, sample GeoJSON, vendor proxy
      views/               # route modules + Nunjucks templates
      security/            # CSP / OWASP header helpers
      sass/                # GOV.UK + PINS overrides
      testing/             # create-test-app helpers
    util/                  # build, fingerprint, static middleware, auth helpers
  e2e/                     # Playwright specs
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

| Folder                    | Mount                     | Notes                                    |
| ------------------------- | ------------------------- | ---------------------------------------- |
| `home/`                   | `/`                       | Sample project list, search, ruleset     |
| `consultees/`             | `/consultees`             | Results + per-section static maps        |
| `map-layers-demo/`        | `/map-layers-demo`        | Prototype layer toggles                  |
| `consultee-areas-python/` | `/consultee-areas-python` | Track B bridge UI                        |
| `items/`                  | `/items`                  | Placeholder + DB connectivity check      |
| `layouts/`                | —                         | `main.njk`, form layouts, header partial |
| `static/error/`           | `/error`                  | Firewall / static error pages            |
| `errors/`                 | —                         | 401 / 403 / 404 / 500 templates          |

## Templates and GOV.UK

- Layout extends `govuk/template.njk` via `views/layouts/main.njk`
- Page components **must** come from `govuk/components/*/macro.njk` imports
- Shared map progressive-enhancement partial: `views/partials/consultee-map-region.njk`
- PINS header/nav wrappers live under `views/layouts/components/`
- Footer uses `pinsFooter` from `@planning-inspectorate/core`

## Sample data

| Module                                | Purpose                                                         |
| ------------------------------------- | --------------------------------------------------------------- |
| `app/data/dummy-geometries.ts`        | Homepage / case metadata fixtures + rulesets                    |
| `app/maps/sample-geojson.ts`          | Project site + consultee area GeoJSON builders, shared viewport |
| `app/maps/map-layers-demo-geojson.ts` | Overlay demo features                                           |

## Maps and shared utilities

| Area                                             | Purpose                                            |
| ------------------------------------------------ | -------------------------------------------------- |
| `app/maps/serve-static-map.ts`                   | HTTP handlers for PNG/SVG static maps              |
| `app/maps/static-map.ts` / `static-map-cache.ts` | Render + cache / ETag behaviour                    |
| `app/maps/vendor.ts`                             | Defra Interactive Map vendor asset routing         |
| `app/maps/geometry-bounds.ts`                    | Fit bounds helper (prepared for upload-style maps) |
| `util/static-assets-middleware.ts`               | Fingerprinted static serving + rate limit          |
| `util/fingerprint-assets.ts`                     | Build-time asset hashing / Brotli                  |
| `util/vendor-assets.ts`                          | Defra vendor roots + build-time entry copying      |

## Request pipeline (mental model)

1. `server.ts` creates the app and listens
2. `createApp` attaches static middleware, security headers, Nunjucks, router
3. `buildRouter` registers monitoring, auth (optional), then feature routes
4. Controllers build view models and `res.render(...)` Nunjucks templates
5. Client JS enhances maps only where `data-consultee-map` regions exist

## Related pages

- [Routes and user journeys](./routes-and-user-journeys.md)
- [GOV.UK Frontend conventions](./govuk-frontend-conventions.md)
- [Maps](./maps.md)
