"""Runs a ruleset's conditions against a project site - the consultee intersection logic.

A ruleset is the union of its conditions: running one means running every condition and combining
the results (the site's hosting council *and* nearby hospitals *and* neighbouring parishes...).
Each condition is one of two shapes:

- `intersection`: consultee areas of `categories` within `bufferMetres` of the site (0 = must
  actually intersect, not just be nearby).
- `bordering`: find the `hostCategory` areas that intersect the site (e.g. the parish it sits in),
  then the areas of `categories` sharing a border with them (e.g. neighbouring parishes) - a
  different query shape, not a distance check.

The ruleset definitions themselves (the CSV export, and its category aliases) stay with the manage
app, which needs them to describe each category's rules on the report pages; it sends the selected
ruleset's conditions with each request, so there's one copy of them rather than two to keep in step.

The geometry maths runs inside SQL Server (`geography` STDistance/STIntersects/BufferWithTolerance)
against its spatial index - this module decides which queries to run and combines what comes back.
Every check runs against simplified shapes - the site is simplified once per run, and each area's
simplified copy is stored in `geometrySimplified` - with thresholds widened to match (see
DISTANCE_MARGIN_METRES): matches are a superset of an exact calculation's, so a consultee within a
few tens of metres of a cut-off may be included, never missed. Distances are approximate to match.
"""

import json
import random
import re
import threading
import time
from collections.abc import Callable, Iterable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import TypeVar

import pymssql

from setup_database.db import ConnectionParams

# Douglas-Peucker tolerance of consultee_area.geometrySimplified - must match the migration that
# backfilled it (packages/database/src/migrations/*_add_consultee_area_simplified_geometry)
SIMPLIFY_TOLERANCE_METRES = 10

# Simplifying both shapes can move a distance by up to twice the tolerance, so every distance
# threshold is widened by more than that: simplification can only *add* a borderline consultee,
# never drop one. The service would rather consult one body too many than miss one.
DISTANCE_MARGIN_METRES = 2 * SIMPLIFY_TOLERANCE_METRES + 10

# Areas within this distance of each other count as bordering - the simplification error, plus
# small gaps between boundaries drawn from different sources (e.g. 32m between Sundon parish and
# Luton's boundary in the reference data, which really do border).
BORDERING_TOLERANCE_METRES = 50

# Left out of the "any category" nearby fetch regardless of distance: Railway's rows are merged
# nationwide by type/status (one feature is a single MultiLineString covering the whole GB network),
# so its bounding box defeats the spatial index for every location - roughly doubling that query's
# cost - and "near the national rail network" is true for almost every project anyway. Conditions
# that name Railway run their own category-scoped query instead (see _is_satisfiable_from_nearby).
CATEGORIES_EXCLUDED_FROM_NEARBY = ("Railway",)

# Conditions not answerable from the shared nearby fetch run on this many connections at once, not
# all at once: fully parallel produced real deadlocks and timeouts once other work hit the same table.
CONDITION_CONCURRENCY = 6

# SQL Server caps a single statement at 2,100 parameters
_ID_LOOKUP_BATCH_SIZE = 1000

_DEADLOCK_RETRIES = 3

# UNIQUEIDENTIFIERs as lowercase text - exactly how the manage app's own queries (Prisma) see them,
# since the app matches these ids against its display-geometry lookups and `exclude=` URLs
_ID = "LOWER(CAST(id AS NVARCHAR(36)))"

# developer-controlled, never user input - safe to inline into the SQL text
_SUMMARY_COLUMNS = f"""
    {_ID} AS id, consulteeCategory, consultee, region, caseReference,
    LOWER(CAST(documentId AS NVARCHAR(36))) AS documentId, LOWER(CAST(consulteeId AS NVARCHAR(36))) AS consulteeId,
    LOWER(CAST(organisationId AS NVARCHAR(36))) AS organisationId, currentVersion, metadata
"""
_FEATURE_COLUMNS = f"{_SUMMARY_COLUMNS}, geometry.STAsText() AS geometryWkt"

_SPATIAL_INDEX_HINT = "WITH (INDEX(consultee_area_geometry_simplified_sidx))"


@dataclass(frozen=True)
class RuleCondition:
    id: str
    logic_type: str
    """'intersection' or 'bordering'."""
    categories: tuple[str, ...]
    """consultee_area.consulteeCategory values this condition matches (OR'd together)."""
    buffer_metres: float = 0
    """intersection only: buffer radius in metres (0 = must actually intersect)."""
    host_category: str | None = None
    """bordering only: the category of the area that must intersect the site first."""


@dataclass
class AreaMatch:
    area: dict
    """The consultee area as returned to the caller: id, properties, and (once known) geometryWkt."""
    distance_metres: float


@dataclass
class RunRulesetResult:
    matches: list[AreaMatch]
    """The ruleset's own matches - the union of every condition, deduplicated, nearest first."""
    all_nearby: list[AreaMatch]
    """Every area within the nearby radius, any category except CATEGORIES_EXCLUDED_FROM_NEARBY -
    listed, never drawn, so without geometry."""


T = TypeVar("T")


def is_deadlock_error(error: BaseException) -> bool:
    return re.search("deadlock", str(error), re.IGNORECASE) is not None


def with_deadlock_retry(fn: Callable[[], T], retries: int = _DEADLOCK_RETRIES) -> T:
    """Retry `fn` on a SQL Server deadlock ("... chosen as the deadlock victim. Rerun the
    transaction.") - an expected outcome of concurrent reads against the same table, not a bug.

    Timeouts are deliberately not retried: re-running a slow spatial query just repeats the wait.
    """
    attempt = 0
    while True:
        try:
            return fn()
        except pymssql.Error as error:
            if not is_deadlock_error(error) or attempt >= retries:
                raise
            attempt += 1
            # small randomised backoff so retried queries don't immediately re-collide
            time.sleep(0.025 + random.random() * 0.075)


class _Database:
    """One pymssql connection per thread (connections aren't safe to share across threads), all
    closed together at the end of a ruleset run."""

    def __init__(self, params: ConnectionParams):
        self._params = params
        self._local = threading.local()
        self._connections: list[pymssql.Connection] = []
        self._lock = threading.Lock()

    def _connection(self) -> pymssql.Connection:
        connection = getattr(self._local, "connection", None)
        if connection is None:
            connection = pymssql.connect(
                server=self._params.server,
                port=self._params.port,
                database=self._params.database,
                user=self._params.user,
                password=self._params.password,
                as_dict=True,
            )
            self._local.connection = connection
            with self._lock:
                self._connections.append(connection)
        return connection

    def query(self, sql: str, params: tuple = ()) -> list[dict]:
        def run() -> list[dict]:
            with self._connection().cursor() as cursor:
                cursor.execute(sql, params)
                return cursor.fetchall()

        return with_deadlock_retry(run)

    def close(self) -> None:
        with self._lock:
            for connection in self._connections:
                connection.close()
            self._connections.clear()


def _placeholders(values: Iterable) -> str:
    return ", ".join("%s" for _ in values)


def _area_from_row(row: dict) -> dict:
    area = {
        "id": row["id"],
        "properties": {
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
    }
    if "geometryWkt" in row:
        area["geometryWkt"] = row["geometryWkt"]
    return area


def simplify_geometry(db: _Database, wkt: str) -> str:
    """Simplify the site the same way consultee areas' `geometrySimplified` is - done once per run,
    then used for every query in it. Detailed site boundaries are where most of a run's time went:
    one 0.3 km² site had 2,536 points, mostly under a metre apart."""
    [row] = db.query(
        "SELECT geography::STGeomFromText(%s, 4326).Reduce(%s).MakeValid().STAsText() AS wkt",
        (wkt, SIMPLIFY_TOLERANCE_METRES),
    )
    return row["wkt"]


def grow_geometry(db: _Database, wkt: str, metres: float) -> str:
    """`wkt` grown outwards by `metres` (to within 1m). "Within n metres of X" then becomes
    "intersects X grown by n" - far cheaper against detailed shapes, because an intersects test can
    stop at the first point of contact where a distance calculation can't."""
    [row] = db.query(
        "SELECT geography::STGeomFromText(%s, 4326).BufferWithTolerance(%s, 1, 0).STAsText() AS wkt",
        (wkt, metres),
    )
    return row["wkt"]


def find_areas_near(
    db: _Database,
    wkt: str,
    radius_metres: float,
    categories: Iterable[str] = (),
    exclude_categories: Iterable[str] = (),
    with_geometry: bool = True,
) -> list[AreaMatch]:
    """Consultee areas within `radius_metres` (+ DISTANCE_MARGIN_METRES) of `wkt`, nearest first."""
    categories = list(categories)
    exclude_categories = list(exclude_categories)
    category_filter = f"AND consulteeCategory IN ({_placeholders(categories)})" if categories else ""
    # NULL-safe: a plain NOT IN would also drop rows with no category at all
    exclude_filter = (
        f"AND (consulteeCategory IS NULL OR consulteeCategory NOT IN ({_placeholders(exclude_categories)}))"
        if exclude_categories
        else ""
    )
    columns = _FEATURE_COLUMNS if with_geometry else _SUMMARY_COLUMNS
    rows = db.query(
        f"""
        SELECT {columns},
            geometrySimplified.STDistance(geography::STGeomFromText(%s, 4326)) AS distanceMetres
        FROM consultee_area {_SPATIAL_INDEX_HINT}
        WHERE geometrySimplified.STDistance(geography::STGeomFromText(%s, 4326)) <= %s
            {category_filter}
            {exclude_filter}
        ORDER BY distanceMetres
        """,
        (wkt, wkt, radius_metres + DISTANCE_MARGIN_METRES, *categories, *exclude_categories),
    )
    return [AreaMatch(_area_from_row(row), row["distanceMetres"]) for row in rows]


def find_areas_bordering(
    db: _Database, site_within_margin: str, host_category: str, categories: Iterable[str]
) -> list[dict]:
    """Areas of `categories` bordering (within BORDERING_TOLERANCE_METRES of) any `host_category`
    area that intersects the site.

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
        SELECT {_ID} AS id,
            geometrySimplified.BufferWithTolerance(%s, 1, 0).STAsText() AS grownHostWkt
        FROM consultee_area {_SPATIAL_INDEX_HINT}
        WHERE consulteeCategory = %s
            AND geometrySimplified.STIntersects(geography::STGeomFromText(%s, 4326)) = 1
        """,
        (BORDERING_TOLERANCE_METRES, host_category, site_within_margin),
    )

    areas_by_id: dict[str, dict] = {}
    for host in hosts:
        rows = db.query(
            f"""
            SELECT {_FEATURE_COLUMNS}
            FROM consultee_area {_SPATIAL_INDEX_HINT}
            WHERE consulteeCategory IN ({_placeholders(categories)})
                AND id <> CAST(%s AS UNIQUEIDENTIFIER)
                AND geometrySimplified.STIntersects(geography::STGeomFromText(%s, 4326)) = 1
            """,
            (*categories, host["id"], host["grownHostWkt"]),
        )
        for row in rows:
            areas_by_id[row["id"]] = _area_from_row(row)
    return list(areas_by_id.values())


def _lookup_by_id(db: _Database, select: str, ids: list[str], params_before: tuple = ()) -> list[dict]:
    rows: list[dict] = []
    for start in range(0, len(ids), _ID_LOOKUP_BATCH_SIZE):
        batch = ids[start : start + _ID_LOOKUP_BATCH_SIZE]
        rows.extend(
            db.query(
                f"{select} FROM consultee_area WHERE id IN ({_placeholders(batch)})",
                (*params_before, *batch),
            )
        )
    return rows


def get_area_distances(db: _Database, wkt: str, ids: list[str]) -> dict[str, float]:
    """Approximate distance (simplified shapes) from `wkt` to specific areas. Unknown ids are absent."""
    rows = _lookup_by_id(
        db,
        f"SELECT {_ID} AS id, geometrySimplified.STDistance(geography::STGeomFromText(%s, 4326)) AS distanceMetres",
        ids,
        (wkt,),
    )
    return {row["id"]: row["distanceMetres"] for row in rows}


def get_area_geometries(db: _Database, ids: list[str]) -> dict[str, str]:
    """WKT geometry of specific areas by id. Unknown ids are absent."""
    rows = _lookup_by_id(db, f"SELECT {_ID} AS id, geometry.STAsText() AS geometryWkt", ids)
    return {row["id"]: row["geometryWkt"] for row in rows}


def _is_satisfiable_from_nearby(rule: RuleCondition, nearby_radius_metres: float) -> bool:
    """True when `rule` can be answered by filtering the shared nearby fetch instead of its own
    query. Not for a rule touching a category that fetch leaves out - or matching every category,
    which includes one implicitly: the shared fetch doesn't have those rows to filter."""
    touches_excluded_category = not rule.categories or any(
        category in CATEGORIES_EXCLUDED_FROM_NEARBY for category in rule.categories
    )
    return (
        rule.logic_type == "intersection"
        and rule.buffer_metres <= nearby_radius_metres
        and not touches_excluded_category
    )


def _matches_condition(match: AreaMatch, rule: RuleCondition) -> bool:
    """Mirrors find_areas_near's `consulteeCategory IN (...) AND STDistance <= radius + margin`, so
    a condition answered from the shared fetch includes exactly what its own query would."""
    category = match.area["properties"]["consulteeCategory"] or ""
    category_matches = not rule.categories or category in rule.categories
    return category_matches and match.distance_metres <= rule.buffer_metres + DISTANCE_MARGIN_METRES


def _sort_matches(matches: list[AreaMatch]) -> list[AreaMatch]:
    # tie-break on id: ORDER BY distanceMetres has no secondary key, so rows tied at the same
    # distance (very common - most conditions need an outright intersection, distance 0) don't come
    # back in a stable order between runs, and the manage app's static-map ETag depends on it
    return sorted(matches, key=lambda match: (match.distance_metres, match.area["id"]))


def run_ruleset(
    params: ConnectionParams, site_wkt: str, rules: list[RuleCondition], nearby_radius_metres: float
) -> RunRulesetResult:
    """Run every condition of a ruleset against a project site and combine the results.

    One query fetches everything within `nearby_radius_metres` up front (which doubles as the
    "all nearby consultees" list) and every `intersection` condition at or under that radius is
    filtered from it in memory. Only conditions needing a wider radius, or `bordering` logic, run
    their own query - CONDITION_CONCURRENCY at a time. Duplicates (an area matching more than one
    condition) are removed, nearest first.

    The shared fetch skips geometry (some rows are whole county or National Park boundaries) -
    geometry is fetched by id for just the final matches, the only rows the map draws.
    """
    db = _Database(params)
    try:
        return _run_ruleset(db, site_wkt, rules, nearby_radius_metres)
    finally:
        db.close()


def _run_ruleset(
    db: _Database, site_wkt: str, rules: list[RuleCondition], nearby_radius_metres: float
) -> RunRulesetResult:
    site = simplify_geometry(db, site_wkt)
    all_nearby = find_areas_near(
        db,
        site,
        nearby_radius_metres,
        exclude_categories=CATEGORIES_EXCLUDED_FROM_NEARBY,
        with_geometry=False,
    )

    results_by_rule: list[list[AreaMatch]] = []
    remaining_rules: list[RuleCondition] = []
    for rule in rules:
        if _is_satisfiable_from_nearby(rule, nearby_radius_metres):
            results_by_rule.append([match for match in all_nearby if _matches_condition(match, rule)])
        else:
            remaining_rules.append(rule)

    # grown once, and only if a bordering condition needs it
    needs_margin = any(rule.logic_type == "bordering" and rule.host_category for rule in remaining_rules)
    site_within_margin = grow_geometry(db, site, DISTANCE_MARGIN_METRES) if needs_margin else None

    def run_condition(rule: RuleCondition) -> tuple[list[AreaMatch], list[dict]]:
        if rule.logic_type == "bordering":
            if not rule.host_category:
                return [], []
            return [], find_areas_bordering(db, site_within_margin, rule.host_category, rule.categories)
        return find_areas_near(db, site, rule.buffer_metres, rule.categories), []

    known_geometries: dict[str, str] = {}
    bordering_areas: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=CONDITION_CONCURRENCY) as pool:
        for near, bordering in pool.map(run_condition, remaining_rules):
            results_by_rule.append(near)
            for match in near:
                known_geometries[match.area["id"]] = match.area["geometryWkt"]
            for area in bordering:
                bordering_areas[area["id"]] = area
                known_geometries[area["id"]] = area["geometryWkt"]

    matches_by_id: dict[str, AreaMatch] = {}
    for matches in results_by_rule:
        for match in matches:
            existing = matches_by_id.get(match.area["id"])
            if existing is None or match.distance_metres < existing.distance_metres:
                matches_by_id[match.area["id"]] = match

    # bordering matches come back without a distance - most already have one from another
    # condition; measure the rest once here, rather than once per host inside the bordering query
    unmeasured_ids = [area_id for area_id in bordering_areas if area_id not in matches_by_id]
    for area_id, distance in get_area_distances(db, site, unmeasured_ids).items():
        matches_by_id[area_id] = AreaMatch(bordering_areas[area_id], distance)

    missing_ids = [area_id for area_id in matches_by_id if area_id not in known_geometries]
    fetched_geometries = get_area_geometries(db, missing_ids)

    matches: list[AreaMatch] = []
    for area_id, match in matches_by_id.items():
        geometry = known_geometries.get(area_id) or fetched_geometries.get(area_id)
        # absent only if the row was deleted between queries (a reference data reload mid-request)
        if geometry:
            matches.append(AreaMatch({**match.area, "geometryWkt": geometry}, match.distance_metres))

    return RunRulesetResult(matches=_sort_matches(matches), all_nearby=_sort_matches(all_nearby))
