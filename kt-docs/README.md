# Frontend knowledge transfer (identify consultees)

Working draft of frontend knowledge-transfer material for the Identify consultees manage app.

> **Dual format:** These pages are written in plain Markdown so they can live in the repo now and be pasted into Confluence later with minimal rewriting. Prefer headings, tables, and short callout paragraphs over GitHub-only features. When moving to Confluence, turn each file into a child page under a parent “Frontend KT” space, and recreate relative links as page links.

## How to use this pack

| Audience | Start here |
| -------- | ---------- |
| New engineer joining the spike | [Project overview](./project-overview.md) → [Local setup](./local-setup.md) → [Routes and user journeys](./routes-and-user-journeys.md) |
| Someone changing UI / GOV.UK pages | [Application structure](./application-structure.md) → [GOV.UK Frontend conventions](./govuk-frontend-conventions.md) |
| Someone working on maps or Python | [Maps](./maps.md) → [Node–Python integration](./node-python-integration.md) |
| Someone investigating failures | [Troubleshooting](./troubleshooting.md) |

## Document status legend

Used at the top of each page:

| Status | Meaning |
| ------ | ------- |
| **Current** | Matches the codebase as of this draft |
| **Partial** | Topic exists; some detail still unknown or still evolving |
| **Planned / sparse** | Named for KT completeness; little or no implementation yet |

## Contents

1. [Project overview](./project-overview.md) — purpose, hypotheses, out of scope
2. [Architecture and tracks](./architecture-and-tracks.md) — Tracks A / B / C and sample-data guidance
3. [Local setup](./local-setup.md) — Node, npm, Python, env, start the web app
4. [Application structure](./application-structure.md) — tour of `apps/manage`
5. [Routes and user journeys](./routes-and-user-journeys.md) — homepage through maps and optional journeys
6. [GOV.UK Frontend conventions](./govuk-frontend-conventions.md) — macros, layout, progressive enhancement
7. [Search and filtering](./search-and-filtering.md) — homepage search over `case_boundary` (maps conceptual `/filter` wording)
8. [Case and dataset pages](./case-and-dataset-pages.md) — case routing and the ruleset-driven results page
9. [Maps](./maps.md) — Defra Interactive Map and static-map fallback
10. [Upload and spatial screening](./upload-and-spatial-screening.md) — admin data loading + ruleset screening; end-user upload still sparse
11. [Node–Python integration](./node-python-integration.md) — safe UI calls and fallbacks
12. [API and data contracts](./api-and-data-contracts.md) — JSON / GeoJSON conventions
13. [Accessibility and quality](./accessibility-and-quality.md) — WCAG expectations and no-JS
14. [Testing](./testing.md) — lint, unit, Playwright, how to add tests
15. [Troubleshooting](./troubleshooting.md) — common local failures
16. [Deployment and environments](./deployment-and-environments.md) — local vs Azure
17. [Decisions and open questions](./decisions-and-open-questions.md) — constraints and experiments

## Related repo docs (keep linking from Confluence too)

| Doc | Purpose |
| --- | ------- |
| [`README.md`](../README.md) | Clone, bootstrap, and day-one runbook |
| [`AGENTS.md`](../AGENTS.md) | GDS, maps, toolchain, PR practices |
| [`docs/frontend-testing.md`](../docs/frontend-testing.md) | Frontend test matrix |
| [`docs/gis-shapefile-upload-and-report.md`](../docs/gis-shapefile-upload-and-report.md) | External GIS shapefile / report process |
| [`apps/function-python/README.md`](../apps/function-python/README.md) | Python Azure Function local setup |

## Confluence migration checklist

When these pages leave the repo:

- [ ] Create a parent page (suggested title: **Identify consultees — frontend KT**)
- [ ] Create one child page per file below this README (same titles)
- [ ] Replace relative Markdown links with Confluence page links
- [ ] Convert “Status” tables / callouts into Confluence Info / Warning macros if desired
- [ ] Replace file paths with links to the GitHub default branch where helpful
- [ ] Confirm production secrets / connection strings are **not** copied into Confluence
- [ ] Leave a short stub in `kt-docs/README.md` pointing to the Confluence parent URL
