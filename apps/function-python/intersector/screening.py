"""Run a ruleset against a project site: which consultee areas it identifies, and why."""

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from functools import partial
from typing import Literal

from intersector import queries
from intersector.database import (
    CONSULTEE_AREA,
    Database,
    UnknownDataset,
    dataset_table,
    open_database,
)
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

SiteScreenedAs = Literal["outline", "boundingBox"]


@dataclass(frozen=True)
class Screening:
    """What a ruleset run found, and what it screened against: the site's outline, or - for a site
    too detailed to screen in time - its bounding box, which finds more than the outline would."""

    consultees: list[Consultee]
    site_screened_as: SiteScreenedAs


CONDITION_CONCURRENCY = 6
"""Conditions that need their own query run this many at a time. Fully parallel produced real
deadlocks and timeouts once other work hit the same table."""


def run_ruleset(
    params: ConnectionParams,
    site_wkt: str,
    rules: list[RuleCondition],
    nearby_radius_metres: float,
    nearby_radius_metres_by_category: dict[str, float] | None = None,
    bounding_box_above_points: int | None = None,
    bounding_box: bool = False,
    dataset: str | None = None,
    timeout_seconds: float | None = None,
) -> Screening:
    """Every consultee the ruleset identifies for the site, plus every area within its category's
    nearby radius (`nearby_radius_metres_by_category`, else `nearby_radius_metres`; any category
    but Railway), nearest first.

    Each consultee appears once, with every reason it qualified: a ConditionReason for each
    condition it met, in the ruleset's order, then a NearbyReason if the nearby search found it.

    No geometry is read for the matches: some are whole counties or National Parks, and the manage
    app draws from its own display geometry.

    The site is screened against its bounding box instead of its outline when asked
    (`bounding_box`), or when its outline - simplified as the reference data is - has more than
    `bounding_box_above_points` points: the most detailed real sites take minutes to screen on a
    small database. Every area the outline would find, the box finds too, and more besides. That's
    decided before anything is screened, not after the outline proves too slow: the points are
    counted as sent, before the database simplifies them, and again after - so an outline far past
    the limit (the largest real one has over 100,000 points) costs the database nothing to simplify.

    `dataset` screens a quarter's consultee areas (2026Q4) rather than the dataset in use; one with
    no table raises UnknownDataset. A run longer than `timeout_seconds` is stopped, its queries
    with it, and raises RunTimedOut.
    """
    radius_by_category = nearby_radius_metres_by_category or {}
    search_radius = max([nearby_radius_metres, *radius_by_category.values()])
    table = dataset_table(dataset)

    def too_detailed(wkt: str) -> bool:
        return bounding_box_above_points is not None and queries.point_count(wkt) > bounding_box_above_points

    with open_database(params, table, timeout_seconds) as db:
        if table != CONSULTEE_AREA and not queries.table_exists(db, table):
            raise UnknownDataset(f"There is no {dataset} dataset")
        site_screened_as: SiteScreenedAs = "outline"
        if bounding_box or too_detailed(site_wkt):
            # the box around the outline as sent: it differs from the simplified outline's by under
            # the simplify tolerance, well inside the box's margin
            site_screened_as = "boundingBox"
            site = queries.bounding_box(site_wkt)
        else:
            site = queries.simplify(db, site_wkt)
            if too_detailed(site):
                site_screened_as = "boundingBox"
                site = queries.bounding_box(site)
        # one query out to the largest radius: the nearby reasons, and the answer to most conditions
        fetched = queries.find_areas_near(db, site, search_radius, excluded_categories=CATEGORIES_EXCLUDED_FROM_NEARBY)
        matches_by_condition = _match_conditions(
            db, site, rules, fetched, search_radius, boxed=site_screened_as == "boundingBox"
        )

        nearby = [
            (match, radius)
            for match in fetched
            if (radius := nearby_radius_for(match, nearby_radius_metres, radius_by_category)) is not None
        ]
        consultees = _combine(rules, matches_by_condition, nearby)
        _measure_unmeasured(db, site, consultees)
        return Screening(sorted(consultees.values(), key=_nearest_first), site_screened_as)


def nearby_radius_for(match: AreaMatch, default_metres: float, radius_by_category: dict[str, float]) -> float | None:
    """The radius `match` counts as nearby within, if it does: its category's radius (or the
    default), widened by the distance margin as every distance is. A radius of 0 means the category
    is never shown as nearby."""
    category = match.area.properties["consulteeCategory"] or ""
    radius = radius_by_category.get(category, default_metres)
    if radius <= 0 or match.distance_metres is None or match.distance_metres > radius + DISTANCE_MARGIN_METRES:
        return None
    return radius


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
    db: Database,
    site: str,
    rules: list[RuleCondition],
    nearby: list[AreaMatch],
    nearby_radius_metres: float,
    boxed: bool = False,
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

    query = partial(_query_condition, db, site, site_within_margin, boxed)
    with ThreadPoolExecutor(max_workers=CONDITION_CONCURRENCY) as pool:
        for rule, matches in zip(needs_query, pool.map(query, needs_query), strict=True):
            matches_by_condition[rule.id] = matches
    return matches_by_condition


def _query_condition(
    db: Database,
    site: str,
    site_within_margin: str | None,
    boxed: bool,
    rule: RuleCondition,
) -> list[AreaMatch]:
    """`rule`'s matches from its own query - a bordering condition's, for a site screened against
    its bounding box, from the rectangle around its hosts (see find_areas_bordering_box)."""
    if rule.logic_type == "intersection":
        return queries.find_areas_near(db, site, rule.buffer_metres, rule.categories)
    if not rule.host_category:
        return []
    neighbours = (
        queries.find_areas_bordering_box(db, site_within_margin, rule.host_category, rule.categories)
        if boxed
        else queries.find_areas_bordering(db, site_within_margin, rule.host_category, rule.categories)
    )
    return [AreaMatch(area, distance_metres=None) for area in neighbours]


def _combine(
    rules: list[RuleCondition],
    matches_by_condition: dict[str, list[AreaMatch]],
    nearby: list[tuple[AreaMatch, float]],
) -> dict[str, Consultee]:
    """One Consultee per area, by id, with its nearest measured distance and its reasons: conditions
    in the ruleset's order, then the nearby search."""
    consultees: dict[str, Consultee] = {}

    def add(match: AreaMatch, reason: Reason) -> None:
        consultees.setdefault(match.area.id, Consultee(match.area, match.distance_metres)).record(match, reason)

    for rule in rules:
        for match in matches_by_condition.get(rule.id, []):
            add(match, ConditionReason(rule.id))
    for match, radius in nearby:
        add(match, NearbyReason(radius))
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


def _nearest_first(consultee: Consultee) -> tuple[float, str]:
    # tie-break on id: rows at the same distance (common - most conditions need an outright
    # intersection, distance 0) otherwise come back in no stable order, and the manage app's
    # static-map ETag depends on it
    return (consultee.distance_metres, consultee.area.id)
