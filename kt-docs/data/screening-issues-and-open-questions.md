# Screening issues and open questions

**Status:** Partial — issues affecting the intersection logic, as of October 2026.

> **Scope:** data processing (loading, ids and schema) is being redeveloped separately, and the region field is being worked on there too, so neither is covered here. This page is about what affects which consultees the screening finds, and how fast.

## Data issues that change screening results

| Issue                                                                                                              | Effect on screening                                                               | Handled today by                                   | Suggested next step                                                   |
| ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------- |
| **Railway merged nationally** — one feature is the whole GB main-line network (233,820 points)                     | Being near it is true almost everywhere, and it slows every query that touches it | Excluded from the ruleset and from the nearby list | Supply it split into routes or regions, then re-add a condition       |
| **"Unparished area" rows** — 204 rows such as "Luton, unparished area" are categorised as Parish Council           | Listed as consultees, but there's no parish council to consult                    | Nothing                                            | Decide whether to exclude them from screening                         |
| **Gaps between boundaries from different sources** — e.g. Sundon parish and Luton are 32m apart though they border | A real neighbour can be missed by "bordering" conditions                          | Bordering counts areas within 50m                  | Larger gaps would still be missed — worth checking in the new dataset |
| **Four categories with no condition** — Electricity Generator, Interconnector, DNO, Corporate Joint Committee      | Never matched by the ruleset (they do appear in the nearby list)                  | Deliberate, pending data review                    | Review the data and add conditions                                    |
| **National Landscape: England and Wales conditions use the same category**                                         | No country distinction (both 35km, so results are unaffected today)               | Nothing                                            | Fine unless the two need different rules                              |
| **Several boundary submissions per case** — 269 references across 282 rows                                         | Each submission is screened separately; there's no notion of the current boundary | Nothing                                            | Decide which submission is screened                                   |
| **Over-digitised site boundaries** — e.g. 2,536 points for a 0.3 km² site                                          | Slow screening                                                                    | Sites simplified to 10m before screening           | None needed now                                                       |

## Performance and platform

| Issue                                                                                | Effect                                                                                                      | Suggested next step                                                                    |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **Test and Training are on SQL Basic; Prod is on S0**                                | Screening is CPU-heavy. Dev was unusable on Basic before moving to S2                                       | Size Prod (and any environment used for real testing) before go-live, with a load test |
| Prod keeps a geo-replica                                                             | A tier change has to resize the replica too; the deploy identity needed extra permissions in Dev to do that | Confirm the identity's permissions in Prod before resizing                             |
| **Large linear schemes are slow** — 28s locally for a 180km route, slower under load | They may still hit the 45s query timeout on a busy or small tier                                            | If latency must be predictable, precompute ruleset results per case and store them     |

## Verification gaps

| Gap                                                                            | Suggested next step                                                                                                                           |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Golden tests need the full dataset, so CI skips them                           | Add a CI job with the full dataset, or run them before each release                                                                           |
| The independent Python calculation behind the golden results isn't in the repo | Commit it as a tool, so expected results can be regenerated when the data, schema or ruleset changes — including after the data redevelopment |

## Questions to agree

1. Are the inclusion margins right — 30m on every distance threshold, and 50m for "bordering"? Wider catches more borderline consultees; narrower lists fewer extras.
2. Should "unparished area" rows be excluded from screening?
3. Which boundary submission should be screened when a case has several?
4. When can Railway be supplied split by route or region?
5. Which of the four uncovered categories need ruleset conditions, and with what distances?
6. What response time is acceptable for the largest schemes — or should results be precomputed?

## Related pages

- [Spatial screening engine](./spatial-screening-engine.md)
- [Reference data catalogue](./reference-data-catalogue.md)
- [Decisions and open questions](../decisions-and-open-questions.md) (frontend pack)
