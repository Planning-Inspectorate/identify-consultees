import json
import logging

import azure.functions as func

from querying.consultee_areas import fetch_consultee_areas
from setup_database.db import connection_params_from_env

app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)
logger = logging.getLogger(__name__)


@app.route(route="consultee-areas")
def consultee_areas(req: func.HttpRequest) -> func.HttpResponse:
    logger.info("consultee-areas function processed a request")

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
