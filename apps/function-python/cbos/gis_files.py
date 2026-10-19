"""Every file in CBOS's GIS Shapefiles folders, and what each holds - for the admin page that
debugs the boundary import (apps/manage/src/app/admin/cbos-files).

The import (cbos/boundaries.py) only sees the latest GeoJSON version of each document. This lists
every live version - the ZIPs CBOS converted, the ones it couldn't, the ones never sent for
conversion - with the status and blob path CBOS recorded, plus any GeoJSON filed elsewhere, so a
case that's missing from the import can be traced to why.
"""

import io
import json
import zipfile
from dataclasses import dataclass
from datetime import datetime

from cbos.boundaries import GEOJSON_MIME, GIS_SHAPEFILES_FOLDER_NAME, _query, _utc_iso
from cbos.config import CbosConfig

# The documents this module can read: anything in a live GIS Shapefiles folder, and any GeoJSON.
# The content route looks a file up through the same condition, so it can't read anything else.
_GIS_FILES = f"""
SELECT d.guid, dv.version, d.latestVersionId, c.reference, c.title, f.displayNameEn,
    dv.fileName, dv.originalFilename, dv.mime, dv.size, dv.publishedStatus, dv.dateCreated,
    dv.privateBlobContainer, dv.privateBlobPath
FROM Document d
JOIN Folder f ON f.id = d.folderId AND f.deletedAt IS NULL
JOIN DocumentVersion dv ON dv.documentGuid = d.guid AND dv.isDeleted = 0
JOIN [Case] c ON c.id = d.caseId
WHERE d.isDeleted = 0 AND (f.displayNameEn = '{GIS_SHAPEFILES_FOLDER_NAME}' OR dv.mime = '{GEOJSON_MIME}')
"""

LIST_GIS_FILES = _GIS_FILES + "ORDER BY c.reference, d.guid, dv.version"
GET_GIS_DOCUMENT = _GIS_FILES + "AND d.guid = ? ORDER BY dv.version"

COUNT_CASES = f"""
SELECT
    (SELECT COUNT(*) FROM [Case] WHERE reference IS NOT NULL),
    (SELECT COUNT(DISTINCT caseId) FROM Folder WHERE displayNameEn = '{GIS_SHAPEFILES_FOLDER_NAME}' AND deletedAt IS NULL)
"""

# a preview, not the file - a large boundary is tens of megabytes of coordinates
PREVIEW_CHARACTERS = 20_000
# enough to read any shapefile ZIP's listing without holding an outsize upload in memory
MAX_CONTENT_BYTES = 200 * 1024 * 1024


@dataclass(frozen=True)
class GisFile:
    document_guid: str
    version: int
    latest_version: int | None
    case_reference: str | None
    case_title: str | None
    folder: str
    file_name: str | None
    original_file_name: str | None
    mime: str | None
    size: int | None
    published_status: str | None
    created_at: datetime | None
    blob_container: str | None
    blob_path: str | None

    def as_json(self) -> dict:
        return {
            "documentGuid": self.document_guid,
            "version": self.version,
            "latestVersion": self.latest_version,
            "caseReference": self.case_reference,
            "caseTitle": self.case_title,
            "folder": self.folder,
            "fileName": self.file_name,
            "originalFileName": self.original_file_name,
            "mime": self.mime,
            "size": self.size,
            "publishedStatus": self.published_status,
            "createdAt": _utc_iso(self.created_at),
            "blobContainer": self.blob_container,
            "blobPath": self.blob_path,
        }


class GisFileNotFound(Exception):
    pass


def _gis_file(row) -> GisFile:
    return GisFile(str(row[0]).lower(), *row[1:])


def list_gis_files(config: CbosConfig, credential) -> dict:
    files = [_gis_file(row) for row in _query(config, credential, LIST_GIS_FILES)]
    cases, cases_with_gis_folder = _query(config, credential, COUNT_CASES)[0]
    return {
        "casesWithReference": cases,
        "casesWithGisFolder": cases_with_gis_folder,
        "files": [file.as_json() for file in files],
    }


def _describe_geojson(text: str) -> dict:
    try:
        document = json.loads(text)
    except ValueError as error:
        return {"kind": "text", "problem": f"isn't valid JSON: {error}"}
    features = document.get("features") if isinstance(document, dict) else None
    if not isinstance(features, list):
        return {"kind": "json", "type": document.get("type") if isinstance(document, dict) else None}
    geometries = [feature.get("geometry") or {} for feature in features if isinstance(feature, dict)]
    first = features[0] if features and isinstance(features[0], dict) else {}
    return {
        "kind": "geojson",
        "type": document.get("type"),
        "crs": document.get("crs"),
        "featureCount": len(features),
        "geometryTypes": sorted({str(geometry.get("type")) for geometry in geometries}),
        "firstPosition": _first_position(geometries[0].get("coordinates")) if geometries else None,
        "firstFeatureProperties": first.get("properties"),
    }


def _first_position(coordinates):
    # a Point's coordinates are the position; every other type nests them
    while isinstance(coordinates, list) and coordinates and isinstance(coordinates[0], list):
        coordinates = coordinates[0]
    return coordinates if isinstance(coordinates, list) and coordinates else None


def _describe_zip(content: bytes) -> dict:
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            entries = [{"name": entry.filename, "size": entry.file_size} for entry in archive.infolist()]
    except zipfile.BadZipFile as error:
        return {"kind": "binary", "problem": f"isn't a readable ZIP: {error}"}
    return {"kind": "zip", "entries": entries}


def describe_content(content: bytes) -> dict:
    """What a file holds: a GeoJSON summary, a ZIP's listing, or plain text - each with a preview
    of the text where there is some."""
    if content[:4] == b"PK\x03\x04":
        return {"bytes": len(content), **_describe_zip(content)}
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        return {"bytes": len(content), "kind": "binary"}
    stripped = text.lstrip()
    described = _describe_geojson(text) if stripped[:1] in ("{", "[") else {"kind": "text"}
    return {"bytes": len(content), **described, "preview": text[:PREVIEW_CHARACTERS]}


def read_gis_file(config: CbosConfig, credential, document_guid: str, version: int) -> dict:
    """One file's details, its document's other versions, and what its blob holds - or why it
    couldn't be read."""
    versions = [_gis_file(row) for row in _query(config, credential, GET_GIS_DOCUMENT, (document_guid,))]
    file = next((candidate for candidate in versions if candidate.version == version), None)
    if file is None:
        raise GisFileNotFound(f"no GIS file {document_guid} version {version}")
    result = {"file": file.as_json(), "versions": [candidate.as_json() for candidate in versions]}
    if not file.blob_path:
        return {**result, "problem": "CBOS has no blob path for this version"}
    if file.blob_container != config.storage_container:
        # the app can only read the one container it's been granted (infrastructure/idas-back-office.tf)
        return {
            **result,
            "problem": f"it's in container {file.blob_container}, and this app can only read {config.storage_container}",
        }

    from azure.core.exceptions import ResourceNotFoundError
    from azure.storage.blob import ContainerClient

    blob = ContainerClient(
        account_url=config.storage_endpoint, container_name=file.blob_container, credential=credential
    ).get_blob_client(file.blob_path.lstrip("/"))
    try:
        size = blob.get_blob_properties().size
        if size > MAX_CONTENT_BYTES:
            return {**result, "content": {"bytes": size, "kind": "binary", "problem": "too large to read here"}}
        content = blob.download_blob().readall()
    except ResourceNotFoundError:
        return {**result, "problem": f"there's no blob at {file.blob_path} in {file.blob_container}"}
    return {**result, "content": describe_content(content)}
