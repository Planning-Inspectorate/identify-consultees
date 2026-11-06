# Deployment

Four environments: **Dev**, **Test**, **Training** and **Prod**, in Azure, built by Terraform in `infrastructure/` ([what it deploys](../infrastructure/README.md)).

| Concern              | Local                                      | Azure                                                                                  |
| -------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------- |
| Web app              | `npm start`, port 8090                     | App Service running the `consultees/web` container, with a staging slot (`app-web.tf`) |
| Edge                 | none                                       | Front Door → App Service                                                               |
| Screening            | `func start`, port 7071                    | Function App behind a private endpoint (`app-function.tf`)                             |
| SQL                  | Docker, port 1434                          | Azure SQL                                                                              |
| Reference data files | none                                       | Storage account `data` container (`storage.tf`)                                        |
| Sessions             | In memory                                  | Azure Managed Redis                                                                    |
| Secrets              | `.env`, `local.settings.json` (gitignored) | Key Vault references in app settings                                                   |
| Sign-in              | Usually off                                | Entra ID                                                                               |

Front Door speaks HTTP/2 or later to browsers and HTTP/1.1 to the app. Keep Express `trust proxy` a hop count (`1`), not `true`, and don't add HTTP/3 in Node: turn it on at Front Door.

## Pipelines

Azure DevOps project [identify-consultees](https://dev.azure.com/planninginspectorate/identify-consultees/_build).

| Pipeline                 | File                                                               | When                                                                                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR                       | `.azure/pipelines/pr.yml`                                          | Every PR and `main`: commitlint, lint, types, tests against SQL in a container, Docker smoke test, Python lint and tests                                                                  |
| Build                    | `build.yml`                                                        | After PR passes on `main`: web image and function package                                                                                                                                 |
| Deploy                   | `deploy.yml`                                                       | After Build: migrate, deploy to the staging slot, swap. Dev, then Test, Training and Prod in turn                                                                                         |
| Rollback                 | `rollback.yml`                                                     | By hand                                                                                                                                                                                   |
| Infrastructure CI and CD | `infrastructure/pipelines/terraform-ci*.yaml`, `terraform-cd.yaml` | Plan on PR; plan and apply per environment on merge                                                                                                                                       |
| DB Seed                  | `db-seed.yml`                                                      | By hand: sample data, or the full reference data                                                                                                                                          |
| Promote reference data   | `promote-reference-data.yml`                                       | By hand, or from Training's or Prod's **Reference data files** page: copies a checked quarter's files, Test to Training or Training to Prod (Prod's approval gates it), for loading there |

## Overlapping deploys

Merging to `main` triggers Build and then Deploy on their own, so merges close together start overlapping Deploy runs, and Infrastructure CD can run at the same time. Both deploy into the same Azure DevOps environments (Dev, Test, Training, Prod). Without a lock this went wrong on 9 Oct 2026: an older Deploy swapped Dev's slots after a newer one, leaving Dev a commit behind `main`, and Terraform's app-settings update failed with `409 Conflict` because a slot was mid-swap.

- `deploy.yml` and `infrastructure/pipelines/terraform-cd.yaml` set `lockBehavior: runLatest`: only the newest waiting run takes an environment's lock and older queued runs are cancelled, so the latest commit lands last.
- **It only takes effect once each environment has an "Exclusive lock" check** (Azure DevOps → Pipelines → Environments → the environment → Approvals and checks → Exclusive lock). That's a one-off admin step per environment.
- Until then, don't queue Deploy by hand right after a merge - it already starts on its own - and check Dev's `/health` commit after a burst of merges.

## Database operations without redeploying the app

Schema migrations and data changes for a real environment (Dev/Test/Training/Prod) don't require
shipping app code - two pipelines already handle this independently of `Build`/`Deploy`'s web-app
job:

- **Schema-only migration**: run the `Deploy` pipeline (`.azure/pipelines/deploy.yml`) with
  `deployWeb=false` and `schemaMigration=true` (the default). Its `Migrate` and `Deploy Web` jobs
  are siblings, not dependent on each other, so this applies `npm run migrate-prod` to the target
  environment's real database without touching the running app or its slots at all.
- **Data operations**: `.azure/pipelines/db-seed.yml` (`trigger: none`, manually run via
  `az pipelines run` or the Azure DevOps UI, parameterised by `environment`) is a fully separate
  pipeline for loading data. Its default is the small built-in sample dataset
  (`npm run seed`/`seed-prod`); passing `loadFullReferenceData=true` (Dev/Test/Training only)
  instead runs `npm run import-from-blob` for the two known reference-data blobs
  (`combined_reference_data_v1.geojson`, `all-project-boundaries.geojson`) in the app's storage
  container (`infrastructure/storage.tf`). Imports merge by id and never delete, so add
  `replaceExistingData=true` to clear each table first when the source's ids or areas changed -
  otherwise old rows stay as stale or duplicate consultees. Each table is cleared only once its
  blob has downloaded and parsed with features. The pipeline reads the blobs as its own identity,
  which has Storage Blob Data Contributor on Test's, Training's and Prod's storage accounts, granted
  by hand (Terraform can't: the pipeline identity's role-assignment rights carry an ABAC condition
  that refuses it). Dev's has none, so this route fails there with 403 - use the in-app import.
- **Promoting a checked quarter**: `.azure/pipelines/promote-reference-data.yml` (`trigger: none`,
  parameterised by `route` - Test to Training, or Training to Prod - and an optional `quarter`)
  exports the source's dataset in use - its group files and the rows each loaded - and copies the
  files into the target's blob storage. It loads nothing: each group is loaded on the target's
  `/admin/import-reference-data` page. Training's and Prod's `/admin/upload-to-blob` page starts it
  (the Copy section), as the web app's managed identity, which needs adding to the Azure DevOps
  project with queue and view rights on the pipeline. Case boundaries are never promoted. It needs
  Storage Blob Data Contributor on each environment's `consultees-data` container for the same
  identity. See "Promoting a quarter" in `kt-docs/data/data-model.md`.
- **In-app import**: the same blobs can be imported from the manage app itself at
  `/admin/import-reference-data` (with `/admin/upload-to-blob` for getting files into the
  container) - the app's managed identity has Storage Blob Data Contributor. Consultee areas load a
  group at a time (`config/reference-data.yaml`'s `groups`, one file each) into its quarter's
  table (`consultee_area_2026Q4`); the `consultee_area` synonym points at the newest quarter with
  every group loaded, which everything else uses - and case
  boundaries replace their table. The page shows the rows currently loaded, so a load that
  outlasts Front Door's response timeout can be confirmed by reloading it. See
  `kt-docs/data/data-model.md`.
- **One-off local imports**: `npm run db-import -- --type=<consultee-areas|case-boundaries> --file=<path>`
  works against any `SQL_CONNECTION_STRING` you can reach directly (e.g. from a machine with a
  route to a real environment's database), independently of any pipeline.

The data itself is documented in [Data model and loading](./data/data-model.md).

## What must not go in the repo

- Production data extracts, in git, tickets or Confluence attachments
- Connection strings, client secrets or certificates, in committed `.env` files or anywhere else
- Real personal data in Playwright fixtures or screenshots

The bundled sample dataset (`apps/function-python/setup_database/sample_data`), the Docker SQL password and placeholder session secrets are fine to use.
