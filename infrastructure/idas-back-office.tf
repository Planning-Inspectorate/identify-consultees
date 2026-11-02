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
