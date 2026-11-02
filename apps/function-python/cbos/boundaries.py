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
import logging
from dataclasses import dataclass, replace
from datetime import datetime, timezone

from cbos.config import CbosConfig
from cbos.database import connect

logger = logging.getLogger(__name__)

GIS_SHAPEFILES_FOLDER_NAME = "GIS Shapefiles"
GEOJSON_MIME = "application/geo+json"

# Every GeoJSON version of each live document in a live GIS Shapefiles folder, on a case with a
# reference - a replaced boundary's earlier versions too, so a case keeps every boundary it's had.
# A failed conversion adds no GeoJSON version. CBOS's tables are its Prisma model names (Case needs
# brackets).
_BOUNDARY_FILES = f"""
SELECT dv.documentGuid, dv.version, c.reference, c.title, dv.fileName, dv.dateCreated,
    dv.privateBlobContainer, dv.privateBlobPath
FROM DocumentVersion dv
JOIN Document d ON d.guid = dv.documentGuid AND d.isDeleted = 0
JOIN Folder f ON f.id = d.folderId AND f.deletedAt IS NULL AND f.displayNameEn = '{GIS_SHAPEFILES_FOLDER_NAME}'
JOIN [Case] c ON c.id = d.caseId AND c.reference IS NOT NULL
WHERE dv.mime = '{GEOJSON_MIME}' AND dv.isDeleted = 0
"""

LIST_BOUNDARY_FILES = _BOUNDARY_FILES + "ORDER BY c.reference, dv.documentGuid, dv.version"

# Each case's stage now. CBOS keeps a row for every stage a case has been in, the current one
# valid - oldest first, so were two valid the newest wins. Its values are its state machine's
# (pre_application, acceptance, ... post_decision, withdrawn); the manage app labels them.
CASE_STAGES = """
SELECT c.reference, cs.status
FROM [Case] c
JOIN CaseStatus cs ON cs.caseId = c.id AND cs.valid = 1
WHERE c.reference IS NOT NULL
ORDER BY cs.createdAt, cs.id
"""
GET_BOUNDARY_FILE = _BOUNDARY_FILES + "AND dv.documentGuid = ? AND dv.version = ?"


@dataclass(frozen=True)
class BoundaryFile:
    document_guid: str
    version: int
    case_reference: str
    case_title: str | None
    file_name: str | None
    created_at: datetime | None
    case_stage: str | None = None
    """The case's stage now, as CBOS stores it (pre_examination) - not when the file was added."""

    def as_json(self) -> dict:
        return {
            "documentGuid": self.document_guid,
            "version": self.version,
            "caseReference": self.case_reference,
            "caseTitle": self.case_title,
            "fileName": self.file_name,
            "createdAt": _utc_iso(self.created_at),
            "caseStage": self.case_stage,
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
    """Every boundary file, each with its case's stage now (see case_stages)."""
    files = [_boundary_file(row) for row in _query(config, credential, LIST_BOUNDARY_FILES)]
    stages = case_stages(config, credential)
    return [replace(file, case_stage=stages.get(file.case_reference)) for file in files]


def case_stages(config: CbosConfig, credential) -> dict[str, str]:
    """Each case's stage now, by reference. A stage is only shown, so if CBOS's CaseStatus can't be
    read - its database permissions are granted in SQL, outside this repo - the files are listed
    without one rather than not at all."""
    try:
        return {reference: status for reference, status in _query(config, credential, CASE_STAGES)}
    except Exception as error:  # noqa: BLE001 - any failure leaves the stage out, nothing more
        logger.warning("Couldn't read case stages from CBOS: %s", type(error).__name__)
        return {}


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
