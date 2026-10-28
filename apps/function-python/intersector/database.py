"""Database access for a screening run: a connection per thread, deadlock retries, and a time limit."""

import math
import random
import re
import threading
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager

import pymssql

from setup_database.db import ConnectionParams, connect

DEADLOCK_RETRIES = 3

CONSULTEE_AREA = "consultee_area"
"""The consultee areas in use: a synonym for the newest quarter's table - see dataset_table."""

_QUARTER = re.compile(r"^\d{4}Q[1-4]$")


class UnknownDataset(ValueError):
    """A dataset was asked for that isn't a quarter, or has no table. The message is safe to return."""


class RunTimedOut(Exception):
    """A run went past its time limit, and its queries were stopped. The message is safe to return."""


RUN_TIMED_OUT = "The ruleset took too long to run"


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


def with_deadlock_retry[T](fn: Callable[[], T], retries: int = DEADLOCK_RETRIES) -> T:
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
def open_database(
    params: ConnectionParams, table: str = CONSULTEE_AREA, timeout_seconds: float | None = None
) -> Iterator["Database"]:
    """The database for one screening run, its connections closed when the block ends - its
    queries against `table` (see dataset_table), all done within `timeout_seconds` if given.

    with open_database(params) as db:
        rows = db.query("SELECT ...", (param,))
    """
    db = Database(params, table, timeout_seconds)
    try:
        yield db
    finally:
        db.close()


class Database:
    """The connections one screening run uses: one per thread, since a pymssql connection can't be
    shared across threads. Use open_database, which closes them.

    With `timeout_seconds`, every query gets only the time the run has left, and one still going
    when it runs out is stopped - on SQL Server too, so a run the manage app has given up on stops
    loading the database rather than carrying on for minutes alongside whatever runs next. That's
    pymssql's timeout, for a wait with nothing back: a query still sending rows can run a few
    seconds past it, but no query starts after it."""

    def __init__(self, params: ConnectionParams, table: str = CONSULTEE_AREA, timeout_seconds: float | None = None):
        self._params = params
        self.table = table
        """The consultee area table the run's queries use."""
        self._deadline = None if timeout_seconds is None else time.monotonic() + timeout_seconds
        self._local = threading.local()
        self._connections: list[pymssql.Connection] = []
        self._lock = threading.Lock()

    def close(self) -> None:
        with self._lock:
            for connection in self._connections:
                try:
                    connection.close()
                except pymssql.Error:
                    pass  # already closed by a query timing out
            self._connections.clear()

    def query(self, sql: str, params: tuple = ()) -> list[dict]:
        """Rows as dicts, retried on deadlock. `sql` uses pymssql's `%s` placeholders. Raises
        RunTimedOut once the run is out of time."""

        def run() -> list[dict]:
            connection = self._connection()
            if self._deadline is not None:
                left = self._deadline - time.monotonic()
                if left <= 0:
                    raise RunTimedOut(RUN_TIMED_OUT)
                # pymssql's per-query timeout, in whole seconds: rounding up still stops at the deadline
                connection._conn.query_timeout = math.ceil(left)
            with connection.cursor() as cursor:
                cursor.execute(sql, params)
                return cursor.fetchall()

        try:
            return with_deadlock_retry(run)
        except pymssql.Error as error:
            if self._deadline is not None and time.monotonic() >= self._deadline:
                raise RunTimedOut(RUN_TIMED_OUT) from error
            raise

    def _connection(self) -> pymssql.Connection:
        connection = getattr(self._local, "connection", None)
        if connection is None:
            connection = self._local.connection = connect(self._params, as_dict=True)
            with self._lock:
                self._connections.append(connection)
        return connection
