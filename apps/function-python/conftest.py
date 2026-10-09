import pytest

from setup_database.db import connect, connection_params_from_env


@pytest.fixture
def connection_params():
    """Skip the test (not fail) when no database is reachable, matching the
    pattern used for the Node geometry tests in packages/database.
    """
    try:
        params = connection_params_from_env()
        connect(params).close()
    except Exception as error:  # noqa: BLE001 - any connection failure should just skip the test
        pytest.skip(f"SQL Server database not available: {error}")
    return params
