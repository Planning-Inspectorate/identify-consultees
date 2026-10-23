"""The SQL screening runs against the consultee areas - `db.table`: the dataset in use, the
`consultee_area` synonym, or a quarter's table (see database.dataset_table).

The geometry maths runs inside SQL Server (`geography` STDistance / STIntersects /
BufferWithTolerance) against the spatial index on `geometrySimplified`; these functions only build
the queries and map the rows. Nothing here is user input except values passed as `%s` parameters -
column lists and filters are developer-controlled text.
"""

import math
import re
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

# what the manage app lists a consultee by - not its geometry (the app draws from its own display
# geometry) or its metadata (the report reads each consultee's row)
AREA_COLUMNS = f"""
    {ID} AS id, sourceId, consulteeCategory, consulteeGroup, consulteeSubcategory,
    consulteeSubcategoryDescription, consultee, region
"""

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
            "sourceId": row["sourceId"],
            "consulteeCategory": row["consulteeCategory"],
            "consulteeGroup": row["consulteeGroup"],
            "consulteeSubcategory": row["consulteeSubcategory"],
            "consulteeSubcategoryDescription": row["consulteeSubcategoryDescription"],
            "consultee": row["consultee"],
            "region": row["region"],
        },
    )


def table_exists(db: Database, table: str) -> bool:
    """Whether the consultee area table `table` exists."""
    [row] = db.query("SELECT OBJECT_ID(%s, 'U') AS id", (f"dbo.{table}",))
    return row["id"] is not None


def simplify(db: Database, wkt: str) -> str:
    """`wkt` simplified the way `geometrySimplified` is. Done to the site once per run: detailed
    site boundaries were most of a run's time (one 0.3km² site had 2,536 points)."""
    [row] = db.query(
        f"SELECT {_geography()}.Reduce(%s).MakeValid().STAsText() AS wkt",
        (wkt, SIMPLIFY_TOLERANCE_METRES),
    )
    return row["wkt"]


_NUMBER = re.compile(r"-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?")

# a degree of latitude, in metres - near enough everywhere for growing a box
METRES_PER_DEGREE = 111_320

BOUNDING_BOX_MARGIN_METRES = 1_000
"""How far a site's bounding box reaches past it. A geography's edges are great circles, not lines of
latitude: a box 100km wide bows ~250m off its corners' latitude at its middle, so without a margin
it could cut a corner of the site off."""


def point_count(wkt: str) -> int:
    """How many points a WKT shape has - each an x y pair."""
    return len(_NUMBER.findall(wkt)) // 2


def bounding_box(wkt: str, margin_metres: float = BOUNDING_BOX_MARGIN_METRES) -> str:
    """The rectangle of longitude and latitude around `wkt`, grown by `margin_metres`, as
    a polygon - anticlockwise, as SQL Server's geography needs its outer rings. Screening against it
    rather than the site's outline is fast whatever the site's detail, but finds every area near the
    rectangle - for a long, diagonal site, many that aren't near the site itself."""
    numbers = [float(number) for number in _NUMBER.findall(wkt)]
    longitudes, latitudes = numbers[0::2], numbers[1::2]
    south, north = min(latitudes), max(latitudes)
    latitude_margin = margin_metres / METRES_PER_DEGREE
    widest = max(abs(south), abs(north)) + latitude_margin
    longitude_margin = margin_metres / (METRES_PER_DEGREE * math.cos(math.radians(min(widest, 89))))
    west, east = min(longitudes) - longitude_margin, max(longitudes) + longitude_margin
    south, north = south - latitude_margin, north + latitude_margin
    return f"POLYGON(({west} {south}, {east} {south}, {east} {north}, {west} {north}, {west} {south}))"


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
        SELECT {AREA_COLUMNS}, geometrySimplified.STDistance({_geography()}) AS distanceMetres
        FROM {db.table} {USE_SPATIAL_INDEX}
        WHERE geometrySimplified.STDistance({_geography()}) <= %s
            {category_filter}
            {excluded_filter}
        ORDER BY distanceMetres
        """,
        (wkt, wkt, radius_metres + DISTANCE_MARGIN_METRES, *categories, *excluded_categories),
    )
    return [AreaMatch(_area_from_row(row), row["distanceMetres"]) for row in rows]


def find_areas_bordering(
    db: Database,
    site_within_margin: str,
    host_category: str,
    categories: Iterable[str],
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
        FROM {db.table} {USE_SPATIAL_INDEX}
        WHERE consulteeCategory = %s
            AND geometrySimplified.STIntersects({_geography()}) = 1
        """,
        (BORDERING_TOLERANCE_METRES, host_category, site_within_margin),
    )

    neighbours: dict[str, ConsulteeArea] = {}
    for host in hosts:
        rows = db.query(
            f"""
            SELECT {AREA_COLUMNS}
            FROM {db.table} {USE_SPATIAL_INDEX}
            WHERE consulteeCategory IN ({_placeholders(categories)})
                AND id <> CAST(%s AS UNIQUEIDENTIFIER)
                AND geometrySimplified.STIntersects({_geography()}) = 1
            """,
            (*categories, host["id"], host["grownWkt"]),
        )
        for row in rows:
            neighbours[row["id"]] = _area_from_row(row)
    return list(neighbours.values())


def find_areas_bordering_box(
    db: Database,
    box_within_margin: str,
    host_category: str,
    categories: Iterable[str],
) -> list[ConsulteeArea]:
    """For a site screened against its bounding box: areas of `categories` within
    BORDERING_TOLERANCE_METRES of the rectangle around every `host_category` area that intersects
    the box (already grown by the distance margin). Unmeasured - see AreaMatch.

    A box can hold hundreds of hosts - find_areas_bordering's query per host took 778 queries for
    the most detailed real site - so this takes two: each host's bounding circle (no outlines read),
    then one query for the rectangle around them all. Every area bordering a host touches it, so
    it's in that rectangle: this finds everything find_areas_bordering would, and the hosts and
    their other neighbours besides."""
    categories = list(categories)
    if not categories:
        return []
    hosts = db.query(
        f"""
        SELECT geometrySimplified.EnvelopeCenter().Lat AS latitude,
            geometrySimplified.EnvelopeCenter().Long AS longitude,
            geometrySimplified.EnvelopeAngle() AS angle
        FROM {db.table} {USE_SPATIAL_INDEX}
        WHERE consulteeCategory = %s
            AND geometrySimplified.STIntersects({_geography()}) = 1
        """,
        (host_category, box_within_margin),
    )
    if not hosts:
        return []
    # each host's bounding circle as a rectangle of longitude and latitude: its angle north and
    # south, and wider east and west - by the narrowest a degree of longitude is across them all
    south = min(host["latitude"] - host["angle"] for host in hosts)
    north = max(host["latitude"] + host["angle"] for host in hosts)
    widest = min(max(abs(south), abs(north)), 89)
    reach = max(host["angle"] for host in hosts) / math.cos(math.radians(widest))
    west = min(host["longitude"] for host in hosts) - reach
    east = max(host["longitude"] for host in hosts) + reach
    hosts_box = bounding_box(f"LINESTRING ({west} {south}, {east} {north})", BORDERING_TOLERANCE_METRES)
    rows = db.query(
        f"""
        SELECT {AREA_COLUMNS}
        FROM {db.table} {USE_SPATIAL_INDEX}
        WHERE consulteeCategory IN ({_placeholders(categories)})
            AND geometrySimplified.STIntersects({_geography()}) = 1
        """,
        (*categories, hosts_box),
    )
    return [_area_from_row(row) for row in rows]


def _select_by_id(db: Database, columns: str, ids: list[str], params_before: tuple = ()) -> list[dict]:
    rows: list[dict] = []
    for start in range(0, len(ids), ID_LOOKUP_BATCH_SIZE):
        batch = ids[start : start + ID_LOOKUP_BATCH_SIZE]
        rows.extend(
            db.query(
                f"SELECT {columns} FROM {db.table} WHERE id IN ({_placeholders(batch)})",
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
