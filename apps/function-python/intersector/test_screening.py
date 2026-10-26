import json
import uuid
from pathlib import Path

import pymssql
import pytest

from intersector import queries
from intersector.database import (
    RunTimedOut,
    UnknownDataset,
    dataset_table,
    is_deadlock_error,
    open_database,
    with_deadlock_retry,
)
from intersector.models import (
    AreaMatch,
    ConditionReason,
    Consultee,
    ConsulteeArea,
    NearbyReason,
    RuleCondition,
)
from intersector.queries import bounding_box, point_count
from intersector.screening import (
    _nearest_first,
    answerable_from_nearby,
    meets_intersection_condition,
    nearby_radius_for,
)
from intersector.screening import (
    run_ruleset as screen,
)
from intersector.tolerances import DISTANCE_MARGIN_METRES


def run_ruleset(*args, **kwargs) -> list[Consultee]:
    """The consultees a run found - what most of these tests look at."""
    return screen(*args, **kwargs).consultees

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
    return AreaMatch(ConsulteeArea(area_id, {"consulteeCategory": category}), distance)


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


def test_intersection_rules_within_the_nearby_radius_are_answered_from_the_nearby_search():
    assert answerable_from_nearby(_rule(buffer_metres=10_000), 20_000)
    # needs a wider radius than the shared fetch covers
    assert not answerable_from_nearby(_rule(buffer_metres=30_000), 20_000)
    # bordering is a different query shape
    assert not answerable_from_nearby(_rule(logic_type="bordering", host_category="Parish Council"), 20_000)
    # Railway is left out of the shared fetch, and "every category" implicitly includes it
    assert not answerable_from_nearby(_rule(categories=("Railway",)), 20_000)
    assert not answerable_from_nearby(_rule(categories=()), 20_000)


def test_meets_intersection_condition_mirrors_the_sql_category_and_widened_distance_filter():
    rule = _rule(buffer_metres=1_000)
    assert meets_intersection_condition(_match("a", 1_000 + DISTANCE_MARGIN_METRES), rule)
    assert not meets_intersection_condition(_match("a", 1_000 + DISTANCE_MARGIN_METRES + 1), rule)
    assert not meets_intersection_condition(_match("a", 0, category="Police"), rule)
    assert not meets_intersection_condition(_match("a", 0, category=None), rule)
    # no categories means every category
    assert meets_intersection_condition(_match("a", 0, category=None), _rule(categories=()))


def test_consultees_sort_nearest_first_then_by_id():
    consultees = [Consultee(ConsulteeArea(area_id, {}), distance) for area_id, distance in [("c", 5), ("b", 0), ("a", 0)]]
    assert [consultee.area.id for consultee in sorted(consultees, key=_nearest_first)] == ["a", "b", "c"]


def test_recording_matches_keeps_the_nearest_measured_distance_and_each_reason_once():
    consultee = Consultee(ConsulteeArea("a", {}), None)
    consultee.record(AreaMatch(ConsulteeArea("a", {}), None), ConditionReason("bordering"))
    assert consultee.distance_metres is None

    consultee.record(AreaMatch(ConsulteeArea("a", {}), 900), ConditionReason("hospital"))
    consultee.record(AreaMatch(ConsulteeArea("a", {}), 400), NearbyReason(20_000))
    consultee.record(AreaMatch(ConsulteeArea("a", {}), 700), NearbyReason(20_000))

    assert consultee.distance_metres == 400
    assert consultee.reasons == [ConditionReason("bordering"), ConditionReason("hospital"), NearbyReason(20_000)]


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
                        consultee, metadata)
                    SELECT %s, %s, g.geometry, g.geometry.Reduce(10).MakeValid(), %s, %s, '{}'
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


def _ids(consultees: list[Consultee]) -> list[str]:
    return [consultee.area.id for consultee in consultees]


def _matched(consultees: list[Consultee]) -> list[Consultee]:
    """The consultees at least one condition matched."""
    return [consultee for consultee in consultees if any(isinstance(r, ConditionReason) for r in consultee.reasons)]


def _nearby(consultees: list[Consultee]) -> list[Consultee]:
    """The consultees the general nearby search found."""
    return [consultee for consultee in consultees if any(isinstance(r, NearbyReason) for r in consultee.reasons)]


def test_only_matches_areas_in_a_conditions_categories_within_its_buffer(connection_params, areas):
    areas((TEST_AREA_ID, "POINT(0 0)", "Railway", "Test Railway"))
    railway = [_rule(categories=("Railway",), buffer_metres=10_000)]

    assert TEST_AREA_ID in _ids(_matched(run_ruleset(connection_params, "POINT(0.001 0.001)", railway, 20_000)))
    hospital = [_rule(categories=("Hospital",), buffer_metres=10_000)]
    assert TEST_AREA_ID not in _ids(_matched(run_ruleset(connection_params, "POINT(0.001 0.001)", hospital, 20_000)))
    assert TEST_AREA_ID not in _ids(_matched(run_ruleset(connection_params, "POINT(10 10)", railway, 20_000)))


def test_combines_every_conditions_matches_deduplicated_without_geometry_or_metadata(connection_params, areas):
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
    # what the manage app lists a consultee by - its geometry and metadata come from its own queries
    assert set(matches[0].area.properties) == {
        "sourceId",
        "consulteeCategory",
        "consulteeGroup",
        "consulteeSubcategory",
        "consulteeSubcategoryDescription",
        "consultee",
        "region",
    }


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
    [neighbour] = [match for match in matches if match.area.id == NEIGHBOUR_AREA_ID]
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


def test_drops_an_area_within_the_sites_convex_hull_reach_but_past_the_radius(connection_params, areas):
    # two points ~44km apart: the area between them is ~17km from the line joining them - which the
    # search's convex hull reaches (see queries._reach) - but ~28km from either point
    site = "MULTIPOINT((0 0), (0.4 0))"
    areas(
        (TEST_AREA_ID, "POINT(0 0.1)", "Hospital", "11km From One Point"),
        (SECOND_AREA_ID, "POINT(0.2 0.15)", "Hospital", "Between The Points"),
    )

    ids = _ids(_matched(run_ruleset(connection_params, site, [_rule(buffer_metres=20_000)], 20_000)))

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
    by_id = {match.area.id: match for match in result}

    # met both conditions, and is within the general search too - each reason once, ruleset order
    assert by_id[TEST_AREA_ID].reasons == [
        ConditionReason("hospital_10km"),
        ConditionReason("hospital_1km"),
        NearbyReason(20_000),
    ]
    # no condition asks for its category - it's only a consultee through the general search
    assert by_id[SECOND_AREA_ID].reasons == [NearbyReason(20_000)]
    assert 4_900 < by_id[SECOND_AREA_ID].distance_metres < 5_100


def test_a_bordering_match_beyond_the_nearby_search_has_only_its_condition_reason(connection_params, areas):
    areas(
        (HOST_AREA_ID, _square(0, 1), "Parish Council", "Host Parish"),
        (NEIGHBOUR_AREA_ID, _square(1, 2), "Parish Council", "Neighbour Parish"),
    )
    rules = [_rule(id="bordering", logic_type="bordering", categories=("Parish Council",), host_category="Parish Council")]

    result = run_ruleset(connection_params, "POINT(0.5 0.5)", rules, 1_000)
    [neighbour] = [match for match in result if match.area.id == NEIGHBOUR_AREA_ID]

    # ~55km away, so outside the 1km search - measured on its own
    assert neighbour.reasons == [ConditionReason("bordering")]
    assert 55_000 < neighbour.distance_metres < 56_000


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
    assert _nearby(run_ruleset(connection_params, "POINT(10 10)", [], 1_000)) == []


def test_a_categorys_own_nearby_radius_overrides_the_default_and_0_leaves_it_out(connection_params, areas):
    # the site is ~157m from both areas
    areas(
        (TEST_AREA_ID, "POINT(0 0)", "Electricity Generator", "Test Generator"),
        (SECOND_AREA_ID, "POINT(0 0)", "Hospital", "Test Hospital"),
    )
    site = "POINT(0.001 0.001)"

    by_default = _nearby(run_ruleset(connection_params, site, [], 1_000))
    assert {TEST_AREA_ID, SECOND_AREA_ID} <= set(_ids(by_default))

    # a smaller radius for one category leaves it out; 0 never shows it; others keep the default
    shorter = run_ruleset(connection_params, site, [], 1_000, {"Electricity Generator": 100, "Hospital": 0})
    assert set(_ids(_nearby(shorter))).isdisjoint({TEST_AREA_ID, SECOND_AREA_ID})

    # a larger one reaches past the default, with its own radius as the reason
    wider = run_ruleset(connection_params, site, [], 50, {"Hospital": 1_000})
    hospital = next(consultee for consultee in wider if consultee.area.id == SECOND_AREA_ID)
    assert hospital.reasons == [NearbyReason(1_000)]
    assert TEST_AREA_ID not in _ids(_nearby(wider))


def test_nearby_radius_for_uses_the_category_radius_with_the_distance_margin():
    assert nearby_radius_for(_match("a", 1_000 + DISTANCE_MARGIN_METRES), 1_000, {}) == 1_000
    assert nearby_radius_for(_match("a", 1_001 + DISTANCE_MARGIN_METRES), 1_000, {}) is None
    assert nearby_radius_for(_match("a", 4_000), 1_000, {"Hospital": 5_000}) == 5_000
    assert nearby_radius_for(_match("a", 0), 1_000, {"Hospital": 0}) is None
    # an unmeasured match (a bordering one) isn't nearby
    assert nearby_radius_for(_match("a", None), 1_000, {}) is None
    # an uncategorised area takes the default
    assert nearby_radius_for(_match("a", 10, category=None), 1_000, {"Hospital": 0}) == 1_000


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
    # ids come back lowercase, as the manage app's own (Prisma) queries see them
    assert all(match.area.id == match.area.id.lower() for match in result)
    uuid.UUID(ids[0])


def test_point_count_counts_each_x_y_pair():
    assert point_count("POINT (1 2)") == 1
    assert point_count("POLYGON ((0 0, 1 0, 1 1, 0 0))") == 4
    assert point_count("MULTILINESTRING ((-1.5 52.5, -1.4 52.6), (1e-3 2E+1, 3 4))") == 4


def test_bounding_box_is_the_rectangle_around_the_site_grown_by_its_margin():
    box = bounding_box("LINESTRING (0 0, 1 1)")
    margin = queries.BOUNDING_BOX_MARGIN_METRES / queries.METRES_PER_DEGREE
    west, south, east, north = -margin, -margin, 1 + margin, 1 + margin
    numbers = [float(number) for number in box.removeprefix("POLYGON((").removesuffix("))").replace(",", " ").split()]
    # anticlockwise from the south-west corner, closed - longitude margins wider than latitude's
    # away from the equator, here a hair wider at 1 degree north
    assert numbers[1::2] == pytest.approx([south, south, north, north, south])
    assert numbers[0] == pytest.approx(west, rel=1e-3) and numbers[2] == pytest.approx(east, rel=1e-3)
    assert numbers[0] < west and numbers[2] > east
    assert numbers[0:2] == numbers[8:10]


def test_a_detailed_site_is_screened_around_a_covering_outline_identifying_what_its_outline_does(
    connection_params, areas
):
    areas(
        (TEST_AREA_ID, _point_at(1_015), "Hospital", "Just Past 1km"),
        # within the covering outline's reach of 1km, but not the site's
        (SECOND_AREA_ID, _point_at(1_400), "Hospital", "Well Past 1km"),
    )
    rules = [_rule(buffer_metres=1_000)]
    site = _point_at(0)

    outline = screen(connection_params, site, rules, 1_000)
    covered = screen(connection_params, site, rules, 1_000, bounding_box_above_points=0)

    assert outline.site_screened_as == "outline"
    assert covered.site_screened_as == "simplifiedOutline"
    identified = [(c.area.id, c.distance_metres, c.reasons) for c in _matched(covered.consultees)]
    assert identified == [(c.area.id, c.distance_metres, c.reasons) for c in _matched(outline.consultees)]
    assert [area_id for area_id, _, _ in identified] == [TEST_AREA_ID]
    assert identified[0][1] == pytest.approx(1_015, abs=1)


def test_a_bordering_match_the_covering_outline_brings_nearby_is_measured_from_the_site(connection_params, areas):
    # the site ~20.3km from the host's eastern edge: its neighbour is past the 20km nearby radius
    # from the site, though not from the covering outline
    site = _point_at(METRES_PER_DEGREE - 20_300).replace(" 0)", " 0.5)")
    areas(
        (HOST_AREA_ID, _square(0, 1), "Parish Council", "Host Parish"),
        (NEIGHBOUR_AREA_ID, _square(1, 2), "Parish Council", "Neighbour Parish"),
    )
    rules = [
        _rule(id="parish", logic_type="bordering", categories=("Parish Council",), host_category="Parish Council"),
        # so the nearby search measures from the site only what an intersection condition needs
        _rule(id="hospital", categories=("Hospital",), buffer_metres=1_000),
    ]

    covered = screen(connection_params, site, rules, 20_000, bounding_box_above_points=0)

    [neighbour] = [c for c in covered.consultees if c.area.id == NEIGHBOUR_AREA_ID]
    assert covered.site_screened_as == "simplifiedOutline"
    assert neighbour.reasons == [ConditionReason("parish")]
    assert neighbour.distance_metres == pytest.approx(20_300, abs=50)


def test_a_detailed_site_with_no_covering_outline_or_when_asked_is_screened_against_its_bounding_box(
    connection_params, areas, monkeypatch
):
    # a long diagonal site, and an area in the corner of its bounding box, ~78km from the site itself
    areas((TEST_AREA_ID, "POINT(0.9 0.1)", "Hospital", "Off The Diagonal"))
    rules = [_rule(categories=("Hospital",), buffer_metres=1_000)]
    site = "LINESTRING(0 0, 1 1)"

    asked = screen(connection_params, site, rules, 1_000, bounding_box=True)
    assert asked.site_screened_as == "boundingBox"
    assert TEST_AREA_ID in _ids(_matched(asked.consultees))

    covered = screen(connection_params, site, rules, 1_000, bounding_box_above_points=1)
    assert covered.site_screened_as == "simplifiedOutline"
    assert TEST_AREA_ID not in _ids(_matched(covered.consultees))
    assert screen(connection_params, site, rules, 1_000, bounding_box_above_points=2).site_screened_as == "outline"

    monkeypatch.setattr(queries, "covering_outline", lambda *_args: None)
    boxed = screen(connection_params, site, rules, 1_000, bounding_box_above_points=1)
    assert boxed.site_screened_as == "boundingBox"
    assert TEST_AREA_ID in _ids(_matched(boxed.consultees))


def test_covering_outline_contains_the_site_and_is_simpler(connection_params):
    # a detailed zigzag, 2km long
    zigzag = "LINESTRING(" + ", ".join(f"{i * 0.0001} {0.00005 * (i % 2)}" for i in range(181)) + ")"
    with open_database(connection_params) as db:
        cover = queries.covering_outline(db, zigzag)
        [row] = db.query(
            "SELECT geography::STGeomFromText(%s, 4326).STContains(geography::STGeomFromText(%s, 4326)) AS covers",
            (cover, zigzag),
        )
    assert row["covers"] is True or row["covers"] == 1
    assert point_count(cover) < point_count(zigzag)


def test_a_run_past_its_time_limit_is_stopped_on_the_database_too(connection_params):
    with open_database(connection_params, timeout_seconds=1) as db:
        with pytest.raises(RunTimedOut):
            db.query("WAITFOR DELAY '00:00:05'; SELECT 1 AS done")
        # and every query after it, without reaching the database
        with pytest.raises(RunTimedOut):
            db.query("SELECT 1 AS done")

    with open_database(connection_params) as check:
        [row] = check.query("SELECT COUNT(*) AS waiting FROM sys.dm_exec_requests WHERE command LIKE 'WAITFOR%%'")
    assert row["waiting"] == 0


def test_a_run_within_its_time_limit_is_unaffected(connection_params):
    with open_database(connection_params, timeout_seconds=30) as db:
        assert db.query("SELECT 1 AS done") == [{"done": 1}]


def test_a_bordering_condition_on_a_bounding_box_finds_the_hosts_neighbours_in_two_queries(connection_params, areas):
    areas(
        (HOST_AREA_ID, _square(0, 1), "Parish Council", "Host Parish"),
        (NEIGHBOUR_AREA_ID, _square(1, 2), "Parish Council", "Neighbour Parish"),
        (TEST_AREA_ID, _square(5, 6), "Parish Council", "Far Away Parish"),
    )
    rules = [_rule(logic_type="bordering", categories=("Parish Council",), host_category="Parish Council")]

    boxed = screen(connection_params, "POINT(0.5 0.5)", rules, 20_000, bounding_box=True)

    ids = _ids(_matched(boxed.consultees))
    # everything the outline finds - and, around the hosts, the hosts themselves - but not beyond
    assert NEIGHBOUR_AREA_ID in ids
    assert HOST_AREA_ID in ids
    assert TEST_AREA_ID not in ids
    # with no host in the box, nothing borders it
    nowhere = screen(connection_params, "POINT(40 40)", rules, 20_000, bounding_box=True)
    assert _matched(nowhere.consultees) == []


def test_dataset_table_names_a_quarters_table_or_the_one_in_use():
    assert dataset_table(None) == "consultee_area"
    assert dataset_table("2026Q4") == "consultee_area_2026Q4"
    for dataset in ("2026-Q4", "2026Q5", "26Q4", "2026Q4; DROP TABLE x"):
        with pytest.raises(UnknownDataset):
            dataset_table(dataset)


QUARTER_TABLE_AREA_ID = "b9999999-9999-9999-9999-999999999999"


@pytest.fixture
def quarter_dataset(connection_params):
    """A dataset of its own - 2099Q4's table, made as the manage app makes one - dropped afterwards."""
    connection = pymssql.connect(
        server=connection_params.server,
        port=connection_params.port,
        database=connection_params.database,
        user=connection_params.user,
        password=connection_params.password,
        autocommit=True,
    )
    with connection.cursor() as cursor:
        cursor.execute("IF OBJECT_ID('dbo.consultee_area_2099Q4', 'U') IS NOT NULL DROP TABLE dbo.consultee_area_2099Q4")
        cursor.execute("SET QUOTED_IDENTIFIER ON; EXEC dbo.create_consultee_area_dataset %s", ("2099Q4",))
        cursor.execute(
            """
            INSERT INTO dbo.consultee_area_2099Q4 (id, geometryType, geometry, geometrySimplified, consulteeCategory,
                consultee, metadata)
            SELECT %s, 'Point', g, g, 'Hospital', 'Next Quarter Hospital', '{}'
            FROM (SELECT geography::Point(0.001, 0.001, 4326) AS g) AS p
            """,
            (QUARTER_TABLE_AREA_ID,),
        )
    try:
        yield "2099Q4"
    finally:
        with connection.cursor() as cursor:
            cursor.execute("DROP TABLE dbo.consultee_area_2099Q4")
        connection.close()


def test_screens_a_quarters_dataset_when_asked_rather_than_the_one_in_use(connection_params, quarter_dataset):
    rules = [_rule(categories=("Hospital",), buffer_metres=1_000)]

    asked = screen(connection_params, "POINT(0 0)", rules, 1_000, dataset=quarter_dataset)
    assert _ids(_matched(asked.consultees)) == [QUARTER_TABLE_AREA_ID]
    # the dataset in use doesn't hold it
    assert QUARTER_TABLE_AREA_ID not in _ids(run_ruleset(connection_params, "POINT(0 0)", rules, 1_000))
    with pytest.raises(UnknownDataset, match="There is no 2098Q1 dataset"):
        screen(connection_params, "POINT(0 0)", rules, 1_000, dataset="2098Q1")
