"""The run-ruleset route's JSON contract: validating the request, and the shape of the response.

See kt-docs/screening-service.md. The manage app's side is apps/manage/src/app/ruleset-runner.ts.
"""

import re
from dataclasses import dataclass

from intersector.models import (
    LOGIC_TYPES,
    ConditionReason,
    Consultee,
    Reason,
    RuleCondition,
)

# generous bounds - they're here to reject a malformed or abusive request before it reaches the
# database, not to second-guess real rulesets (the example has ~30 conditions; the largest site
# boundaries run to a few hundred KB of WKT)
MAX_SITE_WKT_LENGTH = 10_000_000
MAX_RULES = 500
MAX_CATEGORIES_PER_RULE = 50
MAX_DISTANCE_METRES = 500_000
MAX_STRING_LENGTH = 200
MAX_NEARBY_CATEGORIES = 200
MAX_TIMEOUT_SECONDS = 600


class BadRequest(ValueError):
    """The request body isn't a valid run-ruleset request. The message is safe to return."""


@dataclass(frozen=True)
class RunRulesetRequest:
    site_wkt: str
    rules: list[RuleCondition]
    nearby_radius_metres: float
    nearby_radius_metres_by_category: dict[str, float]
    """A nearby radius for particular categories, overriding nearby_radius_metres for them."""
    bounding_box_above_points: int | None = None
    """Screen a site whose simplified outline has more points than this against its bounding box."""
    bounding_box: bool = False
    """Screen the site against its bounding box whatever its detail."""
    dataset: str | None = None
    """A quarter's consultee areas to screen (2026Q4), rather than the dataset in use."""
    timeout_seconds: float | None = None
    """How long the run may take before it's stopped - none, no limit."""


def parse_run_ruleset_request(body: object) -> RunRulesetRequest:
    """Validate a decoded request body: `{siteWkt, rules: [{id, logicType, categories,
    bufferMetres?, hostCategory?}], nearbyRadiusMetres, nearbyRadiusMetresByCategory?,
    boundingBoxAbovePoints?, boundingBox?, dataset?, timeoutSeconds?}` (boundingBox defaults to
    false; with no boundingBoxAbovePoints the outline is always screened; with no dataset, the
    dataset in use; with no timeoutSeconds, no time limit). Other fields are ignored. Raises
    BadRequest."""
    if not isinstance(body, dict):
        raise BadRequest("request body must be a JSON object")

    site_wkt = body.get("siteWkt")
    if not isinstance(site_wkt, str) or not site_wkt.strip() or len(site_wkt) > MAX_SITE_WKT_LENGTH:
        raise BadRequest("siteWkt must be a WKT string")
    rules = body.get("rules")
    if not isinstance(rules, list) or len(rules) > MAX_RULES:
        raise BadRequest(f"rules must be a list of at most {MAX_RULES} conditions")

    return RunRulesetRequest(
        site_wkt=site_wkt,
        rules=[_parse_rule(rule) for rule in rules],
        nearby_radius_metres=_distance(body.get("nearbyRadiusMetres"), "nearbyRadiusMetres"),
        nearby_radius_metres_by_category=_radius_by_category(body.get("nearbyRadiusMetresByCategory", {})),
        bounding_box_above_points=_point_limit(body.get("boundingBoxAbovePoints")),
        bounding_box=_boolean(body.get("boundingBox", False), "boundingBox"),
        dataset=_dataset(body.get("dataset")),
        timeout_seconds=_timeout(body.get("timeoutSeconds")),
    )


def _timeout(value: object) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int | float) or not 0 < value <= MAX_TIMEOUT_SECONDS:
        raise BadRequest(f"timeoutSeconds must be a number of seconds, more than 0 and at most {MAX_TIMEOUT_SECONDS}")
    return float(value)


def _dataset(value: object) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or not re.match(r"^\d{4}Q[1-4]$", value):
        raise BadRequest("dataset must be a quarter, as in 2026Q4")
    return value


def _point_limit(value: object) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise BadRequest("boundingBoxAbovePoints must be a whole number of points, at least 1")
    return value


def _boolean(value: object, name: str) -> bool:
    if not isinstance(value, bool):
        raise BadRequest(f"{name} must be true or false")
    return value


def _radius_by_category(raw: object) -> dict[str, float]:
    if not isinstance(raw, dict) or len(raw) > MAX_NEARBY_CATEGORIES:
        raise BadRequest(f"nearbyRadiusMetresByCategory must be an object of at most {MAX_NEARBY_CATEGORIES} categories")
    return {
        _string(category, "nearby category"): _distance(radius, "nearbyRadiusMetresByCategory radius")
        for category, radius in raw.items()
    }


def _parse_rule(raw: object) -> RuleCondition:
    if not isinstance(raw, dict):
        raise BadRequest("each rule must be an object")
    logic_type = raw.get("logicType")
    if logic_type not in LOGIC_TYPES:
        raise BadRequest("rule logicType must be 'intersection' or 'bordering'")
    categories = raw.get("categories")
    if not isinstance(categories, list) or len(categories) > MAX_CATEGORIES_PER_RULE:
        raise BadRequest("rule categories must be a list")
    host_category = raw.get("hostCategory")
    return RuleCondition(
        id=_string(raw.get("id"), "rule id"),
        logic_type=logic_type,
        categories=tuple(_string(category, "rule category") for category in categories),
        buffer_metres=_distance(raw.get("bufferMetres", 0), "rule bufferMetres"),
        host_category=None if host_category is None else _string(host_category, "rule hostCategory"),
    )


def _distance(value: object, name: str) -> float:
    # bool is an int subclass - reject it too
    if isinstance(value, bool) or not isinstance(value, int | float) or not 0 <= value <= MAX_DISTANCE_METRES:
        raise BadRequest(f"{name} must be a number of metres between 0 and {MAX_DISTANCE_METRES}")
    return float(value)


def _string(value: object, name: str) -> str:
    if not isinstance(value, str) or not value or len(value) > MAX_STRING_LENGTH:
        raise BadRequest(f"{name} must be a non-empty string")
    return value


def consultees_json(consultees: list[Consultee], site_screened_as: str = "outline") -> dict:
    """The response body: `{consultees: [{feature: {id, properties}, distanceMetres, reasons}],
    siteScreenedAs}` - siteScreenedAs `outline` or `boundingBox` (see run_ruleset). No geometry: the
    manage app draws from its own display geometry."""
    return {
        "consultees": [_consultee_json(consultee) for consultee in consultees],
        "siteScreenedAs": site_screened_as,
    }


def _consultee_json(consultee: Consultee) -> dict:
    return {
        "feature": {"id": consultee.area.id, "properties": consultee.area.properties},
        "distanceMetres": consultee.distance_metres,
        "reasons": [_reason_json(reason) for reason in consultee.reasons],
    }


def _reason_json(reason: Reason) -> dict:
    if isinstance(reason, ConditionReason):
        return {"type": "condition", "conditionId": reason.condition_id}
    return {"type": "nearby", "radiusMetres": reason.radius_metres}
