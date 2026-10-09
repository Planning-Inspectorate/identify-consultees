"""The SQL screening runs against `consultee_area`.

The geometry maths runs inside SQL Server (`geography` STDistance / STIntersects /
BufferWithTolerance) against the spatial index on `geometrySimplified`; these functions only build
the queries and map the rows. Nothing here is user input except values passed as `%s` parameters -
column lists and filters are developer-controlled text.
"""

import json
from collections.abc import Iterable

from intersector.database import Database
from intersector.models import AreaMatch, ConsulteeArea
from intersector.tolerances import (
    BORDERING_TOLERANCE_METRES,
    DISTANCE_MARGIN_METRES,
    SIMPLIFY_TOLERANCE_METRES,
)

# SQL Server caps a statement at 2,100 parameters
ID_LOOKUP_BATCH_SIZE = 1000


def _as_text(column: str) -> str:
    """A UNIQUEIDENTIFIER as lowercase text - how the manage app's own (Prisma) queries see ids. The
    app matches these against its display-geometry lookups and `exclude=` URLs."""
    return f"LOWER(CAST({column} AS NVARCHAR(36)))"


ID = _as_text("id")

AREA_COLUMNS = f"""
    {ID} AS id, consulteeCategory, consultee, region, caseReference,
    {_as_text("documentId")} AS documentId, {_as_text("consulteeId")} AS consulteeId,
    {_as_text("organisationId")} AS organisationId, currentVersion, metadata
"""
AREA_COLUMNS_WITH_GEOMETRY = f"{AREA_COLUMNS}, geometry.STAsText() AS geometryWkt"

# Forces the spatial index. Found when this ran in Node: with Prisma's parameterised SQL and a
# category filter, SQL Server sometimes read every row of the category nationally instead (~180x
# slower). pymssql inlines values, which tends to pick the right plan anyway - the hint stays so a
# driver change can't quietly undo it.
USE_SPATIAL_INDEX = "WITH (INDEX(consultee_area_geometry_simplified_sidx))"


def _placeholders(values: Iterable) -> str:
    return ", ".join("%s" for _ in values)


def _geography(placeholder: str = "%s") -> str:
    return f"geography::STGeomFromText({placeholder}, 4326)"


def _area_from_row(row: dict) -> ConsulteeArea:
    return ConsulteeArea(
        id=row["id"],
        properties={
            "consulteeCategory": row["consulteeCategory"],
            "consultee": row["consultee"],
            "region": row["region"],
            "caseReference": row["caseReference"],
            "documentId": row["documentId"],
            "consulteeId": row["consulteeId"],
            "organisationId": row["organisationId"],
            "currentVersion": row["currentVersion"],
            "metadata": json.loads(row["metadata"]),
        },
        geometry_wkt=row.get("geometryWkt"),
    )


def simplify(db: Database, wkt: str) -> str:
    """`wkt` simplified the way `geometrySimplified` is. Done to the site once per run: detailed
    site boundaries were most of a run's time (one 0.3km² site had 2,536 points)."""
    [row] = db.query(
        f"SELECT {_geography()}.Reduce(%s).MakeValid().STAsText() AS wkt",
        (wkt, SIMPLIFY_TOLERANCE_METRES),
    )
    return row["wkt"]


def grow(db: Database, wkt: str, metres: float) -> str:
    """`wkt` grown outwards by `metres` (to within 1m). "Within n metres of X" then becomes
    "intersects X grown by n" - far cheaper against detailed shapes, because an intersects test can
    stop at the first point of contact where a distance calculation can't."""
    [row] = db.query(
        f"SELECT {_geography()}.BufferWithTolerance(%s, 1, 0).STAsText() AS wkt",
        (wkt, metres),
    )
    return row["wkt"]


def find_areas_near(
    db: Database,
    wkt: str,
    radius_metres: float,
    categories: Iterable[str] = (),
    excluded_categories: Iterable[str] = (),
    with_geometry: bool = True,
) -> list[AreaMatch]:
    """Areas within `radius_metres` (+ DISTANCE_MARGIN_METRES) of `wkt`, nearest first, optionally
    limited to `categories` or leaving out `excluded_categories`."""
    categories = list(categories)
    excluded_categories = list(excluded_categories)
    category_filter = f"AND consulteeCategory IN ({_placeholders(categories)})" if categories else ""
    # NULL-safe: a plain NOT IN would also drop rows with no category at all
    excluded_filter = (
        f"AND (consulteeCategory IS NULL OR consulteeCategory NOT IN ({_placeholders(excluded_categories)}))"
        if excluded_categories
        else ""
    )
    rows = db.query(
        f"""
        SELECT {AREA_COLUMNS_WITH_GEOMETRY if with_geometry else AREA_COLUMNS},
            geometrySimplified.STDistance({_geography()}) AS distanceMetres
        FROM consultee_area {USE_SPATIAL_INDEX}
        WHERE geometrySimplified.STDistance({_geography()}) <= %s
            {category_filter}
            {excluded_filter}
        ORDER BY distanceMetres
        """,
        (wkt, wkt, radius_metres + DISTANCE_MARGIN_METRES, *categories, *excluded_categories),
    )
    return [AreaMatch(_area_from_row(row), row["distanceMetres"]) for row in rows]


def find_areas_bordering(
    db: Database, site_within_margin: str, host_category: str, categories: Iterable[str]
) -> list[ConsulteeArea]:
    """Areas of `categories` within BORDERING_TOLERANCE_METRES of any `host_category` area that
    intersects the site (already grown by the distance margin). Unmeasured - see AreaMatch.

    Two round trips, not one: comparing two geometry columns can't use the spatial index (it needs
    a constant on one side) and degrades to a near full-table scan - a real 15s+ timeout. Fetching
    the hosts first, then querying with each one's geometry as a parameter, keeps both queries on
    the indexed `STIntersects(column, constant)` path.
    """
    categories = list(categories)
    if not categories:
        return []

    # each host comes back already grown by the bordering tolerance - Somerset's neighbours by
    # distance took ~930ms, by intersects with it grown ~220ms
    hosts = db.query(
        f"""
        SELECT {ID} AS id, geometrySimplified.BufferWithTolerance(%s, 1, 0).STAsText() AS grownWkt
        FROM consultee_area {USE_SPATIAL_INDEX}
        WHERE consulteeCategory = %s
            AND geometrySimplified.STIntersects({_geography()}) = 1
        """,
        (BORDERING_TOLERANCE_METRES, host_category, site_within_margin),
    )

    neighbours: dict[str, ConsulteeArea] = {}
    for host in hosts:
        rows = db.query(
            f"""
            SELECT {AREA_COLUMNS_WITH_GEOMETRY}
            FROM consultee_area {USE_SPATIAL_INDEX}
            WHERE consulteeCategory IN ({_placeholders(categories)})
                AND id <> CAST(%s AS UNIQUEIDENTIFIER)
                AND geometrySimplified.STIntersects({_geography()}) = 1
            """,
            (*categories, host["id"], host["grownWkt"]),
        )
        for row in rows:
            neighbours[row["id"]] = _area_from_row(row)
    return list(neighbours.values())


def _select_by_id(db: Database, columns: str, ids: list[str], params_before: tuple = ()) -> list[dict]:
    rows: list[dict] = []
    for start in range(0, len(ids), ID_LOOKUP_BATCH_SIZE):
        batch = ids[start : start + ID_LOOKUP_BATCH_SIZE]
        rows.extend(
            db.query(
                f"SELECT {columns} FROM consultee_area WHERE id IN ({_placeholders(batch)})",
                (*params_before, *batch),
            )
        )
    return rows


def measure_distances(db: Database, wkt: str, ids: list[str]) -> dict[str, float]:
    """Each area's distance from `wkt` (between simplified shapes), by id. Unknown ids are absent."""
    rows = _select_by_id(
        db, f"{ID} AS id, geometrySimplified.STDistance({_geography()}) AS distanceMetres", ids, (wkt,)
    )
    return {row["id"]: row["distanceMetres"] for row in rows}


def fetch_geometries(db: Database, ids: list[str]) -> dict[str, str]:
    """Each area's original geometry as WKT, by id. Unknown ids are absent."""
    rows = _select_by_id(db, f"{ID} AS id, geometry.STAsText() AS geometryWkt", ids)
    return {row["id"]: row["geometryWkt"] for row in rows}
