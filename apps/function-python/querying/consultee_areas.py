"""Runs a real SQL query against the consultee_area table (see
packages/database/src/schema.prisma) from Python, proving the Python function
can talk to the same database as the rest of this project.
"""

import pymssql

from setup_database.db import ConnectionParams

# the geometry column can't come back as-is over pymssql - it's converted to
# WKT text with STAsText(), the same pattern the Node data-access layer uses
# (see packages/database/src/geospatial)
_SELECT_COLUMNS = """
    id, geometryType, consulteeCategory, consultee, region, caseReference,
    currentVersion, metadata, lastUpdated, geometry.STAsText() AS geometryWkt
"""


def fetch_consultee_areas(params: ConnectionParams, limit: int = 50) -> list[dict]:
    """Fetch up to `limit` consultee areas, most recently updated first."""
    top = int(limit)

    connection = pymssql.connect(
        server=params.server,
        port=params.port,
        database=params.database,
        user=params.user,
        password=params.password,
        as_dict=True,
    )
    try:
        with connection.cursor() as cursor:
            cursor.execute(f"SELECT TOP ({top}) {_SELECT_COLUMNS} FROM consultee_area ORDER BY lastUpdated DESC")
            rows = cursor.fetchall()
    finally:
        connection.close()

    for row in rows:
        # pymssql returns UNIQUEIDENTIFIER as uuid.UUID and DATETIME2 as datetime - neither is
        # JSON-serializable as-is
        row["id"] = str(row["id"])
        if row.get("lastUpdated") is not None:
            row["lastUpdated"] = row["lastUpdated"].isoformat()

    return rows
