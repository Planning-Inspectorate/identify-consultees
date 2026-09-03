resource "azurerm_service_plan" "apps" {

  name                = "${local.org}-asp-${local.resource_suffix}"
  resource_group_name = azurerm_resource_group.primary.name
  location            = module.primary_region.location

  os_type                  = "Linux"
  sku_name                 = var.apps_config.app_service_plan.sku
  per_site_scaling_enabled = var.apps_config.app_service_plan.per_site_scaling_enabled
  worker_count             = var.apps_config.app_service_plan.worker_count
  zone_balancing_enabled   = var.apps_config.app_service_plan.zone_balancing_enabled

  tags = local.tags
}
