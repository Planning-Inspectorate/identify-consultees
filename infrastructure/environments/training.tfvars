apps_config = {
  app_service_plan = {
    sku                      = "P0v3"
    per_site_scaling_enabled = false
    worker_count             = 1
    zone_balancing_enabled   = false
  }

  auth = {
    client_id                = "ec7ac3e2-72ed-4180-9341-797ce7fd2819"
    group_application_access = "1af42b0f-f33d-41a2-8a21-f71589132bb7"
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
  resource_group_name = "pins-rg-common-training-ukw-001"
  action_group_names = {
    iap      = "pins-ag-odt-iap-training"
    its      = "pins-ag-odt-its-training"
    info_sec = "pins-ag-odt-info-sec-training"
  }
}


environment = "training"

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
    login_username = "pins-consultees-sql-training"
    object_id      = "5373ca0b-f5d2-4935-ad2b-2ca5ea9fe50d"
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
  address_space                       = "10.38.8.0/22"
  apps_subnet_address_space           = "10.38.8.0/24"
  main_subnet_address_space           = "10.38.9.0/24"
  secondary_address_space             = "10.38.24.0/22"
  secondary_apps_subnet_address_space = "10.38.24.0/24"
  secondary_subnet_address_space      = "10.38.25.0/24"
}

waf_rate_limits = {
  enabled             = true
  duration_in_minutes = 5
  threshold           = 1500
}

web_domains = {
  web = "consultees-training.planninginspectorate.gov.uk"
}