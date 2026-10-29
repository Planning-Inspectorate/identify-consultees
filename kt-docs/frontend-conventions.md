# Frontend conventions

The rules are in [AGENTS.md](../AGENTS.md) (GDS section) and [ACCESSIBILITY.md](../ACCESSIBILITY.md). This page explains how they show up in the code.

## Principles

1. Components come from GOV.UK Frontend Nunjucks macros (`govuk/components/*/macro.njk`). Don't hand-write markup for buttons, inputs, radios, tables or error summaries.
2. PINS chrome comes from the vendored `src/lib/ui`: `pinsHeader` and the footer markup, not `govukHeader` and `govukFooter`, which GOV.UK Frontend 6 keeps for services hosted on GOV.UK.
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

## `src/lib` — vendored PINS core

The PINS shared Node and Nunjucks toolkit was ported into `apps/manage/src/lib` when the
`@planning-inspectorate/core` package stopped being maintained (see `src/lib/README.md` for what
was ported and what was deliberately left out). It keeps the package's module layout and is
imported via the `#lib/*` alias:

| Module            | Used for                                                                                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/app`         | `createBaseApp` (logging, security headers, sessions, Redis when `MANAGED_REDIS_URL` is set), `BaseService`, `BaseConfig`: the base of `app.ts`, `service.ts`, `config.ts` |
| `lib/auth`        | Entra (MSAL) sign-in routes and guards, mounted in `router.ts`                                                                                                             |
| `lib/controllers` | Health and monitoring routes                                                                                                                                               |
| `lib/middleware`  | `cacheNoCacheMiddleware`, CSP, error handling                                                                                                                              |
| `lib/testing`     | `mockLogger`, used by `testing/create-test-app.ts` and controller tests                                                                                                    |
| `lib/ui`          | `pinsHeader`, brand SCSS, pulled into `sass/govuk-overrides.scss`                                                                                                          |
| `lib/util`        | `asyncHandler` (wrap every async controller so rejections reach the error handler), `runBuild`, logger, fetch helpers                                                      |

`nunjucks.ts` registers `src/lib` as a template root, so templates import its `ui/` macros directly.

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
