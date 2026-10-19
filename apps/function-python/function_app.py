import hmac
import json
import logging
import os
import uuid

import azure.functions as func

from cbos.boundaries import (
    BoundaryFileNotFound,
    fetch_boundary_geojson,
    list_boundary_files,
)
from cbos.config import CbosNotConfigured, cbos_config_from_env
from cbos.connection_check import check_cbos, default_credential
from cbos.gis_files import GisFileNotFound, list_gis_files, read_gis_file
from intersector.api import BadRequest, consultees_json, parse_run_ruleset_request
from intersector.screening import run_ruleset
from querying.consultee_areas import fetch_consultee_areas
from setup_database.db import check_connection, connection_params_from_env

app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)
logger = logging.getLogger(__name__)

# The consultee-areas and run-ruleset routes return database rows, so they mustn't be callable by
# just anything on the VNet, even though the Function App is only reachable through its private
# endpoint (public_network_access_enabled = false - see infrastructure/app-function.tf). AuthLevel
# stays ANONYMOUS because Azure's own function keys can't be wired into the calling app's settings
# without a deploy-ordering circular dependency; instead both sides share a plain API key via Key
# Vault (CONSULTEE_AREAS_API_KEY here, PYTHON_FUNCTION_API_KEY in the manage app). Fail closed: no
# configured key means the data routes refuse to serve at all.
API_KEY_ENV_VAR = "CONSULTEE_AREAS_API_KEY"
API_KEY_HEADER = "x-api-key"


def _json_response(body: dict, status_code: int = 200) -> func.HttpResponse:
    return func.HttpResponse(json.dumps(body), status_code=status_code, mimetype="application/json")


def _check_api_key(req: func.HttpRequest) -> func.HttpResponse | None:
    """Return an error response when the request isn't authorised, else None."""
    expected = os.environ.get(API_KEY_ENV_VAR, "")
    if not expected:
        # don't put the setting name in the log line - a key/secret-looking token in a
        # log call trips clear-text-logging code scanning; the message plus this code
        # location identifies the problem (the missing setting is API_KEY_ENV_VAR)
        logger.error("data endpoint is not configured - refusing to serve")
        return _json_response({"error": "Endpoint is not configured"}, 500)

    provided = req.headers.get(API_KEY_HEADER, "")
    if not provided or not hmac.compare_digest(provided, expected):
        return _json_response({"error": "Unauthorised"}, 401)
    return None


def _route_document(req: func.HttpRequest) -> tuple[str, int]:
    """The {guid}/{version} a CBOS file route names, or ValueError."""
    return str(uuid.UUID(req.route_params.get("guid", ""))), int(req.route_params.get("version", ""))


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

    return _json_response({"status": "OK", "database": database_status})


@app.route(route="cbos/health")
def cbos_health(req: func.HttpRequest) -> func.HttpResponse:
    """Whether this app can reach CBOS's database and document storage as its own identity (see
    cbos/). Keyed, unlike /health: its errors name CBOS's servers and what access is missing."""
    auth_error = _check_api_key(req)
    if auth_error is not None:
        return auth_error

    try:
        config = cbos_config_from_env()
    except CbosNotConfigured as error:
        return _json_response({"status": "ERROR", "error": str(error)}, 500)

    result = check_cbos(config, default_credential())
    if result["status"] != "OK":
        logger.error("CBOS connection check failed: %s", result)
    return _json_response(result, 200 if result["status"] == "OK" else 503)


@app.route(route="cbos/boundary-files")
def cbos_boundary_files(req: func.HttpRequest) -> func.HttpResponse:
    """Every case boundary file CBOS has converted to GeoJSON - see cbos/boundaries.py."""
    auth_error = _check_api_key(req)
    if auth_error is not None:
        return auth_error

    try:
        files = list_boundary_files(cbos_config_from_env(), default_credential())
    except CbosNotConfigured as error:
        return _json_response({"error": str(error)}, 500)
    except Exception:
        logger.exception("Failed to list CBOS boundary files")
        return _json_response({"error": "Failed to list CBOS boundary files"}, 500)

    return _json_response({"files": [file.as_json() for file in files]})


@app.route(route="cbos/boundary-files/{guid}/{version:int}")
def cbos_boundary_file(req: func.HttpRequest) -> func.HttpResponse:
    """One boundary file's GeoJSON FeatureCollection, as CBOS converted it."""
    auth_error = _check_api_key(req)
    if auth_error is not None:
        return auth_error

    try:
        document_guid, version = _route_document(req)
    except ValueError:
        return _json_response({"error": "guid must be a UUID and version a number"}, 400)

    try:
        collection = fetch_boundary_geojson(cbos_config_from_env(), default_credential(), document_guid, version)
    except CbosNotConfigured as error:
        return _json_response({"error": str(error)}, 500)
    except BoundaryFileNotFound:
        return _json_response({"error": "Boundary file not found"}, 404)
    except Exception:
        logger.exception("Failed to fetch CBOS boundary file %s version %s", document_guid, version)
        return _json_response({"error": "Failed to fetch the boundary file"}, 500)

    return _json_response(collection)


@app.route(route="cbos/gis-files")
def cbos_gis_files(req: func.HttpRequest) -> func.HttpResponse:
    """Every file in CBOS's GIS Shapefiles folders, every version - for debugging the boundary
    import (see cbos/gis_files.py)."""
    auth_error = _check_api_key(req)
    if auth_error is not None:
        return auth_error

    try:
        listing = list_gis_files(cbos_config_from_env(), default_credential())
    except CbosNotConfigured as error:
        return _json_response({"error": str(error)}, 500)
    except Exception:
        logger.exception("Failed to list CBOS GIS files")
        return _json_response({"error": "Failed to list CBOS GIS files"}, 500)

    return _json_response(listing)


@app.route(route="cbos/gis-files/{guid}/{version:int}")
def cbos_gis_file(req: func.HttpRequest) -> func.HttpResponse:
    """One GIS file's details and what its blob holds, or why it couldn't be read."""
    auth_error = _check_api_key(req)
    if auth_error is not None:
        return auth_error

    try:
        document_guid, version = _route_document(req)
    except ValueError:
        return _json_response({"error": "guid must be a UUID and version a number"}, 400)

    try:
        result = read_gis_file(cbos_config_from_env(), default_credential(), document_guid, version)
    except CbosNotConfigured as error:
        return _json_response({"error": str(error)}, 500)
    except GisFileNotFound:
        return _json_response({"error": "GIS file not found"}, 404)
    except Exception:
        logger.exception("Failed to read CBOS GIS file %s version %s", document_guid, version)
        return _json_response({"error": "Failed to read the GIS file"}, 500)

    return _json_response(result)


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
        return _json_response({"error": "Failed to query the database"}, 500)

    return _json_response({"rows": rows})


def _json_body(req: func.HttpRequest) -> object:
    try:
        return req.get_json()
    except ValueError as error:
        raise BadRequest("request body must be JSON") from error


@app.route(route="run-ruleset", methods=["POST"])
def run_ruleset_route(req: func.HttpRequest) -> func.HttpResponse:
    """Run a ruleset against a project site - the manage app's consultee intersection logic. See
    intersector/api.py for the request and response, and intersector/screening.py for the logic."""
    auth_error = _check_api_key(req)
    if auth_error is not None:
        return auth_error

    try:
        request = parse_run_ruleset_request(_json_body(req))
    except BadRequest as error:
        return _json_response({"error": str(error)}, 400)

    logger.info(
        "run-ruleset: %d conditions, nearby radius %sm, geometry %s",
        len(request.rules),
        request.nearby_radius_metres,
        "included" if request.include_geometry else "left out",
    )
    try:
        consultees = run_ruleset(
            connection_params_from_env(),
            request.site_wkt,
            request.rules,
            request.nearby_radius_metres,
            request.nearby_radius_metres_by_category,
            with_geometry=request.include_geometry,
        )
    except Exception:
        logger.exception("Failed to run the ruleset")
        return _json_response({"error": "Failed to run the ruleset"}, 500)

    return _json_response(consultees_json(consultees))
