import json

import pymssql
import pytest

from querying.consultee_areas import fetch_consultee_areas
from setup_database.db import connection_params_from_env


@pytest.fixture
def connection_params():
    """Skip the test (not fail) when no database is reachable, matching the
    pattern used for the Node geometry tests in packages/database.
    """
    try:
        params = connection_params_from_env()
        probe = pymssql.connect(
            server=params.server,
            port=params.port,
            database=params.database,
            user=params.user,
            password=params.password,
        )
        probe.close()
    except Exception as error:  # noqa: BLE001 - any connection failure should just skip the test
        pytest.skip(f"SQL Server database not available: {error}")
    return params


def test_fetch_consultee_areas_returns_a_list(connection_params):
    rows = fetch_consultee_areas(connection_params)
    assert isinstance(rows, list)


def test_fetch_consultee_areas_rows_are_json_serialisable(connection_params):
    # pymssql returns UNIQUEIDENTIFIER as uuid.UUID and DATETIME2 as datetime - neither is
    # JSON-serializable as-is, and this is returned straight to an HTTP response as JSON
    rows = fetch_consultee_areas(connection_params)
    json.dumps(rows)
    for row in rows:
        assert isinstance(row["id"], str)


def test_fetch_consultee_areas_respects_limit(connection_params):
    rows = fetch_consultee_areas(connection_params, limit=1)
    assert len(rows) <= 1
