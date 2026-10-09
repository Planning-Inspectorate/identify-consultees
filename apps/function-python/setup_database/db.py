"""Connection handling for talking to the same SQL Server database the rest of
this project uses (see packages/database). pymssql takes discrete connection
parameters rather than a URL, so the shared `SQL_CONNECTION_STRING` format
(sqlserver://host:port;database=...;user=...;password=...;...) is parsed here
rather than introducing a second, Python-only env var convention.
"""

import os
import re
from dataclasses import dataclass

import pymssql

_CONNECTION_STRING_PATTERN = re.compile(r"^sqlserver://([^:;]+)(?::(\d+))?;(.+)$")


@dataclass
class ConnectionParams:
    server: str
    port: str
    database: str
    user: str
    password: str


def parse_connection_string(connection_string: str) -> ConnectionParams:
    match = _CONNECTION_STRING_PATTERN.match(connection_string)
    if not match:
        # the connection string carries the database password - never echo it into an
        # exception message, it would end up in logs (function_app.py logs exceptions)
        raise ValueError("Unrecognised SQL_CONNECTION_STRING format")

    host, port, rest = match.groups()
    params = dict(pair.split("=", 1) for pair in rest.split(";") if "=" in pair)

    database = params.get("database")
    user = params.get("user")
    password = params.get("password")
    if not database or not user or not password:
        raise ValueError("SQL_CONNECTION_STRING must include database, user and password")

    return ConnectionParams(server=host, port=port or "1433", database=database, user=user, password=password)


def connection_params_from_env() -> ConnectionParams:
    connection_string = os.environ.get("SQL_CONNECTION_STRING")
    if not connection_string:
        raise RuntimeError("SQL_CONNECTION_STRING is not set")
    return parse_connection_string(connection_string)


def connect(params: ConnectionParams, *, as_dict: bool = False) -> pymssql.Connection:
    """Open a connection to the database. `as_dict` makes cursors return rows as dicts."""
    return pymssql.connect(
        server=params.server,
        port=params.port,
        database=params.database,
        user=params.user,
        password=params.password,
        as_dict=as_dict,
    )


def check_connection(params: ConnectionParams) -> None:
    """Open a connection and run a trivial query, raising if either fails.

    Used by the health check route - proves the function can actually reach
    the database, not just that a connection string is configured.
    """
    connection = connect(params)
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
    finally:
        connection.close()
