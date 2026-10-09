"""Where CBOS - the IDAS back office, PINS's system of record for cases - keeps its data.

infrastructure/idas-back-office.tf points the Function App at the back office's database and
document storage. Both are reached as the app's managed identity (or, locally, whoever is signed in
to the Azure CLI), so there are no secrets here - only names.
"""

import os
from dataclasses import dataclass

SETTINGS = {
    "database_server": "IDAS_BACK_OFFICE_DATABASE_SERVER",
    "database_name": "IDAS_BACK_OFFICE_DATABASE_NAME",
    "storage_endpoint": "IDAS_BACK_OFFICE_STORAGE_ENDPOINT",
    "storage_container": "IDAS_BACK_OFFICE_STORAGE_CONTAINER_NAME",
}


@dataclass(frozen=True)
class CbosConfig:
    database_server: str
    database_name: str
    storage_endpoint: str
    storage_container: str


class CbosNotConfigured(Exception):
    def __init__(self, missing: list[str]):
        super().__init__(f"missing settings: {', '.join(missing)}")
        self.missing = missing


def cbos_config_from_env() -> CbosConfig:
    values = {field: os.environ.get(setting, "").strip() for field, setting in SETTINGS.items()}
    missing = [SETTINGS[field] for field, value in values.items() if not value]
    if missing:
        raise CbosNotConfigured(missing)
    return CbosConfig(**values)
