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

| Pipeline                 | File                                                               | When                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| PR                       | `.azure/pipelines/pr.yml`                                          | Every PR and `main`: commitlint, lint, types, tests against SQL in a container, Docker smoke test, Python lint and tests |
| Build                    | `build.yml`                                                        | After PR passes on `main`: web image and function package                                                                |
| Deploy                   | `deploy.yml`                                                       | After Build: migrate, deploy to the staging slot, swap. Dev, then Test, Training and Prod in turn                        |
| Rollback                 | `rollback.yml`                                                     | By hand                                                                                                                  |
| Infrastructure CI and CD | `infrastructure/pipelines/terraform-ci*.yaml`, `terraform-cd.yaml` | Plan on PR; plan and apply per environment on merge                                                                      |
| DB Seed                  | `db-seed.yml`                                                      | By hand: sample data, or the full reference data                                                                         |

Merges close together start overlapping Deploy and Infrastructure CD runs. Both use `lockBehavior: runLatest`, which works once each environment has an Exclusive lock check. See "Overlapping deploys" in [AGENTS.md](../AGENTS.md). After a burst of merges, check the commit on Dev's `/health`.

## Data without a deploy

Schema migrations (`deploy.yml` with `deployWeb=false`) and data loads (DB Seed, or the in-app `/admin/import-reference-data`) don't need an app deploy. The steps and their current limits are in "Database operations without redeploying the app" in [AGENTS.md](../AGENTS.md), and the data itself in [Data model and loading](./data/data-model.md).

## What must not go in the repo

- Production data extracts, in git, tickets or Confluence attachments
- Connection strings, client secrets or certificates, in committed `.env` files or anywhere else
- Real personal data in Playwright fixtures or screenshots

The bundled sample dataset (`apps/function-python/setup_database/sample_data`), the Docker SQL password and placeholder session secrets are fine to use.
