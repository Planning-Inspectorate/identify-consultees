# Decisions and open questions

**Status:** Partial — capture known constraints now; replace “open” items with ADR links as they are written.

## Recorded / de facto decisions (frontend)

| Decision                                        | Rationale                                                                                                                                                                                                           | Where it shows up                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Server-rendered GOV.UK Frontend + Nunjucks      | GDS alignment, a11y defaults, PINS core patterns                                                                                                                                                                    | `apps/manage` templates                                            |
| No SPA / no custom design system for manage     | Avoid parallel stack during spike                                                                                                                                                                                   | `AGENTS.md`, layout macros                                         |
| DB-backed journey with seeded sample data       | Real queries over `case_boundary`/`consultee_area`; the bundled GeoJSON sample stands in for full data                                                                                                              | `searchCaseBoundaries`, `run-ruleset` (Python), `seed/data-dev.ts` |
| Ruleset screening in Python via SQL `GEOGRAPHY` | The intersection logic belongs with the Python geo tooling. Ported as-is (SQL still does the maths) and checked identical to the Node original over all 283 local projects; no Node fallback, so one implementation | `apps/function-python/intersector/` (`screening.py`)               |
| Defra interactive map + static fallback         | Progressive enhancement                                                                                                                                                                                             | maps + `consultee-map-region.njk`                                  |
| Python over HTTP                                | Isolate geo/SQL Python without coupling boot; the manage app sends ruleset definitions with each run                                                                                                                | `PYTHON_FUNCTION_URL`, `ruleset-runner.ts`                         |
| Node 24 LTS / npm 11+ majors pinned with Azure  | Latest minor/patch floats; avoids lockfile / peer dependency breakage without per-release repo updates                                                                                                              | `.nvmrc`, `engines`, toolchain check                               |
| `trust proxy` hop count `1`                     | Secure cookies behind proxy **and** safe rate limiting                                                                                                                                                              | `server.ts`                                                        |
| Origin stays HTTP/1.1                           | Front Door terminates modern client protocols                                                                                                                                                                       | `AGENTS.md`, `server.ts` comments                                  |

## Known constraints

- Public repo: no secrets, no production personal data
- SQL Server `GEOGRAPHY` requirement drives Docker image choice (not SQL Edge)
- `accessible-autocomplete` vs Defra map `preact` peer conflict — solved with overrides, **not** `legacy-peer-deps`
- Manage coverage gate is strict (100%) — budget test time into feature work
- Auth group checks depend on Entra configuration outside this repo’s fixtures

## Still experimental / not agreed architecture

Mark these clearly in Confluence as **Experimental**:

| Topic                                           | Current state                                                                                | Open question                                                         |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Multi-step `/filter-n` IA                       | Not implemented; `/` → `/consultees/:caseId` → `/results` stands in                          | Do we adopt filter URLs or keep the current shape?                    |
| End-user upload wizard                          | Not built; admin blob upload + import routes exist                                           | Which formats? Who owns persistence?                                  |
| Full reference dataset                          | Seed loads a sample; pipeline/admin routes can import the full blobs                         | When does the full dataset replace the sample in each env?            |
| Additional rulesets                             | One (`england-wales-post-20240430`) built from the real CSV export                           | Where do the ~8 real rulesets come from, and who owns the CSV format? |
| Broader Python orchestrator / intersector ports | Mentioned in function-python README                                                          | How much stays Python vs moves to Node?                               |
| Visual regression baselines                     | Implemented (`chromium-visual`, covers every current page); opt-in — not in `npm test` or CI | When are screens final enough to gate PRs on snapshots?               |
| Faceted search                                  | Not built                                                                                    | Which facets matter for consultee identification?                     |
| Production data path                            | Explicitly out of scope for spike secrets                                                    | What anonymised datasets are allowed in non-prod?                     |

## Wrap-up tasks

Things deliberately deferred until the screens are final / the project is finished — clear this list before go-live:

- [ ] **Enable visual regression in the PR pipeline.** Add the `chromium-visual` project to the test run (`apps/manage` `package.json` `test:e2e`, `.azure/pipelines/pr.yml` via `npm run test-coverage` or a dedicated step) once screens are final. Snapshot baselines are platform-specific — generate Linux baselines on the CI OS (`npm run test:visual:update`) when enabling, then keep them refreshed as the UI changes.
- [ ] **Remove the hidden components showcase.** Delete the `/components/*` routes (`apps/manage/src/app/views/components`, `views/interactive-map-examples`), the `?components=true` URL-parameter gating in `src/util/config-middleware.ts` (`res.locals.showComponentsNav`), the nav item in `views/layouts/components/header.njk`, and the `/components` entries in the e2e a11y/render/visual specs.

## Where to record new decisions

Prefer lightweight ADRs or Confluence decision pages, then link them from this file. Suggested minimum fields:

1. Context
2. Decision
3. Consequences
4. Date / owner
5. Status (proposed / accepted / superseded)

Until an ADR folder exists, add a bullet under **Recorded decisions** in this page and reference the PR.

## Related pages

- [Project overview](./project-overview.md)
- [Architecture and tracks](./architecture-and-tracks.md)
