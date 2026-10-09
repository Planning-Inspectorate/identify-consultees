resource "azurerm_storage_account" "functions" {
  # checkov:skip=CKV_AZURE_33: "Queue logging is enabled via azurerm_storage_account_queue_properties below - Checkov predates azurerm v4 and only sees the removed inline block"
  # checkov:skip=CKV2_AZURE_40: "Ensure storage account is not configured with Shared Key authorization" - the function app authenticates with storage_account_access_key below
  # checkov:skip=CKV2_AZURE_41: "Ensure storage account is configured with SAS expiration policy"
  # checkov:skip=CKV2_AZURE_1: "Ensure storage for critical data are encrypted with Customer Managed Key"
  # checkov:skip=CKV_AZURE_43: "Ensure Storage Accounts adhere to the naming rules"

  name                             = "pinsstfuncconsultee${local.environment}"
  resource_group_name              = azurerm_resource_group.primary.name
  location                         = module.primary_region.location
  account_tier                     = "Standard"
  account_replication_type         = "GRS"
  allow_nested_items_to_be_public  = false
  cross_tenant_replication_enabled = false
  https_traffic_only_enabled       = true
  min_tls_version                  = "TLS1_2"
  public_network_access_enabled    = false

  blob_properties {
    delete_retention_policy {
      days = 30
    }
    container_delete_retention_policy {
      days = 30
    }
  }

  network_rules {
    default_action = "Deny"
    bypass         = ["AzureServices"]
  }

  tags = local.tags
}

resource "azurerm_storage_account_queue_properties" "functions" {
  storage_account_id = azurerm_storage_account.functions.id

  logging {
    delete                = true
    read                  = true
    write                 = true
    version               = "1.0"
    retention_policy_days = 10
  }
}

# blob + queue request logging to Log Analytics (the Functions runtime uses both)
resource "azurerm_monitor_diagnostic_setting" "functions_storage_blob" {
  name                       = "${local.org}-diag-st-func-blob-${local.resource_suffix}"
  target_resource_id         = "${azurerm_storage_account.functions.id}/blobServices/default"
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id

  enabled_log {
    category = "StorageRead"
  }
  enabled_log {
    category = "StorageWrite"
  }
  enabled_log {
    category = "StorageDelete"
  }
}

resource "azurerm_monitor_diagnostic_setting" "functions_storage_queue" {
  name                       = "${local.org}-diag-st-func-queue-${local.resource_suffix}"
  target_resource_id         = "${azurerm_storage_account.functions.id}/queueServices/default"
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id

  enabled_log {
    category = "StorageRead"
  }
  enabled_log {
    category = "StorageWrite"
  }
  enabled_log {
    category = "StorageDelete"
  }
}

resource "azurerm_private_endpoint" "functions_storage" {
  name                = "${local.org}-pe-st-funcstorage-${local.resource_suffix}"
  location            = module.primary_region.location
  resource_group_name = azurerm_resource_group.primary.name
  subnet_id           = azurerm_subnet.main.id

  private_dns_zone_group {
    name                 = "${local.org}-pdns-${local.service_name}-funcstorage-${var.environment}"
    private_dns_zone_ids = [data.azurerm_private_dns_zone.storage.id]
  }

  private_service_connection {
    name                           = "${local.org}-psc-funcstorage-${local.resource_suffix}"
    private_connection_resource_id = azurerm_storage_account.functions.id
    subresource_names              = ["blob"]
    is_manual_connection           = false
  }

  tags = local.tags
}

# This was the Node "orchestrator" function app, provisioned through the shared
# infrastructure-modules//modules/node-function-app module. apps/function (its Node source) was
# unused boilerplate - never had real functions beyond a placeholder example - so this has been
# repurposed to run apps/function-python instead, rather than provisioning a second Function App.
#
# The shared module hardcodes `application_stack { node_version = ... }` (Azure's application_stack
# block only accepts one runtime, and the module never exposed a Python option - confirmed by
# reading the module's source directly), so this is a plain resource here instead of a module call.
# The `moved` blocks below tell Terraform this is the same underlying Function App/private endpoint
# that used to be tracked under `module.function_orchestrator`, not a new resource.
#
# IMPORTANT: switching an existing Function App's application_stack from Node to Python may or may
# not be an in-place update depending on the AzureRM provider's handling of that change - this has
# not been verified against real state (no Azure credentials available while drafting this). Run
# `terraform plan` and confirm it does not show an unexpected destroy/recreate before applying.
#
# Also note: the shared module provided monitoring/alerting internally (action_group_ids,
# log_analytics_workspace_id, monitoring_alerts_enabled) - replaced by the
# azurerm_monitor_metric_alert.function_orchestrator_http_5xx alert in monitoring.tf.
moved {
  from = module.function_orchestrator.azurerm_linux_function_app.function_app
  to   = azurerm_linux_function_app.function_orchestrator
}

moved {
  from = module.function_orchestrator.azurerm_private_endpoint.private_endpoint[0]
  to   = azurerm_private_endpoint.function_orchestrator
}

resource "azurerm_linux_function_app" "function_orchestrator" {
  # checkov:skip=CKV_AZURE_221: Ensure that Azure Function App public network access is disabled - it is (see public_network_access_enabled below)

  name                          = "pins-func-${local.service_name}-orchestrator-${var.environment}"
  location                      = module.primary_region.location
  resource_group_name           = azurerm_resource_group.primary.name
  service_plan_id               = azurerm_service_plan.apps.id
  storage_account_name          = azurerm_storage_account.functions.name
  storage_account_access_key    = azurerm_storage_account.functions.primary_access_key
  https_only                    = true
  public_network_access_enabled = false

  app_settings = {
    # matches the shared module's own defaults (modules/node-function-app/locals.tf)
    SCM_DO_BUILD_DURING_DEPLOYMENT = false
    WEBSITE_RUN_FROM_PACKAGE       = 1
    SQL_CONNECTION_STRING          = local.key_vault_refs["sql-app-connection-string"]
    # shared secret the consultee-areas data route requires (x-api-key header) - see
    # apps/function-python/function_app.py; the same secret is given to the web app as
    # PYTHON_FUNCTION_API_KEY (infrastructure/app-web.tf)
    CONSULTEE_AREAS_API_KEY = local.key_vault_refs["function-api-key"]

    ## IDAS back office configuration
    IDAS_BACK_OFFICE_DATABASE_SERVER        = data.azurerm_mssql_server.idas_sql.fully_qualified_domain_name
    IDAS_BACK_OFFICE_DATABASE_NAME          = data.azurerm_mssql_database.idas_database.name
    IDAS_BACK_OFFICE_STORAGE_ENDPOINT       = data.azurerm_storage_account.idas_documents.primary_blob_endpoint
    IDAS_BACK_OFFICE_STORAGE_CONTAINER_NAME = data.azurerm_storage_container.idas_documents.name
  }

  identity {
    type = "SystemAssigned"
  }

  site_config {
    always_on     = true
    http2_enabled = true

    application_stack {
      python_version = "3.12"
    }

    application_insights_key = azurerm_application_insights.main.instrumentation_key
  }

  tags = local.tags

  virtual_network_subnet_id = azurerm_subnet.apps.id

  lifecycle {
    ignore_changes = [
      # ignore any changes to "hidden-link" and other tags
      # see https://github.com/hashicorp/terraform-provider-azurerm/issues/16569
      tags
    ]
  }
}

resource "azurerm_private_endpoint" "function_orchestrator" {
  name                = "${local.org}-pe-${local.service_name}-orchestrator-${var.environment}"
  location            = module.primary_region.location
  resource_group_name = azurerm_resource_group.primary.name
  subnet_id           = azurerm_subnet.main.id

  private_dns_zone_group {
    name                 = "appserviceprivatednszone"
    private_dns_zone_ids = [data.azurerm_private_dns_zone.app_service.id]
  }

  private_service_connection {
    name                           = "privateendpointconnection"
    private_connection_resource_id = azurerm_linux_function_app.function_orchestrator.id
    subresource_names              = ["sites"]
    is_manual_connection           = false
  }

  tags = local.tags
}

resource "azurerm_role_assignment" "function_orchestrator_secrets_user" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_linux_function_app.function_orchestrator.identity[0].principal_id
}

# Shared secret for the function app's data route - the route reads database rows and
# returns them, so it must not be anonymously callable even though the Function App is
# only reachable via its private endpoint. See apps/function-python/function_app.py.
resource "random_password" "function_api_key" {
  length  = 32
  special = false
}

resource "azurerm_key_vault_secret" "function_api_key" {
  key_vault_id    = azurerm_key_vault.main.id
  name            = "${local.service_name}-function-api-key"
  value           = random_password.function_api_key.result
  content_type    = "api-key"
  expiration_date = local.secret_expiration_date

  tags = local.tags
}
