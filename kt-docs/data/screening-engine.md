# Screening engine

Given a case boundary and a ruleset, the engine finds every consultee to contact. It runs in the Python function: `run_ruleset` in `apps/function-python/intersector/screening.py`, behind `POST /api/run-ruleset` (the contract is in [Screening service](../screening-service.md)).

The guiding policy is **when in doubt, include**. Consulting one body too many is acceptable; missing one isn't. Distances decide matches but aren't shown to users.

## Rulesets

A ruleset is a list of **conditions**, such as "the district council the site is in", "hospitals within 10km" or "parishes bordering the site's parish". The rulesets come from the **rulesets workbook** (`Rulesets.xlsx`): each sheet is one ruleset, saved as CSV, one row per condition, named `<name>_ruleset.csv` in `packages/database/src/geospatial/`. The web app loads every such file at start-up (`rulesets.ts`) and sends the selected ruleset's conditions with each run, so the definitions have one home, which the report pages also read to explain matches.

| Workbook sheet      | File                                      | Shown as                         | Conditions |
| ------------------- | ----------------------------------------- | -------------------------------- | ---------: |
| `ew_aft_30_04_2024` | `england_wales_post_20240430_ruleset.csv` | England Wales post 30 April 2024 |         34 |
| `en_pre_30_04_2024` | `england_pre_20240430_ruleset.csv`        | England pre 30 April 2024        |         31 |
| `wa_pre_30_04_2024` | `wales_pre_20240430_ruleset.csv`          | Wales pre 30 April 2024          |         23 |

The file name gives the id and display name: `england_wales_post_20240430_ruleset.csv` is `england-wales-post-20240430`, shown as "England Wales post 30 April 2024" (joining words stay lower case, `YYYYMMDD` dates are written out). Rename the file to change what users see. England Wales post 30 April 2024 is the default (`DEFAULT_RULESET_ID`).

| CSV column                 | Meaning                                                                                                                                   |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `Group hierarchy`, `Group` | The workbook's grouping (administrative boundaries, public bodies, energy...). Not used by screening                                      |
| `Category`                 | For administrative boundaries, the authority role from the workbook's A-D_authorities sheet (`B Host Authority`, `A Bordering Authority`) |
| `Consultee Type(s)`        | Which consultees, in words. `CONSULTEE_TYPES` in `rulesets.ts` maps each wording to categories, and a bordering one to its host category  |
| `Logic`                    | `Intersects application site`, `Intersects application site buffer`, or `Borders host authority`                                          |
| `Buffer (km)`              | For the buffer logic: distance from the site                                                                                              |

**An unrecognised Consultee Type(s), Logic or buffer stops the app at start-up**, naming the row, rather than silently matching nothing. A condition's id comes from its authority letter, consultee type and buffer (`b_host_unitary_authorities`, `ambulance_trusts_10km`); its name, shown in **Why identified**, keeps the letter (`"B" host Unitary Authorities`).

Some consultee types have no reference data yet: canals, Joint Transport Authorities (Wales), MoD safeguarding and low flying areas, coal mining reporting areas and the Cheshire brine area (`CATEGORIES_AWAITING_DATA`). Their conditions stay in the rulesets and match nothing until data with those category names is loaded. The check page still lists them, with nothing found.

## How a run works

Python decides which queries to run and combines the results; the geometry maths runs in SQL Server, as `geography` methods against the spatial index. The SQL is all in `intersector/queries.py`.

1. **Simplify the site** to 10m, once. Detailed boundaries are the main cost: Silvertown Tunnel goes from 2,536 points to 66.
2. **Fetch everything nearby, once**: every consultee area within 20km (`NEARBY_CONSULTEE_RADIUS_KM`) in any category except Railway. This answers every condition of 20km or less, filtered in memory, except Railway's, which runs as its own query, and every area it finds gets a `nearby` reason whether or not a condition matched it.
3. **Run the other conditions**, six at a time, each on its own connection:
   - **Wider than 20km** (three 35km conditions): one query each, limited to their category.
   - **Bordering** (four): find **hosts** (host-category areas intersecting the site), grow each by 50m, and find **neighbours** (matching-category areas intersecting a grown host, excluding the host).
4. **Merge**: each consultee once, with its smallest distance and every reason, `condition` reasons in the ruleset's order and then `nearby`. Bordering matches nothing else measured get their distance measured here.
5. **Fetch original geometry** for condition matches only. The map normally draws display geometry instead (see [Maps](../maps.md)).

The report pages turn reasons into **Why identified** text (`apps/manage/src/app/views/consultees/reasons.ts`), one per line:

| Reason                   | Shown as                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| Intersection, buffer 0   | `"B" host District Councils: intersects the site`                                                |
| Intersection, buffer > 0 | `Hospitals: within 10km of the site`                                                             |
| Bordering                | The condition's description, e.g. `"A" Community Councils bordering "B" host Community Councils` |
| Nearby                   | `Within 20km of the site` (the `/results` page only - see below)                                 |

**The report is what the conditions identified.** The check page, category pages, remove page and report created page list only consultees that met at least one condition (`isIdentifiedByCondition`), and leave the nearby reason out of **Why identified**. Consultees only the nearby search found are context, not report content: the category maps draw them fainter (see [Maps](../maps.md#layers)), and the unlinked `/results` page still lists everything.

## Tolerances

Screening runs on simplified shapes on both sides, which can shift a distance by up to 20m, so every threshold is widened. Constants in `intersector/tolerances.py`:

| Constant                     | Value | Meaning                                                                                                                                          |
| ---------------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SIMPLIFY_TOLERANCE_METRES`  |   10m | Every point of a simplified shape is within this of the original                                                                                 |
| `DISTANCE_MARGIN_METRES`     |   30m | Added to every distance threshold, including "must touch" (0 → 30m) and the 20km nearby fetch. Also how close an area must be to count as a host |
| `BORDERING_TOLERANCE_METRES` |   50m | How close two areas must be to count as bordering: the simplification error plus small gaps between boundaries from different sources            |

`SIMPLIFY_TOLERANCE_METRES` must equal the value in `packages/database/src/geospatial/consultee-areas.ts` and the migration that built `geometrySimplified`. The margins live only in Python.

**Effect:** across all 282 case boundaries no consultee was lost compared with an exact calculation, and about 2% more were included (median 1 per project). For example, three hospitals at 10.002km from Silvertown Tunnel are now within 10km, and Sundon parish borders Luton though the data puts them 32m apart.

## Worked example: London Luton Airport Expansion (TR020001)

The site straddles Luton and Central Bedfordshire (unitary), Hertfordshire (county), and North Hertfordshire and Dacorum (districts). An exact calculation finds 90 consultees; the margins add Sundon parish for 91: 37 parish councils, 17 hospitals, 10 lower tier, 9 unitary and 3 upper tier authorities, 2 each of ambulance trust, fire and rescue, ICB, resilience forum, police and drainage district, and 1 each of National Landscape and the GLA.

Bordering results can be far from the site. "County, unitary or national park bordering the host county" uses Hertfordshire as host, so everything bordering Hertfordshire is included, among them Hillingdon, Barnet and Harrow, about 24km away. That's the rule as written: bordering is about the host's neighbours, not distance.

## Query plans

Two techniques keep queries fast, and both are easy to undo by accident:

- **Forced spatial index**, `WITH (INDEX(consultee_area_geometry_simplified_sidx))`. With a category filter and parameterised SQL, SQL Server sometimes read every row of the category nationally and measured each, about 180 times slower for district councils. The same query with typed-in values picks the right plan, so ad-hoc testing doesn't show it. pymssql substitutes values into the text, but the hint stays so a driver change can't undo it.
- **Intersects with a grown shape instead of distance.** "Within n metres of X" becomes "intersects X grown by n". Intersects stops at the first contact; distance can't. For a 180km route, finding host parishes went from a 15s timeout to about 2s.

## Timeouts and failures

- The web app waits 60s for a run (`RUN_RULESET_TIMEOUT_MS` in `apps/manage/src/app/ruleset-runner.ts`).
- Deadlocks are retried up to 3 times (`intersector/database.py`). Timeouts aren't: re-running a slow query just repeats the wait, and that once caused multi-minute hangs.
- Any failure shows "The ruleset could not be run" with Try again, never empty tables.

## Performance

Measured on a laptop with the full dataset across all 282 boundaries (when the engine ran in Node; the Python port took 345s in total against 351s):

| Median | 90th percentile | 99th percentile | Slowest                                                    |
| -----: | --------------: | --------------: | ---------------------------------------------------------- |
|  0.93s |            2.6s |           10.1s | 28s: Norwich to Tilbury, a 180km route with 474 consultees |

Long linear schemes are by far the slowest. Azure SQL is slower than a laptop and slows sharply when busy.

## How it's verified

| Check                                                                                                                                      | Where                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Each condition type, de-duplication, tolerances, failures, request validation                                                              | `intersector/test_screening.py`, `test_function_app.py` (pytest, in CI); the web app's client in `ruleset-runner.test.ts`                                                                                                         |
| **Golden tests**: five real projects (London, Somerset coast nuclear, Wales, offshore wind, Luton) end to end through the running function | `apps/manage/src/app/ruleset-runner.golden.test.ts` and `ruleset-golden-cases.json`. They need the full dataset and the function, so they run locally and skip in CI                                                              |
| Independent check                                                                                                                          | The golden results came from a separate shapely calculation over the raw GeoJSON. Each case has `mustInclude` (exact) and `mayAlsoInclude` (generous): the app must return every exact match and nothing outside the generous set |
| Port parity                                                                                                                                | Node and Python engines gave identical matches, order and nearby lists over all 283 local boundaries                                                                                                                              |

## Changing a ruleset

1. Update the workbook, then save each changed sheet as CSV (UTF-8) over its `<name>_ruleset.csv`, or as a new one beside them. No code change: conditions travel with each request.
2. A new Consultee Type(s) wording needs an entry in `CONSULTEE_TYPES`; the app won't start until it has one, and `npm test` says which row.
3. Check each condition's category exists in the [reference data](./reference-data.md); the rulesets test fails on one that doesn't, unless it's listed in `CATEGORIES_AWAITING_DATA`.
4. Regenerate the golden expectations from an independent calculation, not the app's own output.

## What screening needs from the data

Data processing is being redeveloped with new ids and a new schema. Repointing screening at new tables is contained to `intersector/queries.py` and the web app's `consultee-areas.ts` and `case-boundaries.ts`. The new data must provide:

| Need                                                    | Why                                                                           | Today                                                           |
| ------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Consultee areas with a category, a name and a unique id | Conditions match on category; the id de-duplicates and fetches map geometry   | `consulteeCategory`, `consultee`, `id`                          |
| Categories matching the ruleset vocabulary              | A renamed category silently matches nothing                                   | 27 categories                                                   |
| Valid, correctly wound `geography` (SRID 4326)          | Invalid shapes fail the whole query; a backwards ring matches the whole globe | `MakeValid()` and winding correction on import                  |
| A 10m simplified copy with a spatial index              | Every screening query runs on it, and the margins assume 10m                  | `geometrySimplified`, `consultee_area_geometry_simplified_sidx` |
| The original geometry                                   | Source of truth                                                               | `geometry`                                                      |
| Features split at a sensible scale                      | A national shape like merged Railway matches everywhere and slows every query | Railway excluded                                                |
| Case boundaries as valid `geography`                    | The site being screened                                                       | `case_boundary.geometry`                                        |

If ids change, `ruleset-golden-cases.json` needs regenerating: it's keyed by today's ids.
