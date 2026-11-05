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
2. Run `npm run check-config`. In about a second, it loads every file as the app does and checks the files against each other. It names the file and setting of anything wrong:

   ```
   ✔ config/reference-data.yaml
   ✔ config/rulesets/
   ✔ config/report.yaml
   ✖ config/nearby-consultees.yaml
       nearby-consultees.yaml: categories.Hospitl isn't a consultee category - use a name config/reference-data.yaml's groups list
   ```

3. Run `npm test` before opening a PR. The tests load the real files too.
4. Open a PR. The change takes effect when it's deployed. The app refuses to start with an invalid value, so a mistake can't reach an environment silently.

A setting a file doesn't have, such as a misspelt `nsipRadiusKM`, is refused rather than ignored.

Settings are keyed by consultee category (`Parish Council`, `Hospital`...), which must match `consultee_area.consulteeCategory` exactly. The categories are the ones `reference-data.yaml` loads its datasets as: see [`kt-docs/data/reference-data.md`](../kt-docs/data/reference-data.md).

## Common changes

`npm run check-config` says when one of these steps has been missed.

### Add a reference dataset, or a new consultee category

1. **`reference-data.yaml`**: under `datasets`, add the dataset code and the category it loads as (`HSP_EN: Hospital`). Then add the category to one of the `groups`, which decides its report tab.
2. **`report.yaml`**: under its tab's `categories`, give it a `summary` label for the Summary tab, and any `metadata` columns it exports.
3. **`rulesets/rulesets.yaml`**: if a ruleset row names it, map the row's Consultee Type(s) wording to the category under `consulteeTypes`. If a ruleset already names the category under `categoriesAwaitingData`, take it out.
4. **`nearby-consultees.yaml`**: only if it needs a distance other than `defaultRadiusKm`.
5. After it's deployed, upload and load the group's file on the admin pages (see [Data model and loading](../kt-docs/data/data-model.md)).

### Rename a category

Change the name in every file above that has it, then load the group's file again: the rows already in the database keep the old name until it's reloaded.

### Change a ruleset

Save the sheet over its `<name>_ruleset.csv`, then run `npm run check-config`. A row with a Consultee Type(s) or Logic wording that's new is named, with its file and row. Add the wording to `rulesets.yaml`. See [Rulesets](#rulesets).

### Change the report's columns

In `report.yaml`, change `columns` for the fixed columns (the list is at the top of the file), or `metadata` for the source data's attributes. Set them under `defaults`, a tab or a category: the nearest one wins.

### Change how far the maps look

- Nearby consultees: `defaultRadiusKm`, or a category's distance, in `nearby-consultees.yaml`.
- Nearby NSIPs: `nsipRadiusKm` in `nearby-consultees.yaml`. Also change the NSIPs tab's `mapKm` in `report.yaml`, so its map shows every case found.
- How much each map shows around the site: `mapKm` in `report.yaml`, or `boundaryMapKm` in `map-view.yaml` for the project boundary page.

Larger distances mean a slower search: it reaches out to the largest distance set.

### Change the boundary map's colours

Edit `map-styles/boundary-map.yaml`. Quote colours (`'#ff0000'`), since YAML reads `#` as the start of a comment, and update each style's `description`, which screen readers announce in the map key.

## Rulesets

Each ruleset is a sheet of the rulesets workbook saved as UTF-8 CSV, with the columns `Group hierarchy, Group, Category, Consultee Type(s), Logic, Buffer (km)`.

| Sheet | File | Shown as |
| ----- | ---- | -------- |
| `ew_aft_30_04_2024` | `england_wales_post_20240430_ruleset.csv` | England and Wales (Post 30 April 2024) (default) |
| `en_pre_30_04_2024` | `england_pre_20240430_ruleset.csv` | England (Pre 30 April 2024) |
| `wa_pre_30_04_2024` | `wales_pre_20240430_ruleset.csv` | Wales (Pre 30 April 2024) |

- **To update a ruleset**, save its sheet over its file. **To add one**, save it as `<name>_ruleset.csv`; the app offers every one in the folder.
- **Its name** comes from the file name, unless `names` in `rulesets.yaml` gives another.
- **A new Consultee Type(s) or Logic wording** must be added to `consulteeTypes` or `logic` in `rulesets.yaml`. Until it is, the app won't start, and `npm run check-config` names the file and row.
- **The `Group` column** decides the report tab a consultee goes on: Administrative boundaries, Public bodies, Energy, Transport or Other (anything else goes on Other).

More: [`kt-docs/data/screening-engine.md`](../kt-docs/data/screening-engine.md#rulesets).

The Docker image copies this folder (`apps/manage/Dockerfile`), and the code finds it through `CONFIG_DIR` (`packages/database/src/config-dir.ts`). If you move it, update both.
