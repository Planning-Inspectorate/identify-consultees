apps_config = {
  app_service_plan = {
    sku                      = "P0v3"
    per_site_scaling_enabled = false
    worker_count             = 1
    zone_balancing_enabled   = false
  }

  auth = {
    client_id                = "d24224b1-e3e2-4403-9227-44f638089fd8"
    group_application_access = "c55e6329-8dfb-44c9-84f5-01ba2aca31ff"
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
  resource_group_name = "pins-rg-common-test-ukw-001"
  action_group_names = {
    iap      = "pins-ag-odt-iap-test"
    its      = "pins-ag-odt-its-test"
    info_sec = "pins-ag-odt-info-sec-test"
  }
}


environment = "test"

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
    login_username = "pins-consultees-sql-test"
    object_id      = "2eb9c9e0-1a42-4372-beba-c1816e35bfab"
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
  address_space                       = "10.38.4.0/22"
  apps_subnet_address_space           = "10.38.4.0/24"
  main_subnet_address_space           = "10.38.5.0/24"
  secondary_address_space             = "10.38.20.0/22"
  secondary_apps_subnet_address_space = "10.38.20.0/24"
  secondary_subnet_address_space      = "10.38.21.0/24"
}

waf_rate_limits = {
  enabled             = true
  duration_in_minutes = 5
  threshold           = 1500
}

web_domains = {
  web = "consultees-test.planninginspectorate.gov.uk"
}