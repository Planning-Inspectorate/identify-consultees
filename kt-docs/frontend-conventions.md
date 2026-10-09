# Frontend conventions

The rules are in [AGENTS.md](../AGENTS.md) (GDS section) and [ACCESSIBILITY.md](../ACCESSIBILITY.md). This page explains how they show up in the code.

## Principles

1. Components come from GOV.UK Frontend Nunjucks macros (`govuk/components/*/macro.njk`). Don't hand-write markup for buttons, inputs, radios, tables or error summaries.
2. PINS chrome comes from `@planning-inspectorate/core`: `pinsHeader` and `pinsFooter`, not `govukHeader` and `govukFooter`, which GOV.UK Frontend 6 keeps for services hosted on GOV.UK.
3. Progressive enhancement: the journey works without JavaScript, and maps fall back to a static image.
4. No SPA framework and no custom design system. Change that only through an explicit architecture decision.

`react`, `react-dom`, `scheduler` and `preact` in `package.json` aren't a UI stack. See [Local development](./local-development.md#toolchain).

## Page pattern

```njk
{% extends "views/layouts/main.njk" %}
{% from "govuk/components/button/macro.njk" import govukButton %}

{% block pageContent %}
  {{ govukButton({ text: "Continue" }) }}
{% endblock %}
```

`views/layouts/main.njk` extends `govuk/template.njk` and adds the PINS header (`pinsServiceHeader` in `layouts/components/header.njk`), service navigation, the Beta phase banner, optional back link and error summary blocks, and the footer. The footer reuses the `pinsFooter` markup without `target="_blank"`, per GDS link guidance.

Forms: `govukErrorSummary` at the top, `errorMessage` on each field, keep the user's input on re-render. Titles follow `Page - Service`.

## `@planning-inspectorate/core`

PINS's shared Node and Nunjucks toolkit ([repo](https://github.com/Planning-Inspectorate/core); [template-service](https://github.com/Planning-Inspectorate/template-service) shows intended use). Using it is much of what makes a service PINS-compliant rather than just GOV.UK-styled. Import subpaths:

| Export             | Used for                                                                                                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/app`         | `createBaseApp` (logging, security headers, sessions, Redis when `MANAGED_REDIS_URL` is set), `BaseService`, `BaseConfig`: the base of `app.ts`, `service.ts`, `config.ts` |
| `core/auth`        | Entra (MSAL) sign-in routes and guards, mounted in `router.ts`                                                                                                             |
| `core/controllers` | Health and monitoring routes                                                                                                                                               |
| `core/middleware`  | `cacheNoCacheMiddleware`, CSP, error handling                                                                                                                              |
| `core/testing`     | `mockLogger`, `TestServer`, used by `testing/create-test-app.ts`                                                                                                           |
| `core/ui`          | `pinsHeader`, `pinsFooter`, brand SCSS, pulled into `sass/govuk-overrides.scss`                                                                                            |
| `core/util`        | `asyncHandler` (wrap every async controller so rejections reach the error handler), `runBuild`, logger, fetch helpers                                                      |

`nunjucks.ts` registers the package's `dist` as a template root, so templates import its macros directly. Dependabot bumps it in the `deps` group; read the changelog when the major moves.

## Progressive enhancement

| Situation    | What happens                                                 |
| ------------ | ------------------------------------------------------------ |
| No JS        | Forms, tables and the `<noscript>` static map work           |
| JS on        | `govuk-frontend-supported` class; the interactive map starts |
| Map JS fails | The page config's `fallback` static image is shown           |

Map partial: `views/partials/consultee-map-region.njk`.

## Before merging a UI change

- Keyboard-only pass of the changed journey
- axe passes in unit (`pages.a11y.test.ts`) and Playwright
- A screen reader spot check (VoiceOver) when changing maps, tables with controls or error summaries
- Plain English in user-visible text, no internal jargon
- `npm run check-types`, `npm run lint`, `npm run format-prettier-check`, and the 100% frontend coverage gate (see [Testing](./testing.md))
