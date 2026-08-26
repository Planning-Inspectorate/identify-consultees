alerts_enabled = false

apps_config = {
  app_service_plan = {
    sku                      = "P0v3"
    per_site_scaling_enabled = false
    worker_count             = 1
    zone_balancing_enabled   = false
  }

  auth = {
    client_id                = "bcdf014b-623d-46c5-bc65-32f01353c6ba"
    group_application_access = "bbdea632-70d9-4677-8223-8f55325579d8"
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

  node_environment         = "development"
  private_endpoint_enabled = true
}

common_config = {
  resource_group_name = "pins-rg-common-dev-ukw-001"
  action_group_names = {
    iap      = "pins-ag-odt-iap-dev"
    its      = "pins-ag-odt-its-dev"
    info_sec = "pins-ag-odt-info-sec-dev"
  }
}


environment = "dev"

front_door_config = {
  name        = "pins-fd-common-tooling"
  rg          = "pins-rg-common-tooling"
  ep_name     = "pins-fde-applications"
  use_tooling = true
}

monitoring_config = {
  app_insights_web_test_enabled = false
  log_daily_cap                 = 0.1
}

sql_config = {
  admin = {
    login_username = "pins-consultees-sql-dev"
    object_id      = "8cba2d98-000c-440b-8e54-5ef4ff231520"
  }
  sku_name    = "Basic"
  max_size_gb = 2
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
  address_space                       = "10.38.0.0/22"
  apps_subnet_address_space           = "10.38.0.0/24"
  main_subnet_address_space           = "10.38.1.0/24"
  secondary_address_space             = "10.38.16.0/22"
  secondary_apps_subnet_address_space = "10.38.16.0/24"
  secondary_subnet_address_space      = "10.38.17.0/24"
}

waf_rate_limits = {
  enabled             = true
  duration_in_minutes = 5
  threshold           = 1500
}

web_domains = {
  web = "consultees-dev.planninginspectorate.gov.uk"
}