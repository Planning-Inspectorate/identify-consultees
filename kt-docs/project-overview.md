# Project overview

**Status:** Partial — product framing is still a spike; implementation detail below matches this repo.

## Purpose

Identify consultees is a GIS-oriented service for finding consultees associated with Nationally Significant Infrastructure Project (NSIP) geometries and related datasets.

The **manage** app (`apps/manage`) is a server-rendered GOV.UK Frontend web UI. It is the frontend focus of this knowledge-transfer pack.

This work sits in the lineage of the **PINS data spike / CBOS-adjacent exploration**: prove how a government-shaped UI can present project geometries, map overlays, and (optionally) Python geospatial tooling — without yet committing to a full production CBOS replacement.

## Hypotheses (working)

These are the spike hypotheses as currently reflected in the codebase and docs. Treat them as working assumptions until product records them formally.

| Hypothesis                                                         | What we are testing                                                                                       | Evidence in this repo                                                                        |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| A GOV.UK server-rendered UI is enough for early consultee journeys | Users can search real project boundaries, pick a ruleset, and review map-backed results without a SPA     | Homepage + `/consultees/:caseId` → `/results` using Nunjucks / GOV.UK macros                 |
| Progressive enhancement for maps is viable                         | Interactive Defra map when JS works; static image when it does not                                        | `consultee-map-region.njk`, static-map routes, Defra vendor assets                           |
| SQL spatial screening can drive the whole journey                  | Rulesets run as `GEOGRAPHY` queries in SQL Server; seeded sample data stands in for the full dataset      | Python `run_ruleset` (`apps/function-python`) + `searchCaseBoundaries` (`packages/database`) |
| Node can call Python geo tooling over HTTP without hard-coupling   | Rulesets run in the Python function; the manage app stays up, with a clear error, if it or the DB is down | `ruleset-runner.ts` + `PYTHON_FUNCTION_URL`/`PYTHON_FUNCTION_API_KEY`                        |

## What is intentionally out of scope (today)

Call these out in Confluence as **Out of scope for this spike frontend**:

- Replacing CBOS as a system of record
- Using **production CBOS data or secrets** in local or spike environments
- A custom design system or React/SPA frontend for the manage app
- A complete multi-step `/filter` … `/filter-4` wizard (wording from earlier spikes — **not** how this repo is routed today; see [Search and filtering](./search-and-filtering.md))
- An end-user shapefile upload wizard **inside** the manage UI (reference data lands via admin blob upload/import routes and seed pipelines; the external GIS process is documented separately)
- HTTP/3 / QUIC in the Node process (Azure Front Door is the edge; origin stays HTTP/1.1)

## What “done enough” looks like for KT readers

After reading this pack you should be able to:

1. Run the manage app locally with auth disabled and the seeded sample dataset
2. Explain which journeys need the **database**, which need **Python**, and which work without either
3. Change a Nunjucks page using GOV.UK macros only
4. Know where maps, static fallbacks, and the Python bridge live
5. Add a route test without breaking the coverage gate

## Related pages

- [Architecture and tracks](./architecture-and-tracks.md)
- [Decisions and open questions](./decisions-and-open-questions.md)
