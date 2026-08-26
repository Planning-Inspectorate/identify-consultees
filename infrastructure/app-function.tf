resource "azurerm_storage_account" "functions" {
  #checkov:skip=CKV_AZURE_33: Logging not implemented yet
  #checkov:skip=CKV_AZURE_43: "Ensure Storage Accounts adhere to the naming rules"
  #checkov:skip=CKV_AZURE_206: "Ensure that Storage Accounts use replication"
  #checkov:skip=CKV2_AZURE_1: Customer Managed Keys not implemented yet
  #checkov:skip=CKV2_AZURE_8: Logging not implemented yet
  #checkov:skip=CKV2_AZURE_18: Customer Managed Keys not implemented yet
  #checkov:skip=CKV2_AZURE_38: "Ensure soft-delete is enabled on Azure storage account"
  #checkov:skip=CKV2_AZURE_40: "Ensure storage account is not configured with Shared Key authorization"
  #checkov:skip=CKV2_AZURE_41: "Ensure storage account is configured with SAS expiration policy"
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

  network_rules {
    default_action = "Deny"
    bypass         = ["AzureServices"]
  }

  tags = local.tags
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

module "function_orchestrator" {
  #checkov:skip=CKV_TF_1: Use of commit hash are not required for our Terraform modules
  source = "github.com/Planning-Inspectorate/infrastructure-modules.git//modules/node-function-app?ref=1.56"

  resource_group_name = azurerm_resource_group.primary.name
  location            = module.primary_region.location

  # naming
  app_name        = "orchestrator"
  resource_suffix = var.environment
  service_name    = local.service_name
  tags            = local.tags

  # service plan
  app_service_plan_id = azurerm_service_plan.apps.id

  # storage
  function_apps_storage_account            = azurerm_storage_account.functions.name
  function_apps_storage_account_access_key = azurerm_storage_account.functions.primary_access_key

  # networking
  integration_subnet_id      = azurerm_subnet.apps.id
  outbound_vnet_connectivity = true
  inbound_vnet_connectivity  = true
  private_endpoint = {
    private_dns_zone_id = data.azurerm_private_dns_zone.app_service.id
    subnet_id           = azurerm_subnet.main.id
  }

  # monitoring
  action_group_ids            = local.action_group_ids
  app_insights_instrument_key = azurerm_application_insights.main.instrumentation_key
  log_analytics_workspace_id  = azurerm_log_analytics_workspace.main.id
  monitoring_alerts_enabled   = var.alerts_enabled

  # settings
  function_node_version = var.apps_config.functions_node_version
  app_settings = {
    NODE_ENV              = var.apps_config.node_environment
    SQL_CONNECTION_STRING = local.key_vault_refs["sql-app-connection-string"]
  }
}


resource "azurerm_role_assignment" "function_orchestrator_secrets_user" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = module.function_orchestrator.principal_id
}