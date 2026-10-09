import sys
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from cbos.config import CbosConfig, CbosNotConfigured, cbos_config_from_env
from cbos.connection_check import check_cbos, check_database, check_storage

SETTINGS = {
    "IDAS_BACK_OFFICE_DATABASE_SERVER": "sql.example.net",
    "IDAS_BACK_OFFICE_DATABASE_NAME": "back-office",
    "IDAS_BACK_OFFICE_STORAGE_ENDPOINT": "https://docs.example.net/",
    "IDAS_BACK_OFFICE_STORAGE_CONTAINER_NAME": "document-service-uploads",
}
CONFIG = CbosConfig("sql.example.net", "back-office", "https://docs.example.net/", "document-service-uploads")
CREDENTIAL = object()


def test_config_reads_every_setting():
    with patch.dict("os.environ", SETTINGS, clear=True):
        assert cbos_config_from_env() == CONFIG


def test_config_names_every_missing_setting():
    with (
        patch.dict("os.environ", {"IDAS_BACK_OFFICE_DATABASE_SERVER": "sql.example.net"}, clear=True),
        pytest.raises(CbosNotConfigured) as raised,
    ):
        cbos_config_from_env()

    assert raised.value.missing == [
        "IDAS_BACK_OFFICE_DATABASE_NAME",
        "IDAS_BACK_OFFICE_STORAGE_ENDPOINT",
        "IDAS_BACK_OFFICE_STORAGE_CONTAINER_NAME",
    ]


def _fake_mssql(connect):
    return patch.dict(sys.modules, {"mssql_python": SimpleNamespace(connect=connect)})


def test_database_check_runs_a_query_as_the_given_identity_and_closes_the_connection():
    connection = MagicMock()
    connect = MagicMock(return_value=connection)
    with _fake_mssql(connect):
        result = check_database(CONFIG, CREDENTIAL)

    assert result.ok
    connection_string = connect.call_args.args[0]
    assert "Server=sql.example.net" in connection_string
    assert "Database=back-office" in connection_string
    assert connect.call_args.kwargs["token_provider"] is CREDENTIAL
    connection.cursor.return_value.execute.assert_called_once_with("SELECT 1")
    connection.close.assert_called_once()


def test_database_check_reports_a_failure_without_raising():
    connect = MagicMock(side_effect=RuntimeError("Login failed for user '<token-identified principal>'.\nmore"))
    with _fake_mssql(connect):
        result = check_database(CONFIG, CREDENTIAL)

    assert not result.ok
    assert result.detail == "RuntimeError: Login failed for user '<token-identified principal>'."


def _fake_container(names=None, error=None):
    container = MagicMock()
    if error:
        container.list_blob_names.side_effect = error
    else:
        container.list_blob_names.return_value.by_page.return_value = iter([iter(names)])
    return patch("azure.storage.blob.ContainerClient", return_value=container), container


def test_storage_check_counts_one_page_of_names():
    patcher, container = _fake_container(names=["a", "b"])
    with patcher as container_client:
        result = check_storage(CONFIG, CREDENTIAL)

    assert result.ok
    assert result.detail == "listed 2 blob name(s) in document-service-uploads"
    assert container_client.call_args.kwargs == {
        "account_url": "https://docs.example.net/",
        "container_name": "document-service-uploads",
        "credential": CREDENTIAL,
    }
    assert container.list_blob_names.call_args.kwargs == {"results_per_page": 5}


def test_storage_check_reports_a_failure_without_raising():
    patcher, _ = _fake_container(error=PermissionError("AuthorizationPermissionMismatch"))
    with patcher:
        result = check_storage(CONFIG, CREDENTIAL)

    assert not result.ok
    assert result.detail == "PermissionError: AuthorizationPermissionMismatch"


def test_check_cbos_reports_each_part_and_fails_if_either_does():
    connect = MagicMock(side_effect=TimeoutError("timed out"))
    patcher, _ = _fake_container(names=["a"])
    with _fake_mssql(connect), patcher:
        result = check_cbos(CONFIG, CREDENTIAL)

    assert result == {
        "status": "ERROR",
        "database": {"status": "ERROR", "detail": "TimeoutError: timed out"},
        "storage": {"status": "OK", "detail": "listed 1 blob name(s) in document-service-uploads"},
    }
