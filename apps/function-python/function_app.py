import hmac
import json
import logging
import os

import azure.functions as func

from querying.consultee_areas import fetch_consultee_areas
from setup_database.db import check_connection, connection_params_from_env

app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)
logger = logging.getLogger(__name__)

# The consultee-areas route reads database rows and returns them, so it must not be
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
        logger.error("consultee-areas endpoint is not configured - refusing to serve")
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
