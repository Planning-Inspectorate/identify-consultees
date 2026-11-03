import pymssql
import pytest

from intersector.database import Database, open_database
from setup_database.db import ConnectionParams


def test_query_reraises_a_database_error_that_is_not_a_deadlock(connection_params):
    # a syntax error comes straight back out: it is not a deadlock to retry, and with no run
    # deadline there is no RunTimedOut to wrap it in
    with open_database(connection_params) as db, pytest.raises(pymssql.Error):
        db.query("SELECT this is not valid SQL")


def test_close_ignores_a_connection_that_will_not_close():
    # a connection a timed-out query already closed raises on close - close() moves on and
    # clears the rest anyway
    class Unclosable:
        def close(self):
            raise pymssql.Error("already closed")

    params = ConnectionParams(server="localhost", port="1433", database="db", user="u", password="p")
    db = Database(params)
    db._connections.append(Unclosable())
    db._connections.append(Unclosable())

    db.close()

    assert db._connections == []
