import json
import uuid
from pathlib import Path

import pymssql
import pytest

from querying.rulesets import (
    DISTANCE_MARGIN_METRES,
    AreaMatch,
    RuleCondition,
    _is_satisfiable_from_nearby,
    _matches_condition,
    _sort_matches,
    is_deadlock_error,
    run_ruleset,
    with_deadlock_retry,
)

# distinct from the Node suite's fixture ids (packages/database/src/geospatial/*.test.ts), so the two
# suites can run against the same database at once without deleting each other's rows
TEST_AREA_ID = "b1111111-1111-1111-1111-111111111111"
SECOND_AREA_ID = "b2222222-2222-2222-2222-222222222222"
HOST_AREA_ID = "b3333333-3333-3333-3333-333333333333"
NEIGHBOUR_AREA_ID = "b4444444-4444-4444-4444-444444444444"
FIXTURE_IDS = [TEST_AREA_ID, SECOND_AREA_ID, HOST_AREA_ID, NEIGHBOUR_AREA_ID]

# 1 degree of longitude along the equator
METRES_PER_DEGREE = 111_319.49

SAMPLE_BOUNDARIES = Path(__file__).parent.parent / "setup_database" / "sample_data" / "sample_application_boundaries.geojson"


def _match(area_id: str, distance: float, category: str | None = "Hospital") -> AreaMatch:
    return AreaMatch({"id": area_id, "properties": {"consulteeCategory": category}}, distance)


def _rule(**overrides) -> RuleCondition:
    return RuleCondition(**{"id": "rule", "logic_type": "intersection", "categories": ("Hospital",), **overrides})


def _square(west: float, east: float) -> str:
    return f"POLYGON(({west} 0, {east} 0, {east} 1, {west} 1, {west} 0))"


def _point_at(metres_east: float) -> str:
    return f"POINT({metres_east / METRES_PER_DEGREE} 0)"


# --- pure logic --------------------------------------------------------------------------------


def test_is_deadlock_error_recognises_sql_server_deadlocks_only():
    assert is_deadlock_error(pymssql.OperationalError("Transaction was deadlocked on lock resources"))
    assert is_deadlock_error(Exception("DEADLOCK detected"))
    assert not is_deadlock_error(Exception("Timeout: Request failed to complete in 15000ms"))


def test_with_deadlock_retry_retries_a_deadlock_until_it_succeeds():
    attempts = []

    def fn():
        attempts.append(1)
        if len(attempts) < 3:
            raise pymssql.OperationalError("deadlocked on lock resources")
        return "ok"

    assert with_deadlock_retry(fn) == "ok"
    assert len(attempts) == 3


def test_with_deadlock_retry_gives_up_after_the_retry_limit():
    def fn():
        raise pymssql.OperationalError("deadlocked on lock resources")

    with pytest.raises(pymssql.OperationalError, match="deadlocked"):
        with_deadlock_retry(fn, retries=2)


def test_with_deadlock_retry_does_not_retry_a_timeout_or_other_error():
    # re-running a slow spatial query just repeats the whole wait
    attempts = []

    def fn():
        attempts.append(1)
        raise pymssql.OperationalError("Timeout: Request failed to complete in 15000ms")

    with pytest.raises(pymssql.OperationalError):
        with_deadlock_retry(fn)
    assert len(attempts) == 1


def test_intersection_rules_within_the_nearby_radius_are_answered_from_the_shared_fetch():
    assert _is_satisfiable_from_nearby(_rule(buffer_metres=10_000), 20_000)
    # needs a wider radius than the shared fetch covers
    assert not _is_satisfiable_from_nearby(_rule(buffer_metres=30_000), 20_000)
    # bordering is a different query shape
    assert not _is_satisfiable_from_nearby(_rule(logic_type="bordering", host_category="Parish Council"), 20_000)
    # Railway is left out of the shared fetch, and "every category" implicitly includes it
    assert not _is_satisfiable_from_nearby(_rule(categories=("Railway",)), 20_000)
    assert not _is_satisfiable_from_nearby(_rule(categories=()), 20_000)


def test_matches_condition_mirrors_the_sql_category_and_widened_distance_filter():
    rule = _rule(buffer_metres=1_000)
    assert _matches_condition(_match("a", 1_000 + DISTANCE_MARGIN_METRES), rule)
    assert not _matches_condition(_match("a", 1_000 + DISTANCE_MARGIN_METRES + 1), rule)
    assert not _matches_condition(_match("a", 0, category="Police"), rule)
    assert not _matches_condition(_match("a", 0, category=None), rule)
    # no categories means every category
    assert _matches_condition(_match("a", 0, category=None), _rule(categories=()))


def test_sort_matches_orders_by_distance_then_id():
    matches = [_match("c", 5), _match("b", 0), _match("a", 0)]
    assert [match.area["id"] for match in _sort_matches(matches)] == ["a", "b", "c"]


# --- against the database ----------------------------------------------------------------------


@pytest.fixture
def areas(connection_params):
    """Insert consultee areas for one test, the same way the app's loader does (geometry made valid,
    and a 10m-simplified copy for the ruleset checks), and remove them afterwards."""
    connection = pymssql.connect(
        server=connection_params.server,
        port=connection_params.port,
        database=connection_params.database,
        user=connection_params.user,
        password=connection_params.password,
        autocommit=True,
    )

    def cleanup():
        with connection.cursor() as cursor:
            cursor.execute(
                f"DELETE FROM consultee_area WHERE id IN ({', '.join('%s' for _ in FIXTURE_IDS)})",
                tuple(FIXTURE_IDS),
            )

    def insert(*rows: tuple[str, str, str, str]):
        with connection.cursor() as cursor:
            for area_id, wkt, category, consultee in rows:
                cursor.execute(
                    """
                    INSERT INTO consultee_area (id, geometryType, geometry, geometrySimplified, consulteeCategory,
                        consultee, currentVersion, metadata)
                    SELECT %s, %s, g.geometry, g.geometry.Reduce(10).MakeValid(), %s, %s, 1, '{}'
                    FROM (SELECT geography::STGeomFromText(%s, 4326).MakeValid() AS geometry) AS g
                    """,
                    (area_id, wkt.split("(", 1)[0].title(), category, consultee, wkt),
                )

    cleanup()
    try:
        yield insert
    finally:
        cleanup()
        connection.close()


def _ids(matches: list[AreaMatch]) -> list[str]:
    return [match.area["id"] for match in matches]


def _matched(result) -> list[AreaMatch]:
    """The consultees at least one condition matched."""
    return [match for match in result.consultees if any(r["type"] == "condition" for r in match.reasons)]


def _nearby(result) -> list[AreaMatch]:
    """The consultees the general nearby search found."""
    return [match for match in result.consultees if any(r["type"] == "nearby" for r in match.reasons)]


def test_only_matches_areas_in_a_conditions_categories_within_its_buffer(connection_params, areas):
    areas((TEST_AREA_ID, "POINT(0 0)", "Railway", "Test Railway"))
    railway = [_rule(categories=("Railway",), buffer_metres=10_000)]

    assert TEST_AREA_ID in _ids(_matched(run_ruleset(connection_params, "POINT(0.001 0.001)", railway, 20_000)))
    hospital = [_rule(categories=("Hospital",), buffer_metres=10_000)]
    assert TEST_AREA_ID not in _ids(_matched(run_ruleset(connection_params, "POINT(0.001 0.001)", hospital, 20_000)))
    assert TEST_AREA_ID not in _ids(_matched(run_ruleset(connection_params, "POINT(10 10)", railway, 20_000)))


def test_combines_every_conditions_matches_deduplicated_with_geometry(connection_params, areas):
    areas(
        (TEST_AREA_ID, "POINT(0 0)", "Railway", "Test Railway"),
        (SECOND_AREA_ID, "POINT(0 0)", "Hospital", "Test Hospital"),
    )
    rules = [
        _rule(id="railway", categories=("Railway",), buffer_metres=10_000),
        _rule(id="hospital", categories=("Hospital",), buffer_metres=10_000),
        _rule(id="railway-again", categories=("Railway",), buffer_metres=20_000),
    ]

    matches = _matched(run_ruleset(connection_params, "POINT(0.001 0.001)", rules, 20_000))

    assert sorted(_ids(matches)) == sorted([TEST_AREA_ID, SECOND_AREA_ID])
    assert all(match.area["geometryWkt"].startswith("POINT") for match in matches)
    assert matches[0].area["properties"]["metadata"] == {}


def test_orders_matches_tied_at_the_same_distance_by_id(connection_params, areas):
    areas(
        (SECOND_AREA_ID, "POINT(0 0)", "Railway", "Test Railway 2"),
        (TEST_AREA_ID, "POINT(0 0)", "Railway", "Test Railway"),
    )
    rules = [_rule(categories=("Railway",), buffer_metres=0)]

    orderings = {tuple(_ids(_matched(run_ruleset(connection_params, "POINT(0 0)", rules, 20_000)))) for _ in range(3)}

    assert orderings == {(TEST_AREA_ID, SECOND_AREA_ID)}


def test_finds_an_area_bordering_the_host_but_not_the_host_itself(connection_params, areas):
    areas(
        (HOST_AREA_ID, _square(0, 1), "Parish Council", "Host Parish"),
        (NEIGHBOUR_AREA_ID, _square(1, 2), "Parish Council", "Neighbour Parish"),
    )
    rules = [_rule(logic_type="bordering", categories=("Parish Council",), host_category="Parish Council")]

    matches = _matched(run_ruleset(connection_params, "POINT(0.5 0.5)", rules, 20_000))

    assert HOST_AREA_ID not in _ids(matches)
    [neighbour] = [match for match in matches if match.area["id"] == NEIGHBOUR_AREA_ID]
    # its real distance from the site (half a degree of longitude, ~55.6km) - a neighbour of the
    # host isn't necessarily anywhere near the site itself
    assert 55_000 < neighbour.distance_metres < 56_000


def test_counts_a_small_gap_in_the_data_as_bordering_but_not_a_clear_one(connection_params, areas):
    areas(
        (HOST_AREA_ID, _square(0, 1), "Parish Council", "Host Parish"),
        # a real neighbour whose boundary, from a different source, stops 30m short
        (NEIGHBOUR_AREA_ID, _square(1 + 30 / METRES_PER_DEGREE, 2), "Parish Council", "Neighbour Across A Gap"),
        (TEST_AREA_ID, _square(-1, -300 / METRES_PER_DEGREE), "Parish Council", "Not A Neighbour"),
    )
    rules = [_rule(logic_type="bordering", categories=("Parish Council",), host_category="Parish Council")]

    ids = _ids(_matched(run_ruleset(connection_params, "POINT(0.5 0.5)", rules, 20_000)))

    assert NEIGHBOUR_AREA_ID in ids
    assert TEST_AREA_ID not in ids


def test_includes_an_area_just_past_a_cut_off_but_not_one_well_past_it(connection_params, areas):
    areas(
        (TEST_AREA_ID, _point_at(1_015), "Hospital", "Just Past 1km"),
        (SECOND_AREA_ID, _point_at(1_200), "Hospital", "Well Past 1km"),
    )

    ids = _ids(_matched(run_ruleset(connection_params, _point_at(0), [_rule(buffer_metres=1_000)], 20_000)))

    assert TEST_AREA_ID in ids
    assert SECOND_AREA_ID not in ids


def test_each_consultee_carries_every_reason_it_qualified_in_ruleset_order(connection_params, areas):
    areas(
        (TEST_AREA_ID, _point_at(500), "Hospital", "Near Hospital"),
        (SECOND_AREA_ID, _point_at(5_000), "Electricity Generator", "Nearby Generator"),
    )
    rules = [
        _rule(id="hospital_10km", buffer_metres=10_000),
        _rule(id="hospital_1km", buffer_metres=1_000),
    ]

    result = run_ruleset(connection_params, _point_at(0), rules, 20_000)
    by_id = {match.area["id"]: match for match in result.consultees}

    # met both conditions, and is within the general search too - each reason once, ruleset order
    assert by_id[TEST_AREA_ID].reasons == [
        {"type": "condition", "conditionId": "hospital_10km"},
        {"type": "condition", "conditionId": "hospital_1km"},
        {"type": "nearby", "radiusMetres": 20_000},
    ]
    assert "geometryWkt" in by_id[TEST_AREA_ID].area
    # no condition asks for its category - it's only a consultee through the general search, and
    # it's listed, not drawn from original geometry
    assert by_id[SECOND_AREA_ID].reasons == [{"type": "nearby", "radiusMetres": 20_000}]
    assert "geometryWkt" not in by_id[SECOND_AREA_ID].area
    assert 4_900 < by_id[SECOND_AREA_ID].distance_metres < 5_100


def test_a_bordering_match_beyond_the_nearby_search_has_only_its_condition_reason(connection_params, areas):
    areas(
        (HOST_AREA_ID, _square(0, 1), "Parish Council", "Host Parish"),
        (NEIGHBOUR_AREA_ID, _square(1, 2), "Parish Council", "Neighbour Parish"),
    )
    rules = [_rule(id="bordering", logic_type="bordering", categories=("Parish Council",), host_category="Parish Council")]

    result = run_ruleset(connection_params, "POINT(0.5 0.5)", rules, 1_000)
    [neighbour] = [match for match in result.consultees if match.area["id"] == NEIGHBOUR_AREA_ID]

    # ~55km away, so outside the 1km search - measured on its own
    assert neighbour.reasons == [{"type": "condition", "conditionId": "bordering"}]
    assert 55_000 < neighbour.distance_metres < 56_000
    assert "geometryWkt" in neighbour.area


def test_a_bordering_condition_without_a_host_category_matches_nothing(connection_params):
    rules = [_rule(logic_type="bordering", categories=("Parish Council",))]
    assert _matched(run_ruleset(connection_params, "POINT(0 0)", rules, 20_000)) == []


def test_all_nearby_lists_every_category_within_the_radius_except_railway(connection_params, areas):
    areas(
        (TEST_AREA_ID, "POINT(0 0)", "Electricity Generator", "Test Generator"),
        (SECOND_AREA_ID, "POINT(0 0)", "Railway", "Test Railway"),
    )

    nearby = _nearby(run_ruleset(connection_params, "POINT(0.001 0.001)", [], 1_000))

    # a category no condition asks for still shows up; Railway's nationwide geometry never does
    assert TEST_AREA_ID in _ids(nearby)
    assert SECOND_AREA_ID not in _ids(nearby)
    # listed, never drawn - no geometry
    assert all("geometryWkt" not in match.area for match in nearby)
    assert _nearby(run_ruleset(connection_params, "POINT(10 10)", [], 1_000)) == []


def _polygon_wkt(geometry: dict) -> str:
    def ring(points):
        return "(" + ", ".join(f"{x} {y}" for x, y, *_ in points) + ")"

    def polygon(rings):
        return "(" + ", ".join(ring(points) for points in rings) + ")"

    if geometry["type"] == "Polygon":
        return "POLYGON" + polygon(geometry["coordinates"])
    return "MULTIPOLYGON(" + ", ".join(polygon(rings) for rings in geometry["coordinates"]) + ")"


def test_finds_consultees_across_several_categories_for_a_real_project(connection_params, areas):
    # EN0110019 (EcoPower Suffolk Solar) - its real 181-vertex boundary from the checked-in sample
    # export, so this exercises a real shape rather than a convenient fixture
    features = json.loads(SAMPLE_BOUNDARIES.read_text())["features"]
    [project] = [feature for feature in features if feature["properties"].get("caseReference") == "EN0110019"]
    site_wkt = _polygon_wkt(project["geometry"])
    areas(
        (TEST_AREA_ID, site_wkt, "Upper Tier Authority", "Suffolk County Council"),
        (SECOND_AREA_ID, site_wkt, "Police", "Suffolk Constabulary"),
        (HOST_AREA_ID, "POINT(1.1828714294908717 52.38917544689788)", "Hospital", "Hartismere Hospital"),
    )
    rules = [
        _rule(id="county", categories=("Upper Tier Authority",), buffer_metres=0),
        _rule(id="police", categories=("Police",), buffer_metres=0),
        _rule(id="hospital", categories=("Hospital",), buffer_metres=10_000),
    ]

    result = run_ruleset(connection_params, site_wkt, rules, 20_000)

    ids = _ids(_matched(result))
    for fixture in (TEST_AREA_ID, SECOND_AREA_ID, HOST_AREA_ID):
        assert fixture in ids
        assert fixture in _ids(_nearby(result))
    [hospital] = [match for match in _matched(result) if match.area["id"] == HOST_AREA_ID]
    # the stored geometry, to SQL Server's own float formatting
    assert hospital.area["geometryWkt"].startswith("POINT (1.18287142949087")
    # ids come back lowercase, as the manage app's own (Prisma) queries see them
    assert all(match.area["id"] == match.area["id"].lower() for match in result.consultees)
    uuid.UUID(ids[0])
