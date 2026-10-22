# Configuration

What the service does, as opposed to how: which consultees each ruleset identifies, how far around a site it looks, what the report shows and how the maps look. None of it needs a code change.

| File | Sets |
| ---- | ---- |
| [`rulesets/*_ruleset.csv`](./rulesets/) | The rulesets, one per sheet of the rulesets workbook |
| [`rulesets/rulesets.yaml`](./rulesets/rulesets.yaml) | The rest of the rulesets: the default, display names, what each Consultee Type(s) and Logic wording matches, and categories awaiting data |
| [`reference-data.yaml`](./reference-data.yaml) | The category each reference dataset loads as (for example `AMB_EW` as Ambulance Trust), and the five groups the data is uploaded and loaded in |
| [`screening.yaml`](./screening.yaml) | How detailed a site's outline can be before it's screened against its bounding box instead |
| [`nearby-consultees.yaml`](./nearby-consultees.yaml) | How far around a site the maps show consultees the ruleset didn't identify, per category; and how far away another case counts as a Nearby NSIP |
| [`report.yaml`](./report.yaml) | Each report tab's columns, the metadata each category adds, and how much each category's map shows |
| [`map-view.yaml`](./map-view.yaml) | How much the boundary page's map shows around the case's shapefiles |
| [`map-styles/boundary-map.yaml`](./map-styles/boundary-map.yaml) | The boundary page's map colours: the newest file red, earlier ones blue |
| [`map-styles/consultee-map.example.yaml`](./map-styles/consultee-map.example.yaml) | **Not read yet**: proposed consultee map colours per category and sub-category |

Each file explains its settings at the top.

## Changing a setting

1. Edit the file.
2. Run `npm test`. The app refuses to start with an invalid value, naming the file and setting, and the tests load the real files, so mistakes fail there first.
3. Open a PR. The change takes effect when it's deployed.

Settings are keyed by consultee category (`Parish Council`, `Hospital`...), which must match `consultee_area.consulteeCategory` exactly: see [`kt-docs/data/reference-data.md`](../kt-docs/data/reference-data.md).

## Rulesets

Each ruleset is a sheet of the rulesets workbook saved as UTF-8 CSV, with the columns `Group hierarchy, Group, Category, Consultee Type(s), Logic, Buffer (km)`.

| Sheet | File | Shown as |
| ----- | ---- | -------- |
| `ew_aft_30_04_2024` | `england_wales_post_20240430_ruleset.csv` | England Wales post 30 April 2024 (default) |
| `en_pre_30_04_2024` | `england_pre_20240430_ruleset.csv` | England pre 30 April 2024 |
| `wa_pre_30_04_2024` | `wales_pre_20240430_ruleset.csv` | Wales pre 30 April 2024 |

- **To update a ruleset**, save its sheet over its file. **To add one**, save it as `<name>_ruleset.csv`; the app offers every one in the folder.
- **Its name** comes from the file name, unless `names` in `rulesets.yaml` gives another.
- **A new Consultee Type(s) or Logic wording** must be added to `consulteeTypes` or `logic` in `rulesets.yaml`. Until it is, the app won't start, and `npm test` names the row.
- **The `Group` column** decides the report tab a consultee goes on: Administrative boundaries, Public bodies, Energy, Transport or Other (anything else goes on Other).

More: [`kt-docs/data/screening-engine.md`](../kt-docs/data/screening-engine.md#rulesets).

The Docker image copies this folder (`apps/manage/Dockerfile`), and the code finds it through `CONFIG_DIR` (`packages/database/src/config-dir.ts`). If you move it, update both.
