# Identify consultees: knowledge transfer

How the service works and how to work on it. Plain Markdown, so it can move to Confluence later (one child page per file).

| You want to | Read |
| ----------- | ---- |
| Understand the service | [Overview](./overview.md) |
| Run it locally, or fix a local problem | [Local development](./local-development.md) |
| Change pages or journeys | [Web app](./web-app.md) → [Frontend conventions](./frontend-conventions.md) |
| Work on the maps | [Maps](./maps.md) |
| Work on the screening (which consultees a project needs) | [Screening service](./screening-service.md) → [Screening engine](./data/screening-engine.md) |
| Add or fix tests | [Testing](./testing.md) |
| Ship to an environment, or load data there | [Deployment](./deployment.md) → [Data model and loading](./data/data-model.md) |
| Work on the data | [Data model and loading](./data/data-model.md) → [Reference data](./data/reference-data.md) → [Screening issues](./data/screening-issues.md) |

Elsewhere in the repo:

- [`README.md`](../README.md): clone and start
- [`AGENTS.md`](../AGENTS.md): rules for coding agents (GDS, maps, toolchain, PR practice)
- [`CONTRIBUTING.md`](../CONTRIBUTING.md), [`ACCESSIBILITY.md`](../ACCESSIBILITY.md), [`SECURITY.md`](../SECURITY.md)
- [`docs/gis-shapefile-upload-and-report.md`](../docs/gis-shapefile-upload-and-report.md): today's manual GIS process, which the service replaces
- [`apps/function-python/README.md`](../apps/function-python/README.md): the Python function

Figures (row counts, timings) were measured in October 2026 against the full reference dataset: 18,258 consultee areas and 282 case boundaries.
