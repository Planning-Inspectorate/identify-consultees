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

## Page layout

`views/layouts/main.njk` extends `govuk/template.njk` and provides:

- PINS header via `govukGenericHeader` wrapper (`pinsServiceHeader`) — not `govukHeader`
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
