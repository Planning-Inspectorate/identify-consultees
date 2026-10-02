import json

import pytest

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


# limit is interpolated into the TOP clause (it can't be parameterised), so anything
# that isn't a plain int in range must be rejected before it reaches the SQL - these
# tests don't need a database because they fail before connecting
@pytest.mark.parametrize("limit", [True, "50", "1; DROP TABLE consultee_area", None, 1.5])
def test_fetch_consultee_areas_rejects_non_integer_limits(limit):
    with pytest.raises(TypeError):
        fetch_consultee_areas(None, limit=limit)


@pytest.mark.parametrize("limit", [0, -1, 501])
def test_fetch_consultee_areas_rejects_out_of_range_limits(limit):
    with pytest.raises(ValueError):
        fetch_consultee_areas(None, limit=limit)
