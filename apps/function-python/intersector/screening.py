"""Run a ruleset against a project site: which consultee areas it identifies, and why."""

import math
from collections.abc import Callable, Iterable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, replace
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

SiteScreenedAs = Literal["outline", "simplifiedOutline", "boundingBox"]


@dataclass(frozen=True)
class Screening:
    """What a ruleset run found, and what it screened against: the site's outline; for a site too
    detailed to screen in time, a simpler outline covering it, which identifies the same consultees;
    or its bounding box, which finds more than the outline would."""

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

    A site whose outline - simplified as the reference data is - has more than
    `bounding_box_above_points` points is too detailed to screen in time on a small database (the
    most detailed real sites took minutes). It's searched around a simpler outline covering it
    (queries.covering_outline) instead, and what that finds is measured from the outline itself
    wherever a condition depends on it - so the consultees a condition identifies, and their
    distances, are exactly the outline's. Only the nearby-only ones keep the covering outline's
    distance, which can be up to ~875m short: there may be a few more of them. If no covering
    outline can be made, or when asked (`bounding_box`), the site's bounding box is screened
    instead: every area the outline would find, and more besides. All this is decided before
    anything is screened, not after the outline proves too slow.

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
        cover = None
        if bounding_box:
            # the box around the outline as sent: it differs from the simplified outline's by under
            # the simplify tolerance, well inside the box's margin
            site_screened_as = "boundingBox"
            site = queries.bounding_box(site_wkt)
        else:
            site = queries.simplify(db, site_wkt)
            if too_detailed(site):
                cover = queries.covering_outline(db, site)
                site_screened_as = "simplifiedOutline" if cover else "boundingBox"
                if not cover:
                    site = queries.bounding_box(site)
        near = partial(_find_areas_near, db, site, cover)
        # one query out to the largest radius: the nearby reasons, and the answer to most conditions
        fetched = near(search_radius, excluded_categories=CATEGORIES_EXCLUDED_FROM_NEARBY, rules=rules)
        matches_by_condition = _match_conditions(
            db, site, near, rules, fetched, search_radius, boxed=site_screened_as == "boundingBox"
        )

        nearby = [
            (match, radius)
            for match in fetched
            if (radius := nearby_radius_for(match, nearby_radius_metres, radius_by_category)) is not None
        ]
        consultees = _combine(rules, matches_by_condition, nearby)
        _measure_unmeasured(db, site, consultees)
        return Screening(sorted(consultees.values(), key=_nearest_first), site_screened_as)


def _find_areas_near(
    db: Database,
    site: str,
    cover: str | None,
    radius_metres: float,
    categories: Iterable[str] = (),
    excluded_categories: Iterable[str] = (),
    rules: Iterable[RuleCondition] = (),
) -> list[AreaMatch]:
    """queries.find_areas_near around the site - or, given a covering outline, around that, then
    measured from the site wherever one of `rules` (or the radius, with no rules) depends on it.

    Measuring from the covering outline is what makes it quicker: a detailed site's outline is slow
    to measure from, and the nearby search measures everything out to 20km. Distances from it are
    never further than from the site, so an area a condition could match from the site, it can
    match from the cover - those are measured again from the site (a few hundred, of about a
    thousand) and kept only if they're in reach after all. The rest stay `approximate`."""
    if cover is None:
        return queries.find_areas_near(db, site, radius_metres, categories, excluded_categories)
    found = queries.find_areas_near(db, cover, radius_metres, categories, excluded_categories)
    rules = [rule for rule in rules if rule.logic_type == "intersection"]

    depended_on = {
        match.area.id
        for match in found
        if not rules or any(meets_intersection_condition(match, rule) for rule in rules)
    }
    distances = queries.measure_distances(db, site, list(depended_on))
    limit = radius_metres + DISTANCE_MARGIN_METRES
    matches: list[AreaMatch] = []
    for match in found:
        if match.area.id not in depended_on:
            matches.append(replace(match, approximate=True))
        # absent if deleted between queries (a reference data reload mid-request)
        elif distances.get(match.area.id, math.inf) <= limit:
            matches.append(replace(match, distance_metres=distances[match.area.id]))
    return sorted(matches, key=lambda match: match.distance_metres)


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
    near: Callable[..., list[AreaMatch]],
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

    query = partial(_query_condition, db, near, site_within_margin, boxed)
    with ThreadPoolExecutor(max_workers=CONDITION_CONCURRENCY) as pool:
        for rule, matches in zip(needs_query, pool.map(query, needs_query), strict=True):
            matches_by_condition[rule.id] = matches
    return matches_by_condition


def _query_condition(
    db: Database,
    near: Callable[..., list[AreaMatch]],
    site_within_margin: str | None,
    boxed: bool,
    rule: RuleCondition,
) -> list[AreaMatch]:
    """`rule`'s matches from its own query (`near` - see _find_areas_near) - a bordering
    condition's, for a site screened against its bounding box, from the rectangle around its hosts
    (see find_areas_bordering_box)."""
    if rule.logic_type == "intersection":
        return near(rule.buffer_metres, rule.categories, rules=[rule])
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
        consultees.setdefault(match.area.id, Consultee(match.area, None)).record(match, reason)

    for rule in rules:
        for match in matches_by_condition.get(rule.id, []):
            add(match, ConditionReason(rule.id))
    for match, radius in nearby:
        add(match, NearbyReason(radius))
    return consultees


def _measure_unmeasured(db: Database, site: str, consultees: dict[str, Consultee]) -> None:
    """Give a distance to consultees only a bordering condition found - most were also found by a
    query that measured them - and measure from the site those a condition identified with only an
    approximate distance (a bordering match, also nearby by its covering outline's): a NearbyReason
    the site's own distance is past goes. One query for all of them, rather than one per host."""
    unmeasured = [
        area_id
        for area_id, consultee in consultees.items()
        if consultee.distance_metres is None
        or (consultee.approximate and any(isinstance(reason, ConditionReason) for reason in consultee.reasons))
    ]
    distances = queries.measure_distances(db, site, unmeasured)
    for area_id in unmeasured:
        consultee = consultees[area_id]
        if area_id not in distances:
            # deleted between queries (a reference data reload mid-request) - nothing left to notify
            del consultees[area_id]
            continue
        consultee.distance_metres = distances[area_id]
        consultee.approximate = False
        consultee.reasons = [
            reason
            for reason in consultee.reasons
            if not isinstance(reason, NearbyReason)
            or consultee.distance_metres <= reason.radius_metres + DISTANCE_MARGIN_METRES
        ]


def _nearest_first(consultee: Consultee) -> tuple[float, str]:
    # tie-break on id: rows at the same distance (common - most conditions need an outright
    # intersection, distance 0) otherwise come back in no stable order, and the manage app's
    # static-map ETag depends on it
    return (consultee.distance_metres, consultee.area.id)
