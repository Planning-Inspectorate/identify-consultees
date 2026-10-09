
resource "azurerm_storage_account" "sql_server" {
  # checkov:skip=CKV_AZURE_33: "Queue logging is enabled via azurerm_storage_account_queue_properties below - Checkov predates azurerm v4 and only sees the removed inline block"
  # checkov:skip=CKV2_AZURE_40: "Ensure storage account is not configured with Shared Key authorization" - the SQL security alert policy below authenticates with the account access key
  # checkov:skip=CKV2_AZURE_41: "Ensure storage account is configured with SAS expiration policy"
  # checkov:skip=CKV2_AZURE_1: "Ensure storage for critical data are encrypted with Customer Managed Key"
  # checkov:skip=CKV_AZURE_43: "Ensure Storage Accounts adhere to the naming rules"

  name                             = "pinsstsqlconsultee${local.environment}"
  resource_group_name              = azurerm_resource_group.primary.name
  location                         = module.primary_region.location
  account_tier                     = "Standard"
  account_replication_type         = "GRS"
  min_tls_version                  = "TLS1_2"
  https_traffic_only_enabled       = true
  allow_nested_items_to_be_public  = false
  cross_tenant_replication_enabled = false
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

  identity {
    type = "SystemAssigned"
  }

  tags = local.tags
}

resource "azurerm_storage_account_queue_properties" "sql_server" {
  storage_account_id = azurerm_storage_account.sql_server.id

  logging {
    delete                = true
    read                  = true
    write                 = true
    version               = "1.0"
    retention_policy_days = 10
  }
}

# blob request logging to Log Analytics - this account holds SQL audit and
# vulnerability-assessment output, so access to it is worth auditing itself
resource "azurerm_monitor_diagnostic_setting" "sql_server_storage_blob" {
  name                       = "${local.org}-diag-st-sql-blob-${local.resource_suffix}"
  target_resource_id         = "${azurerm_storage_account.sql_server.id}/blobServices/default"
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

resource "azurerm_private_endpoint" "sql_storage" {
  name                = "${local.org}-pe-st-sql-${local.resource_suffix}"
  location            = module.primary_region.location
  resource_group_name = azurerm_resource_group.primary.name
  subnet_id           = azurerm_subnet.main.id

  private_dns_zone_group {
    name                 = "${local.org}-pdns-${local.service_name}-storage-${var.environment}"
    private_dns_zone_ids = [data.azurerm_private_dns_zone.storage.id]
  }

  private_service_connection {
    name                           = "${local.org}-psc-storage-${local.resource_suffix}"
    private_connection_resource_id = azurerm_storage_account.sql_server.id
    subresource_names              = ["blob"]
    is_manual_connection           = false
  }

  tags = local.tags
}

resource "azurerm_storage_container" "sql_server" {
  # checkov:skip=CKV2_AZURE_21: "Blob read logging is on via azurerm_monitor_diagnostic_setting.sql_server_storage_blob - Checkov only recognises the legacy azurerm_log_analytics_storage_insights resource"
  name                  = "sqlvulnerabilityassessment"
  storage_account_id    = azurerm_storage_account.sql_server.id
  container_access_type = "private"
}

resource "azurerm_role_assignment" "sql_server_storage" {
  scope                = azurerm_storage_account.sql_server.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_mssql_server.primary.identity[0].principal_id
}

resource "azurerm_mssql_server_extended_auditing_policy" "sql_server" {
  enabled                = true
  blob_storage_endpoint  = azurerm_storage_account.sql_server.primary_blob_endpoint
  server_id              = azurerm_mssql_server.primary.id
  retention_in_days      = var.sql_config.retention.audit_days
  log_monitoring_enabled = false

  depends_on = [
    azurerm_role_assignment.sql_server_storage,
    azurerm_storage_account.sql_server,
  ]
}

# the secondary SQL server (when enabled) writes audit logs to the same storage account -
# auditing is on the server, not the database, so a failover partner needs its own policy
resource "azurerm_role_assignment" "sql_server_storage_secondary" {
  count = var.secondary_region_enabled ? 1 : 0

  scope                = azurerm_storage_account.sql_server.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_mssql_server.secondary[0].identity[0].principal_id
}

resource "azurerm_mssql_server_extended_auditing_policy" "sql_server_secondary" {
  count = var.secondary_region_enabled ? 1 : 0

  enabled                = true
  blob_storage_endpoint  = azurerm_storage_account.sql_server.primary_blob_endpoint
  server_id              = azurerm_mssql_server.secondary[0].id
  retention_in_days      = var.sql_config.retention.audit_days
  log_monitoring_enabled = false

  depends_on = [
    azurerm_role_assignment.sql_server_storage_secondary,
    azurerm_storage_account.sql_server,
  ]
}

resource "azurerm_mssql_server_security_alert_policy" "sql_server" {
  #checkov:skip=CKV_AZURE_27: "Ensure that 'Email service and co-administrators' is 'Enabled' for MSSQL servers"
  state                        = var.alerts_enabled ? "Enabled" : "Disabled"
  resource_group_name          = azurerm_resource_group.primary.name
  server_name                  = azurerm_mssql_server.primary.name
  storage_endpoint             = azurerm_storage_account.sql_server.primary_blob_endpoint
  storage_account_access_key   = azurerm_storage_account.sql_server.primary_access_key
  retention_days               = var.sql_config.retention.audit_days
  email_account_admins_enabled = true
  email_addresses              = local.tech_emails
}

resource "azurerm_mssql_server_vulnerability_assessment" "consultees_sql_server" {
  count = var.alerts_enabled ? 1 : 0

  #checkov:skip=CKV2_AZURE_3: "Recurring scans are configured below (enabled = var.alerts_enabled) - Checkov can't resolve the variable"
  #checkov:skip=CKV2_AZURE_4: "Scan reports go to local.tech_emails below - Checkov can't resolve the local"
  #checkov:skip=CKV2_AZURE_5: "email_subscription_admins is set below - Checkov can't see it inside the recurring_scans block"

  server_security_alert_policy_id = azurerm_mssql_server_security_alert_policy.sql_server.id
  storage_container_path          = "${azurerm_storage_account.sql_server.primary_blob_endpoint}${azurerm_storage_container.sql_server.name}/"

  recurring_scans {
    enabled                   = var.alerts_enabled
    email_subscription_admins = true
    emails                    = local.tech_emails
  }
}

# Metric Alerts
resource "azurerm_monitor_metric_alert" "sql_db_cpu_alert" {
  name                = "${local.service_name} SQL CPU Alert ${local.resource_suffix}"
  resource_group_name = azurerm_resource_group.primary.name
  scopes              = [azurerm_mssql_database.primary.id]
  description         = "Action will be triggered when cpu percent is greater than 80."
  window_size         = "PT5M"
  frequency           = "PT1M"
  severity            = 2
  enabled             = var.alerts_enabled

  criteria {
    metric_namespace = "Microsoft.Sql/servers/databases"
    metric_name      = "cpu_percent"
    aggregation      = "Average"
    operator         = "GreaterThan"
    threshold        = 80
  }

  action {
    action_group_id = azurerm_monitor_action_group.consultees_tech.id
  }

  tags = local.tags
}

resource "azurerm_monitor_metric_alert" "sql_db_dtu_alert" {
  name                = "${local.service_name} SQL DTU Alert ${local.resource_suffix}"
  resource_group_name = azurerm_resource_group.primary.name
  scopes              = [azurerm_mssql_database.primary.id]
  description         = "Action will be triggered when DTU percent is greater than 80."
  window_size         = "PT5M"
  frequency           = "PT1M"
  severity            = 2
  enabled             = var.alerts_enabled

  criteria {
    metric_namespace = "Microsoft.Sql/servers/databases"
    metric_name      = "dtu_consumption_percent"
    aggregation      = "Average"
    operator         = "GreaterThan"
    threshold        = 80
  }

  action {
    action_group_id = azurerm_monitor_action_group.consultees_tech.id
  }

  tags = local.tags
}

resource "azurerm_monitor_metric_alert" "sql_db_log_io_alert" {
  name                = "${local.service_name} SQL Log IO Alert ${local.resource_suffix}"
  resource_group_name = azurerm_resource_group.primary.name
  scopes              = [azurerm_mssql_database.primary.id]
  description         = "Action will be triggered when Log write percent is greater than 80."
  window_size         = "PT5M"
  frequency           = "PT1M"
  severity            = 2
  enabled             = var.alerts_enabled

  criteria {
    metric_namespace = "Microsoft.Sql/servers/databases"
    metric_name      = "log_write_percent"
    aggregation      = "Average"
    operator         = "GreaterThan"
    threshold        = 80
  }

  action {
    action_group_id = azurerm_monitor_action_group.consultees_tech.id
  }

  tags = local.tags
}

resource "azurerm_monitor_metric_alert" "sql_db_deadlock_alert" {
  name                = "${local.service_name} SQL Deadlock Alert ${local.resource_suffix}"
  resource_group_name = azurerm_resource_group.primary.name
  scopes              = [azurerm_mssql_database.primary.id]
  description         = "Action will be triggered whenever the count of deadlocks is greater than 1."
  window_size         = "PT5M"
  frequency           = "PT1M"
  severity            = 2
  enabled             = var.alerts_enabled

  criteria {
    metric_namespace = "Microsoft.Sql/servers/databases"
    metric_name      = "deadlock"
    aggregation      = "Count"
    operator         = "GreaterThanOrEqual"
    threshold        = 1
  }

  action {
    action_group_id = azurerm_monitor_action_group.consultees_tech.id
  }

  tags = local.tags
}
