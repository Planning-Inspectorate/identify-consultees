"""Connections to CBOS's database, as the app's own identity."""

from cbos.config import CbosConfig

LOGIN_TIMEOUT_SECONDS = 15


def connect(config: CbosConfig, credential):
    # mssql-python bundles its own ODBC driver and takes an azure-identity credential, which
    # pymssql (used for our own database) can't - so CBOS gets its own driver. Imported here so
    # the rest of the app, and its tests, don't load it
    import mssql_python

    return mssql_python.connect(
        f"Server={config.database_server};Database={config.database_name};Encrypt=yes",
        token_provider=credential,
        timeout=LOGIN_TIMEOUT_SECONDS,
    )
