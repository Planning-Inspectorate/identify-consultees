import io
import json
import zipfile
from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest
from azure.core.exceptions import ResourceNotFoundError

from cbos.config import CbosConfig
from cbos.gis_files import (
    COUNT_CASES,
    GET_GIS_DOCUMENT,
    LIST_GIS_FILES,
    MAX_CONTENT_BYTES,
    PREVIEW_CHARACTERS,
    GisFileNotFound,
    describe_content,
    list_gis_files,
    read_gis_file,
)

CONFIG = CbosConfig("sql.example.net", "back-office", "https://docs.example.net/", "document-service-uploads")
CREDENTIAL = object()
GUID = "0f8fad5b-d9cb-469f-a165-70867728950e"
CREATED = datetime(2026, 5, 1, 9, 30)


def _row(version=1, mime="application/zip", container="document-service-uploads", path="/application/EN010001/doc/v1"):
    return (
        GUID.upper(),
        version,
        2,
        "EN010001",
        "Example Solar Farm",
        "GIS Shapefiles",
        "site",
        "site.zip",
        mime,
        1234,
        "not_checked",
        CREATED,
        container,
        path,
    )


def _fake_connect(*results):
    connection = MagicMock()
    connection.cursor.return_value.fetchall.side_effect = list(results)
    return patch("cbos.boundaries.connect", return_value=connection), connection


def _zip(*names: str) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name in names:
            archive.writestr(name, "x" * 10)
    return buffer.getvalue()


def test_the_query_reads_every_live_version_in_gis_shapefiles_folders_and_any_geojson():
    for sql in (LIST_GIS_FILES, GET_GIS_DOCUMENT):
        assert "f.displayNameEn = 'GIS Shapefiles' OR dv.mime = 'application/geo+json'" in sql
        assert "d.isDeleted = 0" in sql and "dv.isDeleted = 0" in sql and "f.deletedAt IS NULL" in sql
    assert GET_GIS_DOCUMENT.endswith("AND d.guid = ? ORDER BY dv.version")
    assert "displayNameEn = 'GIS Shapefiles'" in COUNT_CASES


def test_list_gis_files_returns_every_version_with_the_case_counts():
    patcher, connection = _fake_connect([_row(1), _row(2, "application/geo+json")], [(300, 250)])
    with patcher:
        listing = list_gis_files(CONFIG, CREDENTIAL)

    assert connection.cursor.return_value.execute.call_args_list[0].args == (LIST_GIS_FILES, ())
    assert listing["casesWithReference"] == 300
    assert listing["casesWithGisFolder"] == 250
    assert [file["version"] for file in listing["files"]] == [1, 2]
    assert listing["files"][0] == {
        "documentGuid": GUID,
        "version": 1,
        "latestVersion": 2,
        "caseReference": "EN010001",
        "caseTitle": "Example Solar Farm",
        "folder": "GIS Shapefiles",
        "fileName": "site",
        "originalFileName": "site.zip",
        "mime": "application/zip",
        "size": 1234,
        "publishedStatus": "not_checked",
        "createdAt": "2026-05-01T09:30:00+00:00",
        "blobContainer": "document-service-uploads",
        "blobPath": "/application/EN010001/doc/v1",
    }


def test_describe_content_lists_a_zips_files():
    assert describe_content(_zip("site.shp", "site.dbf", "site.shx")) == {
        "bytes": len(_zip("site.shp", "site.dbf", "site.shx")),
        "kind": "zip",
        "entries": [{"name": "site.shp", "size": 10}, {"name": "site.dbf", "size": 10}, {"name": "site.shx", "size": 10}],
    }


def test_describe_content_reports_a_zip_it_cant_read():
    described = describe_content(b"PK\x03\x04 truncated")
    assert described["kind"] == "binary"
    assert "isn't a readable ZIP" in described["problem"]


def test_describe_content_summarises_geojson_with_a_preview():
    collection = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [[[-1.5, 52.1], [-1.4, 52.1], [-1.5, 52.2]]]},
                "properties": {"caseReference": "EN010001"},
            },
            {"type": "Feature", "geometry": {"type": "Point", "coordinates": [450000, 210000]}, "properties": {}},
            {"type": "Feature", "geometry": None, "properties": {}},
        ],
    }
    text = json.dumps(collection)
    described = describe_content(("﻿" + text).encode())

    assert described == {
        "bytes": len(("﻿" + text).encode()),
        "kind": "geojson",
        "type": "FeatureCollection",
        "crs": None,
        "featureCount": 3,
        "geometryTypes": ["None", "Point", "Polygon"],
        "firstPosition": [-1.5, 52.1],
        "firstFeatureProperties": {"caseReference": "EN010001"},
        "preview": text,
    }


def test_describe_content_handles_json_that_isnt_a_feature_collection_and_text_that_isnt_json():
    assert describe_content(b'{"type": "Feature"}')["kind"] == "json"
    assert describe_content(b"[1, 2]") == {"bytes": 6, "kind": "json", "type": None, "preview": "[1, 2]"}
    broken = describe_content(b'{"type": ')
    assert broken["kind"] == "text" and "isn't valid JSON" in broken["problem"]
    assert describe_content(b"hello")["kind"] == "text"
    assert describe_content(b"\xff\xfe\x00")["kind"] == "binary"


def test_describe_content_previews_only_the_start_of_a_large_file():
    assert len(describe_content(b"x" * (PREVIEW_CHARACTERS + 10))["preview"]) == PREVIEW_CHARACTERS


def test_describe_content_finds_no_first_position_without_coordinates():
    described = describe_content(b'{"type": "FeatureCollection", "features": [{"geometry": {"type": "Polygon"}}, 5]}')
    assert described["firstPosition"] is None
    assert described["firstFeatureProperties"] is None


def _fake_blob(content: bytes = b"", size: int | None = None, missing: bool = False):
    container = MagicMock()
    blob = container.get_blob_client.return_value
    if missing:
        blob.get_blob_properties.side_effect = ResourceNotFoundError("gone")
    blob.get_blob_properties.return_value.size = len(content) if size is None else size
    blob.download_blob.return_value.readall.return_value = content
    return patch("azure.storage.blob.ContainerClient", return_value=container), container


def test_read_gis_file_describes_the_blob_cbos_names_with_the_documents_versions():
    db_patcher, connection = _fake_connect([_row(), _row(2, "application/geo+json")])
    blob_patcher, container = _fake_blob(_zip("site.shp"))
    with db_patcher, blob_patcher as container_client:
        result = read_gis_file(CONFIG, CREDENTIAL, GUID, 1)

    connection.cursor.return_value.execute.assert_called_once_with(GET_GIS_DOCUMENT, (GUID,))
    assert [version["version"] for version in result["versions"]] == [1, 2]
    assert container_client.call_args.kwargs["container_name"] == "document-service-uploads"
    container.get_blob_client.assert_called_once_with("application/EN010001/doc/v1")
    assert result["file"]["fileName"] == "site"
    assert result["content"]["entries"] == [{"name": "site.shp", "size": 10}]


@pytest.mark.parametrize("rows", [[], [_row()]])
def test_read_gis_file_raises_not_found_for_an_unknown_document_or_version(rows):
    patcher, _ = _fake_connect(rows)
    with patcher, pytest.raises(GisFileNotFound):
        read_gis_file(CONFIG, CREDENTIAL, GUID, 9)


@pytest.mark.parametrize(
    ("row", "problem"),
    [
        (_row(path=None), "CBOS has no blob path for this version"),
        (
            _row(container="published-documents"),
            "it's in container published-documents, and this app can only read document-service-uploads",
        ),
    ],
)
def test_read_gis_file_says_why_it_cant_read_a_blob(row, problem):
    patcher, _ = _fake_connect([row])
    with patcher:
        result = read_gis_file(CONFIG, CREDENTIAL, GUID, 1)

    assert result["problem"] == problem
    assert "content" not in result


def test_read_gis_file_reports_a_missing_blob():
    db_patcher, _ = _fake_connect([_row()])
    blob_patcher, _ = _fake_blob(missing=True)
    with db_patcher, blob_patcher:
        result = read_gis_file(CONFIG, CREDENTIAL, GUID, 1)

    assert result["problem"] == "there's no blob at /application/EN010001/doc/v1 in document-service-uploads"


def test_read_gis_file_doesnt_download_an_outsize_blob():
    db_patcher, _ = _fake_connect([_row()])
    blob_patcher, container = _fake_blob(size=MAX_CONTENT_BYTES + 1)
    with db_patcher, blob_patcher:
        result = read_gis_file(CONFIG, CREDENTIAL, GUID, 1)

    assert result["content"] == {"bytes": MAX_CONTENT_BYTES + 1, "kind": "binary", "problem": "too large to read here"}
    container.get_blob_client.return_value.download_blob.assert_not_called()
