"""The run-ruleset route's JSON contract: validating the request, and the shape of the response.

See kt-docs/screening-service.md. The manage app's side is apps/manage/src/app/ruleset-runner.ts.
"""

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


class BadRequest(ValueError):
    """The request body isn't a valid run-ruleset request. The message is safe to return."""


@dataclass(frozen=True)
class RunRulesetRequest:
    site_wkt: str
    rules: list[RuleCondition]
    nearby_radius_metres: float


def parse_run_ruleset_request(body: object) -> RunRulesetRequest:
    """Validate a decoded request body: `{siteWkt, rules: [{id, logicType, categories,
    bufferMetres?, hostCategory?}], nearbyRadiusMetres}`. Raises BadRequest."""
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
    )


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


def consultees_json(consultees: list[Consultee]) -> dict:
    """The response body: `{consultees: [{feature: {id, properties, geometryWkt?}, distanceMetres,
    reasons}]}`."""
    return {"consultees": [_consultee_json(consultee) for consultee in consultees]}


def _consultee_json(consultee: Consultee) -> dict:
    feature = {"id": consultee.area.id, "properties": consultee.area.properties}
    if consultee.area.geometry_wkt is not None:
        feature["geometryWkt"] = consultee.area.geometry_wkt
    return {
        "feature": feature,
        "distanceMetres": consultee.distance_metres,
        "reasons": [_reason_json(reason) for reason in consultee.reasons],
    }


def _reason_json(reason: Reason) -> dict:
    if isinstance(reason, ConditionReason):
        return {"type": "condition", "conditionId": reason.condition_id}
    return {"type": "nearby", "radiusMetres": reason.radius_metres}
