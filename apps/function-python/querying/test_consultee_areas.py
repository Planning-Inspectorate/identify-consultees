import json

from querying.consultee_areas import fetch_consultee_areas

# connection_params fixture (skips if no DB reachable) lives in conftest.py, shared with
# setup_database/test_db.py's check_connection tests


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
