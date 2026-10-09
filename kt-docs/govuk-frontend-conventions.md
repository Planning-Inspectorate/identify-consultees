# GOV.UK Frontend conventions

**Status:** Current — aligned with `AGENTS.md` and manage layouts.

## Principles

1. **HTML for UI components comes from GOV.UK Frontend Nunjucks macros only**
2. Layout chrome uses GOV.UK patterns plus PINS branding overrides
3. Progressive enhancement: core journey works without client JS; maps degrade to static images
4. No bespoke design system and no SPA framework for this manage app

## Why no custom design system or SPA

| Choice                     | Reason                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------- |
| GOV.UK Frontend macros     | Accessibility, consistency with GDS Service Standard, shared assets, less custom CSS               |
| Server-rendered Nunjucks   | Fits PINS patterns (`@planning-inspectorate/core`), simple auth/session model, good no-JS baseline |
| Avoid React/SPA for manage | Spike goal is service-shaped HTML journeys, not a parallel frontend stack                          |

Reassess only with an explicit product/architecture decision — not for convenience on a single page.

> **Note:** `react`, `react-dom`, `scheduler`, and `preact` in `package.json` are **not** a UI stack — they are transitive peer-dependency entries required by the Prisma CLI and the Defra interactive map so `npm ci` succeeds. See [Local setup](./local-setup.md#why-react-and-preact-appear-in-packagejson).

## `@planning-inspectorate/core` — the shared PINS toolkit

`@planning-inspectorate/core` (currently `1.14.x`, from [Planning-Inspectorate/core](https://github.com/Planning-Inspectorate/core)) is PINS's shared package of Node.js and Nunjucks utilities for internal services. It exists so every PINS Node service gets the same branded chrome, auth flow, monitoring endpoints, and plumbing without each team re-implementing them — using it is a large part of what makes a service "PINS-compliant" rather than merely GOV.UK-styled. The [template-service](https://github.com/Planning-Inspectorate/template-service) repo is the canonical reference for intended usage.

The package is organised as subpath exports; import only what you need:

| Export                                    | Contains                                                                                                                                            | Used in this service for                                                                                                |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `@planning-inspectorate/core/app`         | `createBaseApp` (Express app pre-wired with logging, security headers, session and CSRF plumbing), `BaseService`, `BaseConfig`, `DatabaseConfig`    | `app.ts` builds on `createBaseApp`; `service.ts` extends `BaseService`; `config.ts` extends `BaseConfig`                |
| `@planning-inspectorate/core/auth`        | Microsoft Entra ID (MSAL) sign-in: `createRoutesAndGuards` mounts login / redirect / signout routes and auth guards, plus auth and session services | `router.ts` mounts `createAuthRoutesAndGuards`                                                                          |
| `@planning-inspectorate/core/controllers` | `createMonitoringRoutes` — health endpoint and HEAD-request handling                                                                                | `router.ts` mounts it before feature routes                                                                             |
| `@planning-inspectorate/core/middleware`  | Caching (`cacheNoCacheMiddleware`), CSP, error handling, request logging                                                                            | `router.ts` applies `cacheNoCacheMiddleware` to dynamic routes                                                          |
| `@planning-inspectorate/core/redis`       | Azure Managed Redis client                                                                                                                          | Available but not currently used here                                                                                   |
| `@planning-inspectorate/core/testing`     | `mockLogger`, `TestServer`, custom asserts                                                                                                          | `create-test-app.ts` and the `*.test.ts` suites                                                                         |
| `@planning-inspectorate/core/ui`          | `pinsHeader` / `pinsFooter` Nunjucks macros, `pins-header.scss` / `pins-footer.scss`, `pins-colors.scss` brand palette                              | Page chrome in `views/layouts/` and `sass/govuk-overrides.scss`                                                         |
| `@planning-inspectorate/core/util`        | `asyncHandler` + `AsyncRequestHandler` types, `runBuild`, `MapCache`, logger, fetch/retry/timeout, session helpers                                  | The most-used export: every async controller is wrapped in `asyncHandler`; `util/build.ts` drives assets via `runBuild` |

How the pieces connect in this app:

- `nunjucks.ts` resolves the package's `dist` folder via `require.resolve('@planning-inspectorate/core')` and registers it as a Nunjucks template root, so templates import core macros directly (`{% from "ui/header/pins-header.njk" import pinsHeader %}`).
- `views/layouts/components/header.njk` wraps `pinsHeader({ isExternal: false })` in a `pinsServiceHeader` macro — the internal-service variant.
- `views/layouts/components/footer.njk` reuses the `pinsFooter` markup minus `target="_blank"`, per GDS link guidance.
- `sass/govuk-overrides.scss` pulls in the header/footer styles with `@use 'node_modules/@planning-inspectorate/core/dist/ui/...'`.

Why it matters for new developers on a PINS project:

- **Correct chrome for free** — GOV.UK Frontend 6 reserves `govukHeader`/`govukFooter` for services hosted on GOV.UK; PINS services use the core `pinsHeader`/`pinsFooter` instead. Reaching for the GOV.UK macros here produces non-compliant branding.
- **Shared platform behaviour** — Entra ID auth, health/monitoring routes, security headers, and error handling behave the same across PINS Node services, so reviewers and assessors see a consistent posture.
- **Safer async Express** — `asyncHandler` forwards async controller rejections to Express error middleware instead of crashing or hanging; follow the existing controllers.
- **Transferable patterns** — the same package underpins other PINS services (see template-service), so structure learned here carries over.
- **Versioned upgrades** — releases are automated (semantic-release on merge to `main`); Dependabot bumps it in the `deps` group, so check the upstream changelog when the major moves.

## Page layout

`views/layouts/main.njk` extends `govuk/template.njk` and provides:

- PINS header via `pinsHeader` from `@planning-inspectorate/core` (`pinsServiceHeader` wrapper) — not `govukHeader`
- Service navigation via `govukServiceNavigation`
- Phase banner (Beta)
- Optional back link and error summary blocks
- `pinsFooter` from `@planning-inspectorate/core` (not `govukFooter`)

Styles: compiled SCSS including `govuk-overrides.scss` for PINS branding.

## Using macros

Typical page pattern:

```njk
{% extends "views/layouts/main.njk" %}
{% from "govuk/components/button/macro.njk" import govukButton %}
{% from "govuk/components/input/macro.njk" import govukInput %}

{% block pageContent %}
  {{ govukInput({ ... }) }}
  {{ govukButton({ text: "Continue" }) }}
{% endblock %}
```

Do **not** hand-write equivalent control markup for buttons, inputs, radios, tables, error summaries, etc.

## Accessibility expectations

- Correct heading order and page title pattern (`Page — Service`)
- Visible focus, keyboard operable controls (default via GOV.UK components)
- Meaningful `aria-label` on map regions; static maps need useful `alt`
- Error summary linking to fields when validation is added
- Test with axe (unit/jsdom + Playwright) before calling a journey done

## Validation patterns

Prefer Design System patterns:

- `govukErrorSummary` at the top of the page
- Per-field `errorMessage` on macros
- Preserve user input on re-render

(Exact validation middleware varies by form; new forms should follow existing question-page layouts under `views/layouts/`.)

## Progressive enhancement

| Layer          | Behaviour                                                               |
| -------------- | ----------------------------------------------------------------------- |
| No JS          | HTML forms, tables, and `<noscript>` static maps work                   |
| JS enabled     | `js-enabled` / `govuk-frontend-supported` classes; interactive map init |
| Map JS failure | Inject / show static map from `config.fallback` in the JSON block       |

Map partial: `views/partials/consultee-map-region.njk`.

## Related pages

- [Accessibility and quality](./accessibility-and-quality.md)
- [Application structure](./application-structure.md)
- [Maps](./maps.md)
