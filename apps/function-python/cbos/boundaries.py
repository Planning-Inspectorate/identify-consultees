"""Case boundaries from CBOS (the IDAS back office).

A case officer uploads a project's boundary as a shapefile ZIP to the case's "GIS Shapefiles"
folder. CBOS's own process-shapefile job converts it to a WGS84 GeoJSON FeatureCollection, stores
it next to the ZIP in its document storage, and records it as the document's next version (mime
application/geo+json). Every feature carries caseReference, projectName, fileName and receivedDate
- the properties our case_boundary import already reads. So we read CBOS's GeoJSON rather than
parse shapefiles ourselves.

See Planning-Inspectorate/back-office: apps/functions/applications-background-jobs/process-shapefile
and apps/api/src/server/applications/application/documents/shapefile-processing.service.js.
"""

import json
from dataclasses import dataclass
from datetime import datetime, timezone

from cbos.config import CbosConfig
from cbos.database import connect

GIS_SHAPEFILES_FOLDER_NAME = "GIS Shapefiles"
GEOJSON_MIME = "application/geo+json"

# The latest GeoJSON version of each live document in a live GIS Shapefiles folder, on a case with
# a reference. A failed conversion of a newer ZIP adds no GeoJSON version, so this keeps the last
# good boundary rather than none. CBOS's tables are its Prisma model names (Case needs brackets).
_BOUNDARY_FILES = f"""
WITH geojson_versions AS (
    SELECT dv.documentGuid, dv.version, dv.fileName, dv.dateCreated,
        dv.privateBlobContainer, dv.privateBlobPath,
        ROW_NUMBER() OVER (PARTITION BY dv.documentGuid ORDER BY dv.version DESC) AS newest
    FROM DocumentVersion dv
    WHERE dv.mime = '{GEOJSON_MIME}' AND dv.isDeleted = 0
)
SELECT g.documentGuid, g.version, c.reference, c.title, g.fileName, g.dateCreated,
    g.privateBlobContainer, g.privateBlobPath
FROM geojson_versions g
JOIN Document d ON d.guid = g.documentGuid AND d.isDeleted = 0
JOIN Folder f ON f.id = d.folderId AND f.deletedAt IS NULL AND f.displayNameEn = '{GIS_SHAPEFILES_FOLDER_NAME}'
JOIN [Case] c ON c.id = d.caseId AND c.reference IS NOT NULL
WHERE g.newest = 1
"""

LIST_BOUNDARY_FILES = _BOUNDARY_FILES + "ORDER BY c.reference, g.documentGuid"
GET_BOUNDARY_FILE = _BOUNDARY_FILES + "AND g.documentGuid = ? AND g.version = ?"


@dataclass(frozen=True)
class BoundaryFile:
    document_guid: str
    version: int
    case_reference: str
    case_title: str | None
    file_name: str | None
    created_at: datetime | None

    def as_json(self) -> dict:
        return {
            "documentGuid": self.document_guid,
            "version": self.version,
            "caseReference": self.case_reference,
            "caseTitle": self.case_title,
            "fileName": self.file_name,
            "createdAt": _utc_iso(self.created_at),
        }


def _utc_iso(value: datetime | None) -> str | None:
    # CBOS stores UTC (Prisma's default), and SQL Server returns it without a zone - say so, or
    # JavaScript reads the bare timestamp as local time
    if value is None:
        return None
    return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).isoformat()


class BoundaryFileNotFound(Exception):
    pass


def _boundary_file(row) -> BoundaryFile:
    return BoundaryFile(
        document_guid=str(row[0]).lower(),
        version=row[1],
        case_reference=row[2],
        case_title=row[3],
        file_name=row[4],
        created_at=row[5],
    )


def _query(config: CbosConfig, credential, sql: str, params: tuple = ()) -> list:
    connection = connect(config, credential)
    try:
        cursor = connection.cursor()
        cursor.execute(sql, params)
        return cursor.fetchall()
    finally:
        connection.close()


def list_boundary_files(config: CbosConfig, credential) -> list[BoundaryFile]:
    return [_boundary_file(row) for row in _query(config, credential, LIST_BOUNDARY_FILES)]


def fetch_boundary_geojson(config: CbosConfig, credential, document_guid: str, version: int) -> dict:
    """The GeoJSON FeatureCollection CBOS made for one boundary file. The blob path comes from
    CBOS's database, never the caller, so this can only read boundary files."""
    rows = _query(config, credential, GET_BOUNDARY_FILE, (document_guid, version))
    if not rows:
        raise BoundaryFileNotFound(f"no boundary file {document_guid} version {version}")
    container, path = rows[0][6], rows[0][7]
    if container != config.storage_container or not path:
        # the app can only read the one container it's been granted (infrastructure/idas-back-office.tf)
        raise BoundaryFileNotFound(f"boundary file {document_guid} version {version} isn't in {config.storage_container}")

    from azure.storage.blob import ContainerClient

    blob = ContainerClient(
        account_url=config.storage_endpoint, container_name=container, credential=credential
    ).get_blob_client(path.lstrip("/"))
    collection = json.loads(blob.download_blob().readall())
    if not isinstance(collection, dict) or collection.get("type") != "FeatureCollection":
        raise ValueError(f"boundary file {document_guid} version {version} isn't a GeoJSON FeatureCollection")
    return collection
