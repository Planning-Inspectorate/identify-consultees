import json
from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest

from cbos.boundaries import (
    CASE_STAGES,
    GET_BOUNDARY_FILE,
    LIST_BOUNDARY_FILES,
    BoundaryFile,
    BoundaryFileNotFound,
    fetch_boundary_geojson,
    list_boundary_files,
)
from cbos.config import CbosConfig

CONFIG = CbosConfig("sql.example.net", "back-office", "https://docs.example.net/", "document-service-uploads")
CREDENTIAL = object()
GUID = "0f8fad5b-d9cb-469f-a165-70867728950e"
# naive, as SQL Server returns it
CREATED = datetime(2026, 5, 1, 9, 30)


def _row(container="document-service-uploads", path="/application/EN010001/doc/v2/site.geojson"):
    return (GUID.upper(), 2, "EN010001", "Example Solar Farm", "site.geojson", CREATED, container, path)


def _fake_connect(rows):
    connection = MagicMock()
    connection.cursor.return_value.fetchall.return_value = rows
    return patch("cbos.boundaries.connect", return_value=connection), connection


def test_the_query_reads_every_geojson_version_in_gis_shapefiles_folders():
    for sql in (LIST_BOUNDARY_FILES, GET_BOUNDARY_FILE):
        assert "dv.mime = 'application/geo+json'" in sql
        assert "f.displayNameEn = 'GIS Shapefiles'" in sql
        # every version, not just the newest - a replaced boundary's earlier ones too
        assert "newest" not in sql and "ROW_NUMBER" not in sql
        assert "d.isDeleted = 0" in sql and "dv.isDeleted = 0" in sql and "f.deletedAt IS NULL" in sql


def _fake_listing(stages):
    """A CBOS whose boundary file query returns one row, and whose stage query returns `stages` -
    or raises it, if it's an exception."""
    connection = MagicMock()
    cursor = connection.cursor.return_value
    results = []

    def execute(sql, params):
        if sql == CASE_STAGES and isinstance(stages, Exception):
            raise stages
        results.append(stages if sql == CASE_STAGES else [_row()])

    cursor.execute.side_effect = execute
    cursor.fetchall.side_effect = lambda: results.pop(0)
    return patch("cbos.boundaries.connect", return_value=connection), connection


def test_list_boundary_files_maps_rows_with_each_cases_stage_and_closes_the_connection():
    patcher, connection = _fake_listing([("EN010001", "pre_application"), ("EN010001", "acceptance")])
    with patcher as connect:
        files = list_boundary_files(CONFIG, CREDENTIAL)

    connect.assert_called_with(CONFIG, CREDENTIAL)
    executed = [call.args[0] for call in connection.cursor.return_value.execute.call_args_list]
    assert executed == [LIST_BOUNDARY_FILES, CASE_STAGES]
    assert connection.close.call_count == 2
    # the stage query is oldest first - were two rows valid, the newest wins
    assert files == [BoundaryFile(GUID, 2, "EN010001", "Example Solar Farm", "site.geojson", CREATED, "acceptance")]
    assert files[0].as_json() == {
        "documentGuid": GUID,
        "version": 2,
        "caseReference": "EN010001",
        "caseTitle": "Example Solar Farm",
        "fileName": "site.geojson",
        "createdAt": "2026-05-01T09:30:00+00:00",
        "caseStage": "acceptance",
    }


def test_list_boundary_files_lists_without_stages_when_cbos_case_status_cant_be_read(caplog):
    patcher, _ = _fake_listing(PermissionError("The SELECT permission was denied on the object 'CaseStatus'"))
    with patcher:
        files = list_boundary_files(CONFIG, CREDENTIAL)

    assert [file.case_stage for file in files] == [None]
    assert files[0].as_json()["caseStage"] is None
    assert "Couldn't read case stages from CBOS: PermissionError" in caplog.text


def test_the_stage_query_reads_each_cases_current_stage():
    assert "cs.valid = 1" in CASE_STAGES
    assert "ORDER BY cs.createdAt" in CASE_STAGES


def test_boundary_file_json_keeps_an_explicit_zone_and_allows_a_missing_date():
    aware = datetime(2026, 5, 1, 10, 30, tzinfo=UTC)
    assert BoundaryFile(GUID, 1, "EN010001", None, None, aware).as_json()["createdAt"] == "2026-05-01T10:30:00+00:00"
    assert BoundaryFile(GUID, 1, "EN010001", None, None, None).as_json()["createdAt"] is None


def _fake_blob(content: bytes):
    container = MagicMock()
    container.get_blob_client.return_value.download_blob.return_value.readall.return_value = content
    return patch("azure.storage.blob.ContainerClient", return_value=container), container


def test_fetch_boundary_geojson_downloads_the_path_from_cbos():
    collection = {"type": "FeatureCollection", "features": []}
    db_patcher, connection = _fake_connect([_row()])
    blob_patcher, container = _fake_blob(json.dumps(collection).encode())
    with db_patcher, blob_patcher as container_client:
        assert fetch_boundary_geojson(CONFIG, CREDENTIAL, GUID, 2) == collection

    connection.cursor.return_value.execute.assert_called_once_with(GET_BOUNDARY_FILE, (GUID, 2))
    assert container_client.call_args.kwargs == {
        "account_url": "https://docs.example.net/",
        "container_name": "document-service-uploads",
        "credential": CREDENTIAL,
    }
    container.get_blob_client.assert_called_once_with("application/EN010001/doc/v2/site.geojson")


def test_fetch_boundary_geojson_raises_not_found_for_an_unknown_file():
    patcher, _ = _fake_connect([])
    with patcher, pytest.raises(BoundaryFileNotFound):
        fetch_boundary_geojson(CONFIG, CREDENTIAL, GUID, 9)


@pytest.mark.parametrize("row", [_row(container="another-container"), _row(path=None)])
def test_fetch_boundary_geojson_refuses_a_file_outside_the_granted_container(row):
    patcher, _ = _fake_connect([row])
    with patcher, pytest.raises(BoundaryFileNotFound):
        fetch_boundary_geojson(CONFIG, CREDENTIAL, GUID, 2)


def test_fetch_boundary_geojson_rejects_content_that_isnt_a_feature_collection():
    db_patcher, _ = _fake_connect([_row()])
    blob_patcher, _ = _fake_blob(b'{"type": "Feature"}')
    with db_patcher, blob_patcher, pytest.raises(ValueError):
        fetch_boundary_geojson(CONFIG, CREDENTIAL, GUID, 2)
