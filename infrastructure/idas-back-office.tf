# Connections to the IDAS back-office system for shapefile and other data

data "azurerm_resource_group" "idas_back_office" {
  name = "pins-rg-back-office-${var.environment}-ukw-001"
}

# IDAS resources are in the common VNET
data "azurerm_resource_group" "common" {
  name = "pins-rg-common-${var.environment}-ukw-001"
}
data "azurerm_virtual_network" "common" {
  resource_group_name = data.azurerm_resource_group.common.name
  name                = "pins-vnet-common-${var.environment}-ukw-001"
}

data "azurerm_storage_account" "idas_documents" {
  resource_group_name = data.azurerm_resource_group.idas_back_office.name
  name                = var.environment == "training" ? "pinsstdocsbotrainingukw" : "pinsstdocsbo${var.environment}ukw001"
}

data "azurerm_storage_container" "idas_documents" {
  name               = "document-service-uploads"
  storage_account_id = data.azurerm_storage_account.idas_documents.id
}

data "azurerm_mssql_server" "idas_sql" {
  resource_group_name = data.azurerm_resource_group.idas_back_office.name
  name                = "pins-sql-back-office-${var.environment}-ukw-001"
}

# database permissions are handled in SQL
data "azurerm_mssql_database" "idas_database" {
  name      = "pins-sqldb-back-office-${var.environment}-ukw-001"
  server_id = data.azurerm_mssql_server.idas_sql.id
}

# grant the function app permission to read documents
resource "azurerm_role_assignment" "function_idas_documents_read" {
  principal_id         = azurerm_linux_function_app.function_orchestrator.identity[0].principal_id
  scope                = data.azurerm_storage_container.idas_documents.id
  role_definition_name = "Storage Blob Data Reader"
}

# peer the VNETs
resource "azurerm_virtual_network_peering" "consultees_to_idas" {
  name                      = "${local.org}-peer-${local.service_name}-to-idas-${var.environment}"
  remote_virtual_network_id = data.azurerm_virtual_network.common.id
  resource_group_name       = azurerm_virtual_network.main.resource_group_name
  virtual_network_name      = azurerm_virtual_network.main.name
}

resource "azurerm_virtual_network_peering" "idas_to_consultees" {
  name                      = "${local.org}-peer-idas-to-${local.service_name}-${var.environment}"
  remote_virtual_network_id = azurerm_virtual_network.main.id
  resource_group_name       = data.azurerm_resource_group.common.name
  virtual_network_name      = data.azurerm_virtual_network.common.name
}

# CBOS's Service Bus. Its nsip-document topic says when a document changes - including when CBOS
# converts a case's shapefile ZIP to GeoJSON. The web app subscribes, and imports that case's
# boundaries (apps/manage/src/app/cbos/subscriber.ts). Off until cbos_subscriber_enabled.
data "azurerm_servicebus_namespace" "idas" {
  count               = var.cbos_subscriber_enabled ? 1 : 0
  name                = "pins-sb-back-office-${var.environment}-ukw-001"
  resource_group_name = data.azurerm_resource_group.idas_back_office.name
}

data "azurerm_servicebus_topic" "idas_nsip_document" {
  count        = var.cbos_subscriber_enabled ? 1 : 0
  name         = "nsip-document"
  namespace_id = data.azurerm_servicebus_namespace.idas[0].id
}

resource "azurerm_servicebus_subscription" "web_nsip_document" {
  count = var.cbos_subscriber_enabled ? 1 : 0

  name     = "identify-consultees-nsip-document"
  topic_id = data.azurerm_servicebus_topic.idas_nsip_document[0].id
  # an import that fails (the function down, say) is tried again, then dead-lettered
  max_delivery_count                   = 5
  default_message_ttl                  = "P7D"
  dead_lettering_on_message_expiration = true
}

# only Create and Update events - a converted boundary is an Update - not Delete, Publish or
# Unpublish. The web app ignores every event but a GIS shapefile's GeoJSON, so a $Default rule,
# should one be left on the subscription, only lets more through for it to ignore
resource "azurerm_servicebus_subscription_rule" "web_nsip_document_changes" {
  count = var.cbos_subscriber_enabled ? 1 : 0

  name            = "create-and-update"
  subscription_id = azurerm_servicebus_subscription.web_nsip_document[0].id
  filter_type     = "SqlFilter"
  sql_filter      = "type IN ('Create', 'Update')"
}

# the live web app only - the staging slot has the subscriber off (app-web.tf)
resource "azurerm_role_assignment" "web_nsip_document_receiver" {
  count = var.cbos_subscriber_enabled ? 1 : 0

  scope                = azurerm_servicebus_subscription.web_nsip_document[0].id
  role_definition_name = "Azure Service Bus Data Receiver"
  principal_id         = module.app_web.principal_id
}
