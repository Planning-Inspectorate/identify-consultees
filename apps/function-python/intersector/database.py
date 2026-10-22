"""Database access for a screening run: a connection per thread, and deadlock retries."""

import random
import re
import threading
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import TypeVar

import pymssql

from setup_database.db import ConnectionParams, connect

T = TypeVar("T")

DEADLOCK_RETRIES = 3

CONSULTEE_AREA = "consultee_area"
"""The consultee areas in use: a synonym for the newest quarter's table - see dataset_table."""

_QUARTER = re.compile(r"^\d{4}Q[1-4]$")


class UnknownDataset(ValueError):
    """A dataset was asked for that isn't a quarter, or has no table. The message is safe to return."""


def dataset_table(dataset: str | None) -> str:
    """The table a run screens: a quarter's dataset (2026Q4 -> consultee_area_2026Q4), or with none
    the one in use - the consultee_area synonym, which the manage app moves to the newest quarter
    with every group loaded. Only these names ever reach a query's text."""
    if dataset is None:
        return CONSULTEE_AREA
    if not _QUARTER.match(dataset):
        raise UnknownDataset("dataset must be a quarter, as in 2026Q4")
    return f"{CONSULTEE_AREA}_{dataset}"


def is_deadlock_error(error: BaseException) -> bool:
    return re.search("deadlock", str(error), re.IGNORECASE) is not None


def with_deadlock_retry(fn: Callable[[], T], retries: int = DEADLOCK_RETRIES) -> T:
    """Run `fn`, retrying it if SQL Server picks it as a deadlock victim - an expected outcome of
    concurrent reads against the same table, not a bug.

    Timeouts aren't retried: re-running a slow spatial query just repeats the wait.
    """
    for attempt in range(retries + 1):
        try:
            return fn()
        except pymssql.Error as error:
            if not is_deadlock_error(error) or attempt == retries:
                raise
            # a small random backoff, so retried queries don't collide again
            time.sleep(0.025 + random.random() * 0.075)
    raise AssertionError("unreachable")


@contextmanager
def open_database(params: ConnectionParams, table: str = CONSULTEE_AREA) -> Iterator["Database"]:
    """The database for one screening run, its connections closed when the block ends - its
    queries against `table` (see dataset_table).

    with open_database(params) as db:
        rows = db.query("SELECT ...", (param,))
    """
    db = Database(params, table)
    try:
        yield db
    finally:
        db.close()


class Database:
    """The connections one screening run uses: one per thread, since a pymssql connection can't be
    shared across threads. Use open_database, which closes them."""

    def __init__(self, params: ConnectionParams, table: str = CONSULTEE_AREA):
        self._params = params
        self.table = table
        """The consultee area table the run's queries use."""
        self._local = threading.local()
        self._connections: list[pymssql.Connection] = []
        self._lock = threading.Lock()

    def close(self) -> None:
        with self._lock:
            for connection in self._connections:
                connection.close()
            self._connections.clear()

    def query(self, sql: str, params: tuple = ()) -> list[dict]:
        """Rows as dicts, retried on deadlock. `sql` uses pymssql's `%s` placeholders."""

        def run() -> list[dict]:
            with self._connection().cursor() as cursor:
                cursor.execute(sql, params)
                return cursor.fetchall()

        return with_deadlock_retry(run)

    def _connection(self) -> pymssql.Connection:
        connection = getattr(self._local, "connection", None)
        if connection is None:
            connection = self._local.connection = connect(self._params, as_dict=True)
            with self._lock:
                self._connections.append(connection)
        return connection
