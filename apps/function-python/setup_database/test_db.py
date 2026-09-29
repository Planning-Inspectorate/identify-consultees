import pytest

from setup_database.db import (
    ConnectionParams,
    check_connection,
    parse_connection_string,
)


def test_parses_a_valid_connection_string():
    params = parse_connection_string(
        "sqlserver://localhost:1434;database=identify-consultees;user=sa;password=Sup3r$ecret!;trustServerCertificate=true"
    )
    assert params.server == "localhost"
    assert params.port == "1434"
    assert params.database == "identify-consultees"
    assert params.user == "sa"
    assert params.password == "Sup3r$ecret!"


def test_defaults_to_port_1433_when_not_specified():
    params = parse_connection_string("sqlserver://localhost;database=db;user=sa;password=pw")
    assert params.port == "1433"


def test_raises_on_an_unrecognised_format():
    with pytest.raises(ValueError, match="Unrecognised SQL_CONNECTION_STRING format"):
        parse_connection_string("not-a-connection-string")


def test_raises_when_a_required_field_is_missing():
    with pytest.raises(ValueError, match="must include database, user and password"):
        parse_connection_string("sqlserver://localhost;database=db;user=sa")


def test_check_connection_succeeds_against_a_real_database(connection_params):
    # raises if this fails - nothing to assert beyond "didn't raise"
    check_connection(connection_params)


def test_check_connection_raises_when_the_database_is_unreachable():
    # a bad host fails fast without needing any real database - runs even when
    # connection_params (used by the test above) would skip for lack of one
    bad_params = ConnectionParams(
        server="this-host-does-not-exist.invalid", port="1433", database="db", user="sa", password="pw"
    )
    with pytest.raises(Exception):  # noqa: B017 - pymssql's own connection error, not ours to name
        check_connection(bad_params)
