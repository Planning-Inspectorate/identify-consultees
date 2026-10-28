# Runbook

What to do when the service misbehaves: the alerts, first checks, secret rotation, and the routine operational tasks. Resource names follow `infrastructure/locals.tf` (`pins-*-consultees-{env}`); environments are Dev, Test, Training and Prod ([Deployment](./deployment.md)).

## Alerts

| Alert               | Defined                                            | Fires when                                                                                              | First response                                                                                                                                                                                       |
| ------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web availability    | `monitoring.tf` → `web_availability`               | The App Insights standard web test (four locations, hits `/`) fails, or the cert has under 30 days left | Check `/health` yourself, then the web app's App Insights failures blade and the App Service. A cert warning means the Front Door custom domain cert needs renewing - that's owned outside this repo |
| Function HTTP 5xx   | `monitoring.tf` → `function_orchestrator_http_5xx` | The Function App returns 5xx five or more times in five minutes                                         | The function's App Insights exceptions. Usually the database being unreachable or a bad deploy - see "Deploys and rollbacks"                                                                         |
| Log cap (Prod only) | `monitoring.tf` → `log_cap`                        | The Log Analytics daily ingestion cap is hit and logging stops                                          | Find the noisy source in App Insights ingestion metrics, or raise `monitoring_config.log_daily_cap` in the environment's tfvars                                                                      |

Alerts email the `consultees-tech` and `consultees-service-manager` action groups (and the shared `iap`/`its`/`info_sec` groups). Receivers are set on the action groups **in the Azure portal** - Terraform ignores `email_receiver` changes on purpose (`monitoring.tf`), so the portal list is the on-call rota. Keep it current.

## Checking health by hand

- **Web app**: `GET https://<host>/health` returns `{"status":"OK","database":"OK|ERROR"}`. It is **always HTTP 200** - a dead database shows up as `"database":"ERROR"` in the body, not a failing status code. No alert watches that field today, so check the body, not just the status.
- **Function app**: private-endpoint only; its `/api/health` has the same shape and is checked from inside the VNet, or read its App Insights.
- Deploys health-check the staging slot's `/health` before swapping, so a broken deploy never reaches the live slot.

## When a journey fails but pages load

- **`run-ruleset` returns 504**: the screening queries timed out. The function logs `run-ruleset: stopped after {timeout}s`; check the site boundary's size and the database tier (`kt-docs/data/screening-issues.md`).
- **Empty consultee lists or maps**: the environment's reference data may not be loaded. `/admin/database` shows row counts; data loads don't need a deploy (`db-seed.yml`, `/admin/import-reference-data`, `/admin/import-from-cbos`).
- **Map images missing**: the static-map fallback fetches upstream tiles at request time; upstream rate-limits or outages show as failed `<img>` while interactive maps still work.

## Rotating secrets

Every runtime secret is a **versionless Key Vault reference** in the app settings (`locals.tf` → `key_vault_refs`), so an app picks up a new secret version on restart - and a staging-slot swap restarts it. Two kinds of secret, two procedures.

### Terraform-generated secrets

`random_password` resources feeding Key Vault (`web_session_secret`, `function_api_key`, the SQL passwords in `database.tf`). **Do not rotate these by hand in the vault**: `value` is not in `ignore_changes`, so the next Terraform apply silently reverts a manual change. Instead replace the password resource through Terraform:

```bash
terraform plan -replace='random_password.web_session_secret'
```

then restart (or redeploy/swap) the apps so the Key Vault references re-resolve, and bump `local.secret_expiration_date` (`locals.tf`) so the vault inventory reflects the new rotation date - the expiry is advisory; Key Vault keeps serving expired secrets.

- **`function-api-key`** (`app-function.tf`) is **shared**: the web app sends it as `PYTHON_FUNCTION_API_KEY` and the function verifies it as `CONSULTEE_AREAS_API_KEY`, failing closed. One apply rotates both sides at once, but any gap between the vault update and the apps restarting shows as screening 401s - do it in a short maintenance window and restart the web app and function together.
- **`web_session_secret`** signs session cookies; rotating it logs every user out. Rotate during low usage.
- **SQL app/admin passwords** are baked into the connection-string secrets (`database.tf`), so the same apply updates both the server-side password and the stored connection string.

### Manually populated secrets

`azurerm_key_vault_secret.manual_secrets` (`main.tf`) - currently just **`consultees-client-secret`**, the Entra app registration's client secret. `value` and `expiration_date` are `ignore_changes`, so rotate it directly in the vault (portal or CLI) whenever the Entra secret is rotated, then restart the web app. Sign-in breaks while the two are out of sync - the failure shows at the token-exchange step of the auth redirect.

## Deploys and rollbacks

- Deploys go through a staging slot then swap (`deploy.yml`, per environment with approvals). Roll back with `.azure/pipelines/rollback.yml`, or redeploy the previous image tag.
- Overlapping deploys are serialised per environment by an Exclusive lock check - see "Overlapping deploys" in [Deployment](./deployment.md).
- Schema migrations run in deploy; reference data loads do not need an app deploy.

## Where to look

- App Insights `pins-ai-consultees-{env}` and Log Analytics `pins-log-consultees-{env}` (30-day retention).
- The web app logs pino JSON on stdout, surfaced as App Insights traces; unhandled errors render generic copy to the user and log the detail (`error-handler.ts`).
- The function app logs to its own App Insights; `run-ruleset` timeouts and upstream failures appear there.
- The `/admin` pages show what is actually in an environment's database.
