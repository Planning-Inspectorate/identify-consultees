# Configuration

Everything that changes **what the service does**, rather than how it does it, lives in this folder. These are the files to edit to change which consultees a ruleset identifies, how far around a site the maps look, and how the maps are coloured. None needs a code change.

| File | Controls | Read by |
| ---- | -------- | ------- |
| [`rulesets/*_ruleset.csv`](./rulesets/) | The rulesets: which consultees each one identifies, and why. One file per sheet of the rulesets workbook (`Rulesets.xlsx`) | `packages/database/src/geospatial/rulesets.ts` |
| [`rulesets/rulesets.yaml`](./rulesets/rulesets.yaml) | Everything about the rulesets that isn't in their CSVs: the default, display names, what each Consultee Type(s) and Logic wording matches, and categories awaiting data | `packages/database/src/geospatial/rulesets.ts` |
| [`reference-data.yaml`](./reference-data.yaml) | Which consultee category each of the reference data's source datasets loads as: `AMB_EW` as Ambulance Trust, and for a dataset holding more than one kind, the category of each subcategory: `OWF_EW`'s export cables as Offshore Wind Export Cable. Plus the five groups the reference data is uploaded and loaded in, a file each. The export's own category is a broad group (Health, Transport...), so the import uses this | `packages/database/src/seed/reference-data.ts` |
| [`nearby-consultees.yaml`](./nearby-consultees.yaml) | How far around a site the maps show consultees the ruleset didn't identify (faint context, not in the report), per category; and how far away another case is a Nearby NSIP (in the report) | `apps/manage/src/app/nearby-consultees.ts` |
| [`report.yaml`](./report.yaml) | Per consultee category: how much its map shows around the site, and which metadata attributes the report's workbook exports (and under what headings); plus the workbook's fixed columns | `apps/manage/src/app/report-config.ts` |
| [`map-view.yaml`](./map-view.yaml) | How much the project boundary page's map shows around the case's shapefiles when it opens | `apps/manage/src/app/maps/map-view.ts` |
| [`map-styles/boundary-map.yaml`](./map-styles/boundary-map.yaml) | The project boundary page's map: the most recent boundary file red, earlier ones blue | `apps/manage/src/app/maps/boundary-map-styles.ts` |
| [`map-styles/consultee-map.example.yaml`](./map-styles/consultee-map.example.yaml) | **Not read yet.** The proposed colours and opacities for the consultee maps, per category and sub-category | Nothing yet: `consultee_area.consulteeSubcategory` now holds the export's sub-category, so the maps can start to use it |

## Changing something

1. Edit the file. Each one explains its settings at the top.
2. Run `npm test`. The app reads every file here when it starts and **refuses to start if a value is invalid**, naming the file and the setting. The tests load the real files, so a mistake fails there first.
3. Open a PR as usual. The change takes effect when it's deployed.

## Rulesets

Each ruleset is one sheet of the rulesets workbook, saved as CSV (UTF-8) in the workbook's own columns: `Group hierarchy, Group, Category, Consultee Type(s), Logic, Buffer (km)`.

| Sheet | File | Shown as |
| ----- | ---- | -------- |
| `ew_aft_30_04_2024` | `england_wales_post_20240430_ruleset.csv` | England Wales post 30 April 2024 (the default) |
| `en_pre_30_04_2024` | `england_pre_20240430_ruleset.csv` | England pre 30 April 2024 |
| `wa_pre_30_04_2024` | `wales_pre_20240430_ruleset.csv` | Wales pre 30 April 2024 |

- **To update a ruleset**, save its sheet over the file. **To add one**, save the sheet as `<name>_ruleset.csv`. That's all: the app offers every `*_ruleset.csv` in the folder.
- **The name users see** comes from the file name: `england_wales_post_20240430` is shown as "England Wales post 30 April 2024". To show something else, give it a name under `names` in [`rulesets.yaml`](./rulesets/rulesets.yaml).
- **A new "Consultee Type(s)" or "Logic" wording** needs adding to `consulteeTypes` or `logic` in `rulesets.yaml`, which map each wording to the reference data's categories or to how it's matched. The app won't start until it's there, and `npm test` names the row.
- **The default ruleset** is `default` in `rulesets.yaml`.
- **The `Group` column decides the tab** a consultee goes on in the downloaded report: Administrative boundaries, Public bodies, Energy, Transport or Other. Any other group lands on Other.

More: [kt-docs/data/screening-engine.md](../kt-docs/data/screening-engine.md#rulesets).

## Category names

The YAML files key settings by consultee category, such as `Parish Council` or `Hospital`. Names must match the reference data's `consultee_area.consulteeCategory` exactly: see [kt-docs/data/reference-data.md](../kt-docs/data/reference-data.md).

## Deployment

The Docker image copies this folder alongside `packages/` (`apps/manage/Dockerfile`), and the code finds it through `CONFIG_DIR` (`packages/database/src/config-dir.ts`). If you move it, update both.
