"""Run a ruleset against a project site: which consultee areas it identifies, and why."""

from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from functools import partial

from intersector import queries
from intersector.database import Database, open_database
from intersector.models import (
    AreaMatch,
    ConditionReason,
    Consultee,
    NearbyReason,
    Reason,
    RuleCondition,
)
from intersector.tolerances import (
    CATEGORIES_EXCLUDED_FROM_NEARBY,
    DISTANCE_MARGIN_METRES,
)
from setup_database.db import ConnectionParams

CONDITION_CONCURRENCY = 6
"""Conditions that need their own query run this many at a time. Fully parallel produced real
deadlocks and timeouts once other work hit the same table."""


def run_ruleset(
    params: ConnectionParams, site_wkt: str, rules: list[RuleCondition], nearby_radius_metres: float
) -> list[Consultee]:
    """Every consultee the ruleset identifies for the site, plus every area within
    `nearby_radius_metres` (any category but Railway), nearest first.

    Each consultee appears once, with every reason it qualified: a ConditionReason for each
    condition it met, in the ruleset's order, then a NearbyReason if the nearby search found it.
    """
    with open_database(params) as db:
        site = queries.simplify(db, site_wkt)
        # one query for everything nearby: the nearby reasons, and the answer to most conditions.
        # No geometry - some rows are whole counties or National Parks, and most aren't drawn
        nearby = queries.find_areas_near(
            db, site, nearby_radius_metres, excluded_categories=CATEGORIES_EXCLUDED_FROM_NEARBY, with_geometry=False
        )
        matches_by_condition = _match_conditions(db, site, rules, nearby, nearby_radius_metres)

        consultees = _combine(rules, matches_by_condition, nearby, nearby_radius_metres)
        _measure_unmeasured(db, site, consultees)
        _add_geometry_to_condition_matches(db, consultees)
        return sorted(consultees.values(), key=_nearest_first)


def answerable_from_nearby(rule: RuleCondition, nearby_radius_metres: float) -> bool:
    """Whether the nearby search already has every row `rule` could match, so it can be filtered
    in memory instead of queried: an intersection condition within the radius, for categories the
    search includes. "Every category" (no categories) includes Railway, which the search leaves out.
    """
    return (
        rule.logic_type == "intersection"
        and rule.buffer_metres <= nearby_radius_metres
        and bool(rule.categories)
        and not any(category in CATEGORIES_EXCLUDED_FROM_NEARBY for category in rule.categories)
    )


def meets_intersection_condition(match: AreaMatch, rule: RuleCondition) -> bool:
    """Mirrors find_areas_near's category and widened-distance filter, so a condition answered from
    the nearby search finds exactly what its own query would."""
    category = match.area.properties["consulteeCategory"] or ""
    in_category = not rule.categories or category in rule.categories
    return in_category and match.distance_metres <= rule.buffer_metres + DISTANCE_MARGIN_METRES


def _match_conditions(
    db: Database, site: str, rules: list[RuleCondition], nearby: list[AreaMatch], nearby_radius_metres: float
) -> dict[str, list[AreaMatch]]:
    """Each condition's matches, by condition id - filtered from the nearby search where it can be,
    otherwise from the condition's own query."""
    matches_by_condition: dict[str, list[AreaMatch]] = {}
    needs_query: list[RuleCondition] = []
    for rule in rules:
        if answerable_from_nearby(rule, nearby_radius_metres):
            matches_by_condition[rule.id] = [match for match in nearby if meets_intersection_condition(match, rule)]
        else:
            needs_query.append(rule)

    # bordering conditions look for hosts touching the site within the distance margin - grown
    # once, and only if one needs it
    site_within_margin = (
        queries.grow(db, site, DISTANCE_MARGIN_METRES)
        if any(rule.logic_type == "bordering" and rule.host_category for rule in needs_query)
        else None
    )

    query = partial(_query_condition, db, site, site_within_margin)
    with ThreadPoolExecutor(max_workers=CONDITION_CONCURRENCY) as pool:
        for rule, matches in zip(needs_query, pool.map(query, needs_query), strict=True):
            matches_by_condition[rule.id] = matches
    return matches_by_condition


def _query_condition(db: Database, site: str, site_within_margin: str | None, rule: RuleCondition) -> list[AreaMatch]:
    """`rule`'s matches from its own query."""
    if rule.logic_type == "intersection":
        return queries.find_areas_near(db, site, rule.buffer_metres, rule.categories)
    if not rule.host_category:
        return []
    neighbours = queries.find_areas_bordering(db, site_within_margin, rule.host_category, rule.categories)
    return [AreaMatch(area, distance_metres=None) for area in neighbours]


def _combine(
    rules: list[RuleCondition],
    matches_by_condition: dict[str, list[AreaMatch]],
    nearby: list[AreaMatch],
    nearby_radius_metres: float,
) -> dict[str, Consultee]:
    """One Consultee per area, by id, with its nearest measured distance, any geometry a query
    brought back, and its reasons: conditions in the ruleset's order, then the nearby search."""
    consultees: dict[str, Consultee] = {}

    def add(match: AreaMatch, reason: Reason) -> None:
        consultees.setdefault(match.area.id, Consultee(match.area, match.distance_metres)).record(match, reason)

    for rule in rules:
        for match in matches_by_condition.get(rule.id, []):
            add(match, ConditionReason(rule.id))
    for match in nearby:
        add(match, NearbyReason(nearby_radius_metres))
    return consultees


def _measure_unmeasured(db: Database, site: str, consultees: dict[str, Consultee]) -> None:
    """Give a distance to consultees only a bordering condition found - most were also found by a
    query that measured them. One query for all of them, rather than one per host."""
    unmeasured = [area_id for area_id, consultee in consultees.items() if consultee.distance_metres is None]
    distances = queries.measure_distances(db, site, unmeasured)
    for area_id in unmeasured:
        if area_id in distances:
            consultees[area_id].distance_metres = distances[area_id]
        else:
            # deleted between queries (a reference data reload mid-request) - nothing left to notify
            del consultees[area_id]


def _add_geometry_to_condition_matches(db: Database, consultees: dict[str, Consultee]) -> None:
    """Condition matches are drawn on the map from their original geometry; those answered from the
    nearby search don't have it yet. Nearby-only consultees go without - the manage app draws them
    from its own display geometry."""
    missing = [
        area_id
        for area_id, consultee in consultees.items()
        if consultee.matched_a_condition and consultee.area.geometry_wkt is None
    ]
    for area_id, geometry_wkt in queries.fetch_geometries(db, missing).items():
        consultee = consultees[area_id]
        consultee.area = replace(consultee.area, geometry_wkt=geometry_wkt)


def _nearest_first(consultee: Consultee) -> tuple[float, str]:
    # tie-break on id: rows at the same distance (common - most conditions need an outright
    # intersection, distance 0) otherwise come back in no stable order, and the manage app's
    # static-map ETag depends on it
    return (consultee.distance_metres, consultee.area.id)
