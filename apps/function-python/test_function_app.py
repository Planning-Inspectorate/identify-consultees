import json
from unittest.mock import MagicMock, patch

import azure.functions as func
import pytest

from function_app import consultee_areas, health, run_ruleset_route
from querying.rulesets import AreaMatch, RuleCondition, RunRulesetResult

API_KEY = "test-shared-key"


def _request(headers: dict | None = None) -> MagicMock:
    req = MagicMock(spec=func.HttpRequest)
    req.headers = headers or {}
    return req


def test_consultee_areas_rejects_requests_when_no_api_key_is_configured():
    # fail closed: an unset CONSULTEE_AREAS_API_KEY must mean the route refuses to
    # serve at all, not that it serves anonymously
    with patch.dict("os.environ", {}, clear=True):
        response = consultee_areas(_request())

    assert response.status_code == 500
    assert json.loads(response.get_body()) == {"error": "Endpoint is not configured"}


def test_consultee_areas_rejects_a_missing_api_key_header():
    with patch.dict("os.environ", {"CONSULTEE_AREAS_API_KEY": API_KEY}):
        response = consultee_areas(_request())

    assert response.status_code == 401
    assert json.loads(response.get_body()) == {"error": "Unauthorised"}


def test_consultee_areas_rejects_an_incorrect_api_key():
    with patch.dict("os.environ", {"CONSULTEE_AREAS_API_KEY": API_KEY}):
        response = consultee_areas(_request({"x-api-key": "wrong-key"}))

    assert response.status_code == 401


def test_consultee_areas_serves_the_query_with_the_correct_api_key():
    rows = [{"id": "abc", "consultee": "Example"}]
    with (
        patch.dict("os.environ", {"CONSULTEE_AREAS_API_KEY": API_KEY}),
        patch("function_app.connection_params_from_env", return_value=object()),
        patch("function_app.fetch_consultee_areas", return_value=rows),
    ):
        response = consultee_areas(_request({"x-api-key": API_KEY}))

    assert response.status_code == 200
    assert json.loads(response.get_body()) == {"rows": rows}


def test_consultee_areas_returns_a_generic_error_when_the_query_fails():
    # the real exception carries connection detail - only the generic message may
    # reach the response
    with (
        patch.dict("os.environ", {"CONSULTEE_AREAS_API_KEY": API_KEY}),
        patch("function_app.connection_params_from_env", return_value=object()),
        patch(
            "function_app.fetch_consultee_areas",
            side_effect=RuntimeError("internal detail: server=sql.internal password=hunter2"),
        ),
    ):
        response = consultee_areas(_request({"x-api-key": API_KEY}))

    assert response.status_code == 500
    assert json.loads(response.get_body()) == {"error": "Failed to query the database"}
    assert "password" not in response.get_body().decode()


def _ruleset_request(body, headers: dict | None = None) -> MagicMock:
    req = _request({"x-api-key": API_KEY} if headers is None else headers)
    if isinstance(body, Exception):
        req.get_json.side_effect = body
    else:
        req.get_json.return_value = body
    return req


VALID_BODY = {
    "siteWkt": "POINT(0 0)",
    "nearbyRadiusMetres": 20_000,
    "rules": [
        {"id": "hospital", "logicType": "intersection", "categories": ["Hospital"], "bufferMetres": 10_000},
        {"id": "parish", "logicType": "bordering", "categories": ["Parish Council"], "hostCategory": "Parish Council"},
    ],
}


def test_run_ruleset_shares_the_consultee_areas_api_key_check():
    with patch.dict("os.environ", {}, clear=True):
        assert run_ruleset_route(_ruleset_request(VALID_BODY)).status_code == 500
    with patch.dict("os.environ", {"CONSULTEE_AREAS_API_KEY": API_KEY}):
        assert run_ruleset_route(_ruleset_request(VALID_BODY, {"x-api-key": "wrong"})).status_code == 401


def test_run_ruleset_runs_the_posted_conditions_and_returns_matches_and_nearby():
    area = {"id": "a", "properties": {"consulteeCategory": "Hospital", "consultee": "Example"}}
    result = RunRulesetResult(
        matches=[AreaMatch({**area, "geometryWkt": "POINT (0 0)"}, 12.5)],
        all_nearby=[AreaMatch(area, 12.5)],
    )
    params = object()
    with (
        patch.dict("os.environ", {"CONSULTEE_AREAS_API_KEY": API_KEY}),
        patch("function_app.connection_params_from_env", return_value=params),
        patch("function_app.run_ruleset", return_value=result) as run,
    ):
        response = run_ruleset_route(_ruleset_request(VALID_BODY))

    assert response.status_code == 200
    assert json.loads(response.get_body()) == {
        "matches": [{"feature": {**area, "geometryWkt": "POINT (0 0)"}, "distanceMetres": 12.5}],
        "allNearby": [{"feature": area, "distanceMetres": 12.5}],
    }
    run.assert_called_once_with(
        params,
        "POINT(0 0)",
        [
            RuleCondition(id="hospital", logic_type="intersection", categories=("Hospital",), buffer_metres=10_000),
            RuleCondition(
                id="parish", logic_type="bordering", categories=("Parish Council",), host_category="Parish Council"
            ),
        ],
        20_000,
    )


@pytest.mark.parametrize(
    "body",
    [
        ValueError("not JSON"),
        ["not", "an", "object"],
        {**VALID_BODY, "siteWkt": ""},
        {**VALID_BODY, "siteWkt": 42},
        {**VALID_BODY, "nearbyRadiusMetres": -1},
        {**VALID_BODY, "nearbyRadiusMetres": True},
        {**VALID_BODY, "nearbyRadiusMetres": 10_000_000},
        {**VALID_BODY, "rules": "all of them"},
        {**VALID_BODY, "rules": [{"id": "x", "logicType": "nearest", "categories": []}]},
        {**VALID_BODY, "rules": [{"id": "x", "logicType": "intersection", "categories": "Hospital"}]},
        {**VALID_BODY, "rules": [{"id": "x", "logicType": "intersection", "categories": [7]}]},
        {**VALID_BODY, "rules": [{"logicType": "intersection", "categories": []}]},
        {**VALID_BODY, "rules": [{"id": "x", "logicType": "intersection", "categories": [], "bufferMetres": "5"}]},
    ],
)
def test_run_ruleset_rejects_a_malformed_request_before_touching_the_database(body):
    with (
        patch.dict("os.environ", {"CONSULTEE_AREAS_API_KEY": API_KEY}),
        patch("function_app.run_ruleset") as run,
    ):
        response = run_ruleset_route(_ruleset_request(body))

    assert response.status_code == 400
    assert "error" in json.loads(response.get_body())
    run.assert_not_called()


def test_run_ruleset_returns_a_generic_error_when_the_run_fails():
    with (
        patch.dict("os.environ", {"CONSULTEE_AREAS_API_KEY": API_KEY}),
        patch("function_app.connection_params_from_env", return_value=object()),
        patch("function_app.run_ruleset", side_effect=RuntimeError("server=sql.internal password=hunter2")),
    ):
        response = run_ruleset_route(_ruleset_request(VALID_BODY))

    assert response.status_code == 500
    assert json.loads(response.get_body()) == {"error": "Failed to run the ruleset"}
    assert "password" not in response.get_body().decode()


def test_health_reports_ok_database_when_connection_succeeds():
    req = MagicMock(spec=func.HttpRequest)
    with (
        patch("function_app.connection_params_from_env", return_value=object()),
        patch("function_app.check_connection"),
    ):
        response = health(req)

    assert response.status_code == 200
    assert response.mimetype == "application/json"
    assert json.loads(response.get_body()) == {"status": "OK", "database": "OK"}


def test_health_reports_error_database_when_connection_fails():
    req = MagicMock(spec=func.HttpRequest)
    with (
        patch("function_app.connection_params_from_env", return_value=object()),
        patch("function_app.check_connection", side_effect=RuntimeError("unreachable")),
    ):
        response = health(req)

    assert response.status_code == 200
    assert json.loads(response.get_body()) == {"status": "OK", "database": "ERROR"}
