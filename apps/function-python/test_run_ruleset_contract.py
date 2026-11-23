"""The run-ruleset route's shared contract: the fixture under contracts/run-ruleset/ is
pinned by both sides - this function parses that request and produces that response, and
apps/manage's ruleset-runner.test.ts posts the request and maps the response. A field
changed on either side without a contract change fails one suite or the other."""

import json
from pathlib import Path

import pytest

from intersector.api import consultees_json, parse_run_ruleset_request
from intersector.models import (
    ConditionReason,
    Consultee,
    ConsulteeArea,
    NearbyReason,
)

CONTRACTS = Path(__file__).parent.parent.parent / "contracts" / "run-ruleset"
REQUEST_FIXTURE = json.loads((CONTRACTS / "request.json").read_text())
RESPONSE_FIXTURE = json.loads((CONTRACTS / "response.json").read_text())


def test_contract_request_parses():
    # includeGeometry was sent for a function version that defaulted to returning geometry;
    # the parser ignores fields it does not know - pinned in the fixture so the parse below
    # keeps exercising that tolerance
    assert "includeGeometry" in REQUEST_FIXTURE

    request = parse_run_ruleset_request(REQUEST_FIXTURE)

    assert request.site_wkt == "POINT(-1.5 52.5)"
    assert request.nearby_radius_metres == 20000
    assert request.nearby_radius_metres_by_category == {"Parish, town and community councils": 5000}
    assert request.bounding_box_above_points == 2000
    assert request.bounding_box is False
    assert request.timeout_seconds == 50
    assert request.case_boundary_id == "aaaaaaaa-0000-0000-0000-000000000001"
    assert request.dataset is None

    assert len(request.rules) == 2
    hospital, parish = request.rules
    assert (hospital.id, hospital.logic_type, hospital.buffer_metres, hospital.host_category) == (
        "hospital",
        "intersection",
        10000,
        None,
    )
    assert (parish.id, parish.logic_type, parish.host_category) == (
        "parish",
        "bordering",
        "Parish, town and community councils",
    )


def test_contract_response_is_what_consultees_json_produces():
    # feature.id and properties pass through verbatim, so they come from the fixture - what
    # this pins is the envelope's key names and the reason objects' wire shape
    consultees = [
        Consultee(
            area=ConsulteeArea(
                id=entry["feature"]["id"],
                properties=entry["feature"]["properties"],
            ),
            distance_metres=entry["distanceMetres"],
            reasons=reasons,
        )
        for entry, reasons in zip(
            RESPONSE_FIXTURE["consultees"],
            [
                [ConditionReason("parish"), NearbyReason(20000)],
                [NearbyReason(20000)],
            ],
        )
    ]

    assert consultees_json(consultees, "boundingBox") == RESPONSE_FIXTURE


@pytest.mark.parametrize("site_screened_as", ["outline", "simplifiedOutline", "boundingBox"])
def test_consultees_json_site_screened_as_literals(site_screened_as):
    # every value run_ruleset reports serialises as-is - the manage app maps anything but
    # 'boundingBox' to 'outline'
    assert consultees_json([], site_screened_as)["siteScreenedAs"] == site_screened_as
