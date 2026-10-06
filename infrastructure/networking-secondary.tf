
resource "azurerm_virtual_network" "secondary" {
  count = var.secondary_region_enabled ? 1 : 0

  name                = "${local.org}-vnet-${local.secondary_resource_suffix}"
  location            = module.secondary_region.location
  resource_group_name = azurerm_resource_group.secondary[0].name
  address_space       = [var.vnet_config.secondary_address_space]

  tags = var.tags
}

resource "azurerm_subnet" "secondary_apps" {
  count = var.secondary_region_enabled ? 1 : 0

  name                              = "${local.org}-snet-${local.service_name}-apps-secondary-${var.environment}"
  resource_group_name               = azurerm_resource_group.secondary[0].name
  virtual_network_name              = azurerm_virtual_network.secondary[0].name
  address_prefixes                  = [var.vnet_config.secondary_apps_subnet_address_space]
  private_endpoint_network_policies = "Enabled"

  # for app services
  delegation {
    name = "delegation"

    service_delegation {
      name = "Microsoft.Web/serverFarms"
      actions = [
        "Microsoft.Network/virtualNetworks/subnets/action"
      ]
    }
  }
}

resource "azurerm_subnet" "secondary" {
  count = var.secondary_region_enabled ? 1 : 0

  name                              = "${local.org}-snet-${local.secondary_resource_suffix}"
  resource_group_name               = azurerm_resource_group.secondary[0].name
  virtual_network_name              = azurerm_virtual_network.secondary[0].name
  address_prefixes                  = [var.vnet_config.secondary_subnet_address_space]
  private_endpoint_network_policies = "Enabled"
}

resource "azurerm_virtual_network_peering" "secondary_consultees_to_tooling" {
  count = var.secondary_region_enabled ? 1 : 0

  name                      = "${local.org}-peer-${local.service_name}-secondary-to-tooling-${var.environment}"
  remote_virtual_network_id = data.azurerm_virtual_network.tooling.id
  resource_group_name       = azurerm_virtual_network.secondary[0].resource_group_name
  virtual_network_name      = azurerm_virtual_network.secondary[0].name
}

resource "azurerm_virtual_network_peering" "secondary_tooling_to_consultees" {
  count = var.secondary_region_enabled ? 1 : 0

  name                      = "${local.org}-peer-tooling-to-${local.secondary_resource_suffix}"
  remote_virtual_network_id = azurerm_virtual_network.secondary[0].id
  resource_group_name       = var.tooling_config.network_rg
  virtual_network_name      = var.tooling_config.network_name

  provider = azurerm.tooling
}

## DNS Zones for Azure Services
## Private DNS Zones exist in the tooling subscription and are shared here
resource "azurerm_private_dns_zone_virtual_network_link" "secondary_database" {
  count = var.secondary_region_enabled ? 1 : 0

  name                = "${local.org}-vnetlink-db-${local.secondary_resource_suffix}"
  private_dns_zone_id = data.azurerm_private_dns_zone.database.id
  virtual_network_id  = azurerm_virtual_network.secondary[0].id

  provider = azurerm.tooling
}

moved {
  from = azurerm_virtual_network.secondary
  to   = azurerm_virtual_network.secondary[0]
}

moved {
  from = azurerm_subnet.secondary_apps
  to   = azurerm_subnet.secondary_apps[0]
}

moved {
  from = azurerm_subnet.secondary
  to   = azurerm_subnet.secondary[0]
}

moved {
  from = azurerm_virtual_network_peering.secondary_consultees_to_tooling
  to   = azurerm_virtual_network_peering.secondary_consultees_to_tooling[0]
}

moved {
  from = azurerm_virtual_network_peering.secondary_tooling_to_consultees
  to   = azurerm_virtual_network_peering.secondary_tooling_to_consultees[0]
}

moved {
  from = azurerm_private_dns_zone_virtual_network_link.secondary_database
  to   = azurerm_private_dns_zone_virtual_network_link.secondary_database[0]
}
