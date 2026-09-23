import pytest

from setup_database.db import parse_connection_string


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
