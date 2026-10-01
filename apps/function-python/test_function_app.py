import json
from unittest.mock import MagicMock, patch

import azure.functions as func

from function_app import consultee_areas, health

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
