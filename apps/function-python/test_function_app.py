import json
from unittest.mock import MagicMock, patch

import azure.functions as func

from function_app import health


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
