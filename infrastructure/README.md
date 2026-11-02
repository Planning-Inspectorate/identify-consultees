# Infrastructure

Terraform for the service's Azure resources, in four environments: **Dev**, **Test**, **Training** and **Prod**. What differs between them is in `environments/*.tfvars`; values shared by all are in `terraform.tfvars`.

| File | Resources |
| ---- | --------- |
| `app-service-plan.tf` | The App Service plan the apps run on |
| `app-web.tf` | The web app (`apps/manage`, the `consultees/web` image) with its staging slot and session secret |
| `app-function.tf` | The Python Function App (`apps/function-python`) behind a private endpoint, and its `x-api-key` secret in Key Vault |
| `idas-back-office.tf` | Read access to CBOS (the IDAS back office): its database's settings, `Storage Blob Data Reader` on its document container, and the VNet peering. Its database permissions are granted in SQL, not here |
| `database.tf`, `database-secondary.tf` | Azure SQL server and database, and the secondary region where configured |
| `storage.tf` | The reference data storage account and its `data` container, for uploads and imports |
| `app-managed-redis.tf` | Azure Managed Redis for the web app's sessions |
| `front-door.tf` | Azure Front Door and its firewall, in front of the web app |
| `networking.tf`, `networking-secondary.tf` | VNets, subnets and private endpoints |
| `monitoring.tf`, `database-monitoring.tf` | Application Insights, Log Analytics and alerts |

## Pipelines

- **Infrastructure** (`pipelines/`): `terraform-ci.yaml` and `terraform-ci-commit.yaml` check PRs, and `terraform-cd.yaml` plans and applies.
- **Application** (`.azure/pipelines/`): build, deploy, rollback and data seed. Schema migrations and reference data loads run separately from app deploys: see "Database operations without redeploying the app" in [`AGENTS.md`](../AGENTS.md).
