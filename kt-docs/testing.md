# Testing

## Layers

| Layer                | Where                                                                      | What it proves                                                                              |
| -------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Unit and integration | `node --test`, `*.test.ts` beside the code in `apps/manage` and `packages` | Controllers, helpers, HTTP wiring (`supertest`), client JS (`public/javascripts/*.test.js`) |
| GOV.UK fixtures      | `govuk-frontend-components.test.ts`                                        | Macro HTML still matches GOV.UK Frontend's own fixtures                                     |
| Accessibility smoke  | `pages.a11y.test.ts` (axe and jsdom)                                       | Rendered Nunjucks pages                                                                     |
| Browser journeys     | Playwright `chromium-e2e`, `chromium-a11y`                                 | Journeys, axe, skip link, landmarks and focus in a real browser                             |
| Cross-browser        | `firefox-render`, `webkit-render` (`e2e/*.render.spec.ts`)                 | Pages paint their chrome and content outside Chromium                                       |
| Visual regression    | `chromium-visual`, opt-in                                                  | Screenshot of every page against committed baselines                                        |
| Python               | `pytest`, `ruff` in `apps/function-python`                                 | The screening engine. Database tests skip when no database is reachable                     |

## Commands

From the repo root:

```bash
npm test                        # packages, the coverage gate, then Playwright
npm run test:frontend-coverage  # apps/manage at 100% lines, functions and branches
npm run test:e2e                # Playwright e2e, a11y and render
npm run playwright:install      # once per machine
npm run test --workspace identify-consultees-manage -- src/app/views/home/controller.test.ts
```

The Playwright projects start a test server on port 8091 against the **real local database**: the specs deep-link to seeded rows (`SAMPLE_CASE_ID`, `SAMPLE_RULESET_ID` in `e2e/fixtures.ts`). Run `npm start` once first. In CI, `pr.yml` starts SQL Server and seeds it. The ruleset is run by a database stub there, not the function (see [Screening service](./screening-service.md#tests)).

## Coverage gate

`scripts/run-frontend-coverage.mjs` holds `apps/manage/src/**` at 100% line, function and branch coverage, excluding `server.ts`, `util/build.ts` and tests. Add a branch, add a test; test through handlers and `testing/create-test-app.ts` rather than private internals.

A local `apps/manage/.env` changes `config.ts`'s branches. If the gate passes locally but fails in CI, move it aside and run with `CI=true`.

## Visual regression

`e2e/pages.visual.spec.ts` screenshots every page in Chromium at 1280×720 with a 2% tolerance. Map regions are masked because canvas rendering isn't pixel-stable. Baselines in `pages.visual.spec.ts-snapshots/` are per platform (`*-darwin.png` locally), so Linux baselines must be generated on the CI OS before these join the pipeline. That waits until the screens are final.

```bash
npm run test:visual           # compare
npm run test:visual:update    # after a deliberate UI change
```

## Adding a route

1. Unit tests beside the controller, mocking `ManageService` as the existing tests do
2. HTTP wiring: status, redirect `Location` and key text through `supertest`
3. Add the page to `pages.a11y.test.ts` with a representative view model
4. Add it to the Playwright specs in `apps/manage/e2e/`
5. Run the coverage gate before opening the PR
