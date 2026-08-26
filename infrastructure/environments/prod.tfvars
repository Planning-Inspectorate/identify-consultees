apps_config = {
  app_service_plan = {
    sku                      = "P1v3"
    per_site_scaling_enabled = false
    worker_count             = 1
    zone_balancing_enabled   = false
  }

  auth = {
    client_id                = "e7e0f029-4600-4292-9d98-c920c289f0b8"
    group_application_access = "6aed478e-1da5-475f-ba7f-31dc89aeb305"
    # groups = {
    #   inspectors    = ""
    #   team_leads    = ""
    #   national_team = ""
    #   api_inspector_groups = []
    # }
  }

  functions_node_version = 22

  logging = {
    level = "info"
  }

  managed_redis = {
    sku_name                  = "Balanced_B0"
    high_availability_enabled = false
    rdb_backup_frequency      = null
  }

  node_environment         = "production"
  private_endpoint_enabled = true
}

common_config = {
  resource_group_name = "pins-rg-common-prod-ukw-001"
  action_group_names = {
    iap      = "pins-ag-odt-iap-prod"
    its      = "pins-ag-odt-its-prod"
    info_sec = "pins-ag-odt-info-sec-prod"
  }
}

environment = "prod"

front_door_config = {
  name        = "pins-fd-common-prod"
  rg          = "pins-rg-common-prod"
  ep_name     = "pins-fde-applications-prod"
  use_tooling = false
}

monitoring_config = {
  app_insights_web_test_enabled = true
  log_daily_cap                 = 0.5
}

sql_config = {
  admin = {
    login_username = "pins-consultees-sql-prod"
    object_id      = "c6573a18-8982-43b2-b389-f9ef35d64b72"
  }
  sku_name    = "S0"
  max_size_gb = 100
  retention = {
    audit_days             = 7
    short_term_days        = 7
    long_term_weekly       = "P1W"
    long_term_monthly      = "P1M"
    long_term_yearly       = "P1Y"
    long_term_week_of_year = 1
  }
}

vnet_config = {
  address_space                       = "10.38.12.0/22"
  apps_subnet_address_space           = "10.38.12.0/24"
  main_subnet_address_space           = "10.38.13.0/24"
  secondary_address_space             = "10.38.28.0/22"
  secondary_apps_subnet_address_space = "10.38.28.0/24"
  secondary_subnet_address_space      = "10.38.29.0/24"
}

waf_rate_limits = {
  enabled             = true
  duration_in_minutes = 5
  threshold           = 1500
}

web_domains = {
  web = "identify-consultees.planninginspectorate.gov.uk"
}