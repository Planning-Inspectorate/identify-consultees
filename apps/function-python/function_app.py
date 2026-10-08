import hmac
import json
import logging
import os

import azure.functions as func

from querying.consultee_areas import fetch_consultee_areas
from querying.rulesets import RuleCondition, run_ruleset
from setup_database.db import check_connection, connection_params_from_env

app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)
logger = logging.getLogger(__name__)

# The consultee-areas and run-ruleset routes read database rows and returns them, so it must not be
# callable by just anything on the VNet even though the Function App itself is only
# reachable via its private endpoint (public_network_access_enabled = false - see
# infrastructure/app-function.tf). AuthLevel stays ANONYMOUS because Azure's own
# function-key mechanism can't be wired into the calling app's settings without a
# deploy-ordering circular dependency; instead both sides share a plain API key via
# Key Vault (CONSULTEE_AREAS_API_KEY here, PYTHON_FUNCTION_API_KEY in the manage app).
# Fail closed: no configured key means the data route refuses to serve at all.
API_KEY_ENV_VAR = "CONSULTEE_AREAS_API_KEY"
API_KEY_HEADER = "x-api-key"


def _check_api_key(req: func.HttpRequest) -> func.HttpResponse | None:
    """Return an error response when the request isn't authorised, else None."""
    expected = os.environ.get(API_KEY_ENV_VAR, "")
    if not expected:
        # don't put the setting name in the log line - a key/secret-looking token in a
        # log call trips clear-text-logging code scanning; the message plus this code
        # location identifies the problem (the missing setting is API_KEY_ENV_VAR)
        logger.error("data endpoint is not configured - refusing to serve")
        return func.HttpResponse(
            json.dumps({"error": "Endpoint is not configured"}),
            status_code=500,
            mimetype="application/json",
        )

    provided = req.headers.get(API_KEY_HEADER, "")
    if not provided or not hmac.compare_digest(provided, expected):
        return func.HttpResponse(
            json.dumps({"error": "Unauthorised"}),
            status_code=401,
            mimetype="application/json",
        )
    return None


@app.route(route="health")
def health(req: func.HttpRequest) -> func.HttpResponse:
    """Always returns 200 - the database field reports whether it's actually
    reachable, matching the Node app's own /health convention (see
    @planning-inspectorate/core's monitoring controller).
    """
    try:
        check_connection(connection_params_from_env())
        database_status = "OK"
    except Exception:
        logger.exception("Health check: database connection failed")
        database_status = "ERROR"

    return func.HttpResponse(
        json.dumps({"status": "OK", "database": database_status}),
        mimetype="application/json",
    )


@app.route(route="consultee-areas")
def consultee_areas(req: func.HttpRequest) -> func.HttpResponse:
    logger.info("consultee-areas function processed a request")

    auth_error = _check_api_key(req)
    if auth_error is not None:
        return auth_error

    try:
        params = connection_params_from_env()
        rows = fetch_consultee_areas(params)
    except Exception:
        logger.exception("Failed to query consultee_area")
        return func.HttpResponse(
            json.dumps({"error": "Failed to query the database"}),
            status_code=500,
            mimetype="application/json",
        )

    return func.HttpResponse(json.dumps({"rows": rows}), mimetype="application/json")


# generous bounds - they're here to reject a malformed or abusive request before it reaches the
# database, not to second-guess real rulesets (the example has ~30 conditions; the largest site
# boundaries run to a few hundred KB of WKT)
_MAX_SITE_WKT_LENGTH = 10_000_000
_MAX_RULES = 500
_MAX_CATEGORIES_PER_RULE = 50
_MAX_DISTANCE_METRES = 500_000
_LOGIC_TYPES = ("intersection", "bordering")


class _BadRequest(ValueError):
    pass


def _distance(value: object, name: str) -> float:
    # bool is an int subclass - reject it too
    if isinstance(value, bool) or not isinstance(value, int | float) or not 0 <= value <= _MAX_DISTANCE_METRES:
        raise _BadRequest(f"{name} must be a number of metres between 0 and {_MAX_DISTANCE_METRES}")
    return float(value)


def _short_string(value: object, name: str) -> str:
    if not isinstance(value, str) or not value or len(value) > 200:
        raise _BadRequest(f"{name} must be a non-empty string")
    return value


def _parse_rule(raw: object) -> RuleCondition:
    if not isinstance(raw, dict):
        raise _BadRequest("each rule must be an object")
    logic_type = raw.get("logicType")
    if logic_type not in _LOGIC_TYPES:
        raise _BadRequest("rule logicType must be 'intersection' or 'bordering'")
    categories = raw.get("categories")
    if not isinstance(categories, list) or len(categories) > _MAX_CATEGORIES_PER_RULE:
        raise _BadRequest("rule categories must be a list")
    host_category = raw.get("hostCategory")
    return RuleCondition(
        id=_short_string(raw.get("id"), "rule id"),
        logic_type=logic_type,
        categories=tuple(_short_string(category, "rule category") for category in categories),
        buffer_metres=_distance(raw.get("bufferMetres", 0), "rule bufferMetres"),
        host_category=None if host_category is None else _short_string(host_category, "rule hostCategory"),
    )


def _parse_run_ruleset_request(req: func.HttpRequest) -> tuple[str, list[RuleCondition], float]:
    try:
        body = req.get_json()
    except ValueError as error:
        raise _BadRequest("request body must be JSON") from error
    if not isinstance(body, dict):
        raise _BadRequest("request body must be a JSON object")

    site_wkt = body.get("siteWkt")
    if not isinstance(site_wkt, str) or not site_wkt.strip() or len(site_wkt) > _MAX_SITE_WKT_LENGTH:
        raise _BadRequest("siteWkt must be a WKT string")
    rules = body.get("rules")
    if not isinstance(rules, list) or len(rules) > _MAX_RULES:
        raise _BadRequest(f"rules must be a list of at most {_MAX_RULES} conditions")

    return (
        site_wkt,
        [_parse_rule(rule) for rule in rules],
        _distance(body.get("nearbyRadiusMetres"), "nearbyRadiusMetres"),
    )


def _consultee_json(match) -> dict:
    area = match.area
    feature = {"id": area["id"], "properties": area["properties"]}
    if "geometryWkt" in area:
        feature["geometryWkt"] = area["geometryWkt"]
    return {"feature": feature, "distanceMetres": match.distance_metres, "reasons": match.reasons}


@app.route(route="run-ruleset", methods=["POST"])
def run_ruleset_route(req: func.HttpRequest) -> func.HttpResponse:
    """Run a ruleset's conditions against a project site - the manage app's consultee intersection
    logic. Body: `{siteWkt, rules: [{id, logicType, categories, bufferMetres?, hostCategory?}],
    nearbyRadiusMetres}`. Returns `{consultees}`, each with its reasons - see
    kt-docs/api-and-data-contracts.md.
    """
    auth_error = _check_api_key(req)
    if auth_error is not None:
        return auth_error

    try:
        site_wkt, rules, nearby_radius_metres = _parse_run_ruleset_request(req)
    except _BadRequest as error:
        return func.HttpResponse(json.dumps({"error": str(error)}), status_code=400, mimetype="application/json")

    logger.info("run-ruleset: %d conditions, nearby radius %sm", len(rules), nearby_radius_metres)
    try:
        result = run_ruleset(connection_params_from_env(), site_wkt, rules, nearby_radius_metres)
    except Exception:
        logger.exception("Failed to run the ruleset")
        return func.HttpResponse(
            json.dumps({"error": "Failed to run the ruleset"}),
            status_code=500,
            mimetype="application/json",
        )

    return func.HttpResponse(
        json.dumps({"consultees": [_consultee_json(match) for match in result.consultees]}),
        mimetype="application/json",
    )
