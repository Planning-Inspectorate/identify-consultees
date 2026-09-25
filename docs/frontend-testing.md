# Frontend testing (manage app)

The manage app is a server-rendered GOV.UK service. Tests cover application logic, Nunjucks pages, GOV.UK Frontend macros, accessibility, and browser journeys.

## What runs under `npm test`

From the repo root:

1. **Unit / integration / a11y smoke / GOV.UK fixtures** — Node.js built-in test runner (`node --test`) across the monorepo, including:
   - Controller and map helpers
   - HTTP wiring via `supertest`
   - Page accessibility with `axe-core` + `jsdom` (`pages.a11y.test.ts`)
   - Official GOV.UK Frontend HTML fixtures (`govuk-frontend-components.test.ts`)
   - Client JS unit tests (`public/javascripts/*.test.js`)
2. **Browser e2e + a11y + cross-browser render** — Playwright projects:
   - `chromium-e2e` / `chromium-a11y` — journeys and axe checks (auth disabled test server)
   - `firefox-render` / `webkit-render` — render-completeness checks in Firefox and WebKit (Safari engine)

## Coverage gate (frontend)

```bash
npm run test:frontend-coverage
```

Runs manage tests with 100% line, function, and branch coverage for `apps/manage/src/**`, excluding:

- `server.ts` (process entry)
- `util/build.ts` (asset build script; covered by `npm run build` in CI)
- `*.test.*`

`npm run test-coverage` runs monorepo coverage, Playwright e2e/a11y/render, then this frontend gate.

## Cross-browser render completeness

Firefox and WebKit (Playwright’s Safari engine) run `e2e/*.render.spec.ts` to confirm key pages paint GOV.UK chrome, headings, landmarks, and primary content outside Chromium.

```bash
npm run playwright:install   # chromium + firefox + webkit (+ OS deps on Linux)
npm run test:e2e             # includes firefox-render and webkit-render
```

## Visual regression (scaffolded, not in `npm test`)

Baselines are intentionally **not** taken while the UI is still changing heavily.

```bash
npm run playwright:install   # once
npm run test:visual          # compare (fails until baselines exist)
npm run test:visual:update   # write / refresh snapshots
```

Specs live in `apps/manage/e2e/*.visual.spec.ts` under the `chromium-visual` Playwright project.

## Useful scripts

| Script                           | Purpose                                              |
| -------------------------------- | ---------------------------------------------------- |
| `npm test`                       | Unit/integration + Playwright e2e/a11y/render        |
| `npm run test:e2e`               | Playwright Chromium e2e/a11y + Firefox/WebKit render |
| `npm run test:frontend-coverage` | Manage 100% line/branch/function coverage gate       |
| `npm run test:visual`            | Visual regression (opt-in)                           |
| `npm run playwright:install`     | Install Chromium, Firefox, and WebKit for Playwright |
