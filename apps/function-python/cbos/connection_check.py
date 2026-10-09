"""Prove the Function App can reach CBOS's database and document storage as its own identity.

Each check reports what happened rather than raising, so one failing doesn't hide the other. The
results carry no case data: a row count of SELECT 1, and how many blob names a first listing saw.
"""

from dataclasses import dataclass

from cbos.config import CbosConfig

# enough to prove the listing works without walking a container that holds every CBOS upload
BLOB_SAMPLE_SIZE = 5
LOGIN_TIMEOUT_SECONDS = 15


@dataclass(frozen=True)
class CheckResult:
    ok: bool
    detail: str

    def as_json(self) -> dict:
        return {"status": "OK" if self.ok else "ERROR", "detail": self.detail}


def default_credential():
    # imported here so the rest of the app (and its tests) don't need azure-identity loaded
    from azure.identity import DefaultAzureCredential

    return DefaultAzureCredential()


def _describe(error: Exception) -> str:
    # the first line is enough to tell "no access" from "can't reach it"; drivers append pages
    message = str(error).strip().splitlines()[0] if str(error).strip() else ""
    return f"{type(error).__name__}: {message}"[:300]


def check_database(config: CbosConfig, credential) -> CheckResult:
    try:
        # mssql-python bundles its own ODBC driver and takes an azure-identity credential, which
        # pymssql (used for our own database) can't - so CBOS gets its own driver
        import mssql_python

        connection = mssql_python.connect(
            f"Server={config.database_server};Database={config.database_name};Encrypt=yes",
            token_provider=credential,
            timeout=LOGIN_TIMEOUT_SECONDS,
        )
        try:
            cursor = connection.cursor()
            cursor.execute("SELECT 1")
            cursor.fetchone()
        finally:
            connection.close()
    except Exception as error:  # noqa: BLE001 - every failure is a result to report
        return CheckResult(False, _describe(error))
    return CheckResult(True, f"connected to {config.database_name}")


def check_storage(config: CbosConfig, credential) -> CheckResult:
    try:
        from azure.storage.blob import ContainerClient

        container = ContainerClient(
            account_url=config.storage_endpoint,
            container_name=config.storage_container,
            credential=credential,
        )
        first_page = next(container.list_blob_names(results_per_page=BLOB_SAMPLE_SIZE).by_page(), [])
        listed = len(list(first_page))
    except Exception as error:  # noqa: BLE001 - every failure is a result to report
        return CheckResult(False, _describe(error))
    return CheckResult(True, f"listed {listed} blob name(s) in {config.storage_container}")


def check_cbos(config: CbosConfig, credential) -> dict:
    database = check_database(config, credential)
    storage = check_storage(config, credential)
    return {
        "status": "OK" if database.ok and storage.ok else "ERROR",
        "database": database.as_json(),
        "storage": storage.as_json(),
    }
