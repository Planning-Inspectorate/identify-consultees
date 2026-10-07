# Data knowledge transfer (identify consultees)

Working draft of data knowledge-transfer material, centred on the **intersection logic**: how a case boundary is screened against consultee areas to decide who to consult. It sits alongside the [frontend KT pack](../README.md) and follows the same conventions — plain Markdown that can be pasted into Confluence later, with a status line at the top of each page.

> **Scope:** data processing (loading, ids and schema) is being redeveloped separately, and the region field is being worked on there too. Those pages here describe the current state only, as far as screening needs it.

## How to use this pack

| Audience | Start here |
| -------- | ---------- |
| Anyone working on the intersection logic | [Spatial screening engine](./spatial-screening-engine.md) → [Screening issues and open questions](./screening-issues-and-open-questions.md) |
| New to the data | [Data architecture overview](./data-architecture-overview.md) → [Reference data catalogue](./reference-data-catalogue.md) |
| Repointing screening at the redeveloped data | [Data model](./data-model.md) → [Spatial screening engine](./spatial-screening-engine.md#what-screening-needs-from-the-data) |

## Contents

1. [Spatial screening engine](./spatial-screening-engine.md) — rulesets, how a run works, inclusion margins, query plans, performance, verification
2. [Screening issues and open questions](./screening-issues-and-open-questions.md) — what affects screening results and speed, and decisions needed
3. [Reference data catalogue](./reference-data-catalogue.md) — the 27 consultee categories: volumes, shapes, ruleset coverage
4. [Data architecture overview](./data-architecture-overview.md) — where the data lives and what reads it
5. [Data model](./data-model.md) — the current tables and spatial conventions (being redeveloped)
6. [Loading data](./loading-data.md) — how to load data today (being redeveloped)

Figures quoted in these pages (row counts, timings) were measured in October 2026 against the full reference dataset (`combined_reference_data_v1.geojson`, 18,258 consultee areas; 282 case boundaries) loaded locally. Status meanings follow the [frontend pack's legend](../README.md#document-status-legend).
