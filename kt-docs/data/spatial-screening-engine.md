# Spatial screening engine

**Status:** Current — `packages/database/src/geospatial/rulesets.ts` and `consultee-areas.ts` on `main`, October 2026.

## What it does

Given a case boundary and a ruleset, the engine finds every consultee the ruleset says should be contacted. A ruleset is a list of **conditions**, such as "the district council the site is in", "hospitals within 10km" or "parishes bordering the site's parish". The result is everything any condition matches, de-duplicated.

The guiding policy: **when in doubt, include.** Consulting one body too many is acceptable; missing one is not. Distances shown are approximate.

## Rulesets

One ruleset exists today: `example-ruleset`, read at start-up from `example_ruleset.csv`, a tab-separated export with one row per condition.

| CSV column                               | Meaning                                                                                                                                      |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `consulteeName`                          | Condition id, e.g. `hospital`                                                                                                                |
| `consulteeDescription`                   | Display name                                                                                                                                 |
| `referenceData`, `matchingConsulteeType` | Which category or categories to match. The first non-empty of `referenceData`, `matchingConsulteeType` (`;`-separated), then `consulteeName` |
| `logicType`                              | `intersection` or `bordering`                                                                                                                |
| `intersectionBufferKm`                   | For `intersection`: how far from the site; `0` means the area must touch the site                                                            |
| `hostType`                               | For `bordering`: which category the site's "host" area is (e.g. parish)                                                                      |

CSV identifiers are short codes (`distr_council`, `ambulance_services_epsg27700`); the database uses readable names (`Lower Tier Authority`, `Ambulance Trust`). `CATEGORY_ALIASES` in `rulesets.ts` maps one to the other. **An identifier with no alias and no matching category silently matches nothing** — check new conditions against the [catalogue](./reference-data-catalogue.md).

The example ruleset has 27 conditions: 7 that must touch the site, 16 within a distance (1km to 35km), and 4 bordering.

## How a run works

`runRuleset(db, siteGeometry, ruleset)`:

1. **Simplify the site** to 10m, once. Detailed boundaries are the main cost: Silvertown Tunnel goes from 2,536 points to 66.
2. **Fetch everything nearby, once.** One query finds every consultee area within 20km of the site, in any category except Railway. This answers the 20 conditions with a distance of 20km or less, which are filtered from it in memory, and it is the "all consultees within 20km" list on the results page. The radius comes from `NEARBY_CONSULTEE_RADIUS_KM` (default 20).
3. **Run the other conditions**, six at a time:
   - **Wider than 20km** (three 35km conditions): one query each, limited to their category.
   - **Bordering** (four conditions): grow the site by the margin once, then find **hosts** (areas of the host category that intersect it), grow each host by 50m, and find **neighbours** (areas of the matching categories that intersect a grown host, excluding the host itself).
4. **Merge** the results, keeping each area's smallest distance. Bordering matches that no other condition already measured get their distance from the site measured once, here.
5. **Fetch original geometry** for the final matches only. The results map only falls back to it if the step below fails.

## Results map

After the run, the results page draws everything within the nearby radius, not just the matches:

1. **Search area:** the site grown by 20km (`bufferGeometryForDisplay`), drawn as a dashed outline. Both the interactive and static maps open on it.
2. **Display geometry:** each nearby area and match is clipped to the search area and simplified to 25m (`getConsulteeAreaDisplayGeometries`, `DISPLAY_SIMPLIFY_TOLERANCE_METRES`), from `geometrySimplified`. Without clipping, regional areas such as counties and ambulance trusts made the page several megabytes; Hinkley Point C went from 1.5MB to 360KB.
3. Areas with nothing inside the search area aren't drawn, but are still listed in the tables. This includes bordering matches more than 20km away.

If building the search area fails, the page still renders, with the project and matches drawn from original geometry. See [Maps](../maps.md#results-map-layers) for the layers and styling.

## Tolerances

All screening runs on simplified shapes (`geometrySimplified`, and the simplified site). Simplifying both sides can shift a distance by up to 20m, so every threshold is widened beyond that:

| Constant (`consultee-areas.ts`) | Value | Meaning                                                                                                                                             |
| ------------------------------- | ----: | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SIMPLIFY_TOLERANCE_METRES`     |   10m | Every point of a simplified shape is within this of the original                                                                                    |
| `DISTANCE_MARGIN_METRES`        |   30m | Added to every distance threshold, including "must touch" (0km → 30m) and the 20km nearby fetch. Also how close an area must be to count as a host  |
| `BORDERING_TOLERANCE_METRES`    |   50m | How close two areas must be to count as bordering. Covers the simplification error, plus small gaps between boundaries drawn from different sources |

**Effect:** across all 282 case boundaries, no consultee was lost compared with an exact calculation, and about 2% more were included (median 1 per project). Examples:

- Three University College hospitals at 10.002km from Silvertown Tunnel are now included under "hospitals within 10km".
- Sundon parish counts as bordering Luton. The two really do border, but their boundaries are 32m apart in the data.

## Worked example: London Luton Airport Expansion (TR020001)

The site straddles five authorities: Luton and Central Bedfordshire (unitary), Hertfordshire (county), and North Hertfordshire and Dacorum (districts). Screening finds 90 consultees by an exact calculation, and 91 with the inclusion margins (Sundon parish):

| Category                                                                                                    | Consultees |
| ----------------------------------------------------------------------------------------------------------- | ---------: |
| Parish Council                                                                                              |         37 |
| Hospital                                                                                                    |         17 |
| Lower Tier Authority                                                                                        |         10 |
| Unitary Authority                                                                                           |          9 |
| Upper Tier Authority                                                                                        |          3 |
| Ambulance Trust, Fire and Rescue Authority, ICB, Local Resilience Forum, Police, Internal Drainage District |     2 each |
| National Landscape, Greater London Authority                                                                |     1 each |

**Why bordering results can be far from the site:** the condition "county, unitary or national park bordering the host county" uses Hertfordshire as a host. Everything bordering Hertfordshire is therefore included, among them the London boroughs of Hillingdon, Barnet and Harrow, each about 24km from the site. That's the rule working as written. Bordering is about the host area's neighbours, not about distance from the site; the distance shown is only for information.

## Query plans

Two techniques keep the queries fast. Both are easy to undo by accident.

| Technique                                                                                               | Why                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Forced spatial index** — `WITH (INDEX(consultee_area_geometry_simplified_sidx))` on screening queries | Prisma sends parameterised SQL. With a category filter, SQL Server sometimes chose to read every row of that category nationally and measure each one, ignoring the spatial index — about 180 times slower for district councils. The same query tested with values typed into the SQL picks the right plan, so this doesn't show up in ad-hoc testing |
| **Intersects with a grown shape instead of distance**                                                   | "Within n metres of X" is answered as "intersects X grown by n". An intersects check stops at the first point of contact; a distance check can't. For a 180km route, finding host parishes went from timing out at 15s to about 2s                                                                                                                     |

## Timeouts and failures

| Setting                   | Behaviour                                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------------------- |
| Database request timeout  | 45s per query, for the app (`APP_REQUEST_TIMEOUT_MS` in `packages/database/src/index.ts`)                |
| Deadlocks                 | Retried up to 3 times                                                                                    |
| Timeouts                  | **Not** retried. Re-running a slow query just repeats the wait; this was the cause of multi-minute hangs |
| Failure shown to the user | "The ruleset could not be run" with a "Try again" link, never empty tables                               |

## Performance

Measured locally (laptop, full dataset) across all 282 case boundaries:

| Measure         | Time                                                        |
| --------------- | ----------------------------------------------------------- |
| Median run      | 0.93s                                                       |
| 90th percentile | 2.6s                                                        |
| 99th percentile | 10.1s                                                       |
| Slowest         | 28s — Norwich to Tilbury, a 180km route with 474 consultees |

Large linear schemes are the slowest by far. Azure SQL tiers are slower than a laptop, and runs slowed sharply when the database was busy with other work, so Dev times depend on load.

## How it's verified

| Check                                                                                              | Where                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit tests for each condition type, de-duplication, tolerances and failures                        | `rulesets.test.ts`, `consultee-areas.test.ts` (CI)                                                                                                                                                                                                                                                        |
| **Golden tests**: five real projects (London, Somerset coast/nuclear, Wales, offshore wind, Luton) | `rulesets.golden.test.ts` with `ruleset-golden-cases.json`. They need the full dataset, so they run locally and skip in CI                                                                                                                                                                                |
| Independent check                                                                                  | The golden results came from a separate Python/shapely calculation over the raw GeoJSON, sharing no code with the app. Each case lists `mustInclude` (an exact calculation) and `mayAlsoInclude` (a deliberately generous one); the app must return every exact match and nothing beyond the generous set |

## Changing a ruleset

1. Edit `example_ruleset.csv`, or add a new ruleset to `RULESETS` in `rulesets.ts`.
2. Add any new short codes to `CATEGORY_ALIASES`.
3. Check every condition's category exists in the [catalogue](./reference-data-catalogue.md) — unmatched ones silently find nothing.
4. The golden tests' expected results will change. Regenerate them from an independent calculation rather than from the app's own output.

## What screening needs from the data

The data processing is being redeveloped with new ids and a new schema. For the intersection logic to keep working, the new data needs to provide the following. All the SQL that reads the tables is in `consultee-areas.ts` and `case-boundaries.ts`; `rulesets.ts` has none, so repointing at new tables is contained to those two files.

| Need                                                                | Why                                                                                                                        | Today                                                                                     |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Consultee areas with a category, a display name and a unique id** | Conditions match on category; the id is how matches are de-duplicated and how their map geometry is fetched                | `consultee_area.consulteeCategory`, `consultee`, `id`                                     |
| **Category names that match the ruleset vocabulary**                | Rulesets refer to short codes, mapped to category names in `CATEGORY_ALIASES`. A renamed category silently matches nothing | 27 categories — see the [catalogue](./reference-data-catalogue.md)                        |
| **Valid `geography` (SRID 4326), correctly wound**                  | Invalid shapes make SQL Server reject the whole query, and a backwards ring matches the whole globe                        | `MakeValid()` and winding correction on import                                            |
| **A simplified copy of each geometry, with a spatial index**        | All screening queries run on it, and the 30m/50m margins assume a 10m tolerance                                            | `geometrySimplified`, `Reduce(10).MakeValid()`, `consultee_area_geometry_simplified_sidx` |
| **The original geometry**                                           | Kept as the source of truth; the map draws a clipped copy of the simplified geometry                                       | `geometry`                                                                                |
| **Features split at a sensible scale**                              | A national-scale shape such as merged Railway makes every nearby query slow and matches everywhere                         | Railway excluded                                                                          |
| **Case boundaries as valid `geography`**                            | The site being screened                                                                                                    | `case_boundary.geometry`                                                                  |

**If ids change:** the golden test expectations (`ruleset-golden-cases.json`) are keyed by today's ids and will need regenerating.

## Related pages

- [Data model](./data-model.md)
- [Reference data catalogue](./reference-data-catalogue.md)
- [Maps](../maps.md) (frontend pack)
- [Case and dataset pages](../case-and-dataset-pages.md) (frontend pack)
