# Infrastructure

This folder contains the infrastructure-as-code (using Terraform) for this project.

## What it deploys

| File | Resources |
| ---- | --------- |
| `app-web.tf` | App Service running the `consultees/web` container image (`apps/manage`), staging slot, session secret, managed Redis access |
| `app-function.tf` | Python Function App (`apps/function-python`) behind a private endpoint, plus the `x-api-key` shared secret in Key Vault |
| `database.tf` / `database-secondary.tf` | Azure SQL Server + database (+ secondary region/failover where configured) |
| `front-door.tf` | Azure Front Door profile/endpoints in front of the web app |
| `storage.tf` | Reference-data storage account + `data` container (blob upload/import for seeding real environments) |
| `app-managed-redis.tf` | Azure Managed Redis used for manage-app sessions (`MANAGED_REDIS_URL`) |
| `networking.tf` / `networking-secondary.tf` | VNets, subnets, private endpoints |
| `monitoring.tf` / `database-monitoring.tf` | App Insights / Log Analytics / alerts |

## Pipelines

There are two pipelines, one for static checks during PR (`terraform-ci.yaml` / `terraform-ci-commit.yaml`), and one to plan and apply the infrastructure (`terraform-cd.yaml`). These are based on common-pipeline-templates and live in `pipelines/`.

Application pipelines (build/deploy the manage image, DB schema migration, data seed) live separately under `.azure/pipelines/` — see the "Database operations" section of the root `AGENTS.md` for how schema migrations and reference-data loads run independently of app deploys.

## Environments

Four environments exist — **Dev**, **Test**, **Training**, **Prod** — with differences managed through simple tfvars files in the `environments` folder.

## Common Variables

Variables with common values across environments are set in the `terraform.tfvars` file, which Terraform looks for automatically.

<https://developer.hashicorp.com/terraform/language/values/variables#variable-definitions-tfvars-files>
