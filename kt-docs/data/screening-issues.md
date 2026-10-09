# Screening issues

What affects which consultees screening finds, and how fast, as of October 2026. Data processing (ingest, ids, schema, the region field) is being redeveloped separately and isn't covered.

## Data issues that change results

| Issue                                                                                                        | Effect                                                         | Today                                          | Next step                                                |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------- |
| **Railway merged nationally**: one feature is the whole GB main line (233,820 points)                        | Near it almost everywhere; slows every query touching it       | Excluded from conditions and the nearby search | Supply it split by route or region, then add a condition |
| **"Unparished area" rows**: 204, e.g. "Luton, unparished area", categorised as Parish Council                | Listed as consultees, but there's no council to consult        | Nothing                                        | Decide whether to exclude them                           |
| **Gaps between boundaries from different sources**: Sundon parish and Luton are 32m apart though they border | A real neighbour can be missed                                 | Bordering counts areas within 50m              | Check for larger gaps in the new dataset                 |
| **Four categories with no condition**: Electricity Generator, Interconnector, DNO, Corporate Joint Committee | Only ever found by the nearby search                           | Deliberate, pending data review                | Review the data and add conditions                       |
| **National Landscape**: the England and Wales conditions use the same category                               | No country distinction (both 35km, so no effect today)         | Nothing                                        | Fine unless they need different rules                    |
| **Several boundary submissions per case**: 269 references across 282 rows                                    | Each is screened separately; no notion of the current boundary | Nothing                                        | Decide which one is screened                             |
| **Over-digitised sites**: 2,536 points for a 0.3km² site                                                     | Slow screening                                                 | Sites simplified to 10m first                  | None needed                                              |

## Performance and platform

| Issue                                                   | Effect                                                                              | Next step                                                                             |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **SQL tiers**: Dev S2; Test and Training Basic; Prod S0 | Screening is CPU-heavy. Dev was unusable on Basic                                   | Size Prod, and any environment used for real testing, with a load test before go-live |
| Prod has a geo-replica                                  | A tier change resizes the replica too, which needed extra deploy permissions in Dev | Confirm the permissions in Prod before resizing                                       |
| **Large linear schemes**: 28s locally for a 180km route | Could reach the web app's 60s timeout on a busy or small tier                       | If latency must be predictable, precompute results per case                           |

## Verification gaps

| Gap                                                                     | Next step                                                                                     |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Golden tests need the full dataset and the function, so CI skips them   | A CI job with the full dataset, or a run before each release                                  |
| The independent calculation behind the golden results isn't in the repo | Commit it as a tool, so expectations can be regenerated after data, schema or ruleset changes |

## Questions to agree

1. Are the margins right: 30m on every distance threshold, 50m for bordering? Wider catches more borderline consultees; narrower lists fewer extras.
2. Should "unparished area" rows be excluded?
3. Which boundary submission is screened when a case has several?
4. When can Railway be supplied split by route or region?
5. Which of the four uncovered categories need conditions, at what distances?
6. What response time is acceptable for the largest schemes, or should results be precomputed?
