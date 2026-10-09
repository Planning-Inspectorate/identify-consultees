"""What screening works with: the conditions it runs, the areas it finds, and why each is a consultee."""

from dataclasses import dataclass, field
from typing import Literal

LogicType = Literal["intersection", "bordering"]
LOGIC_TYPES: tuple[LogicType, ...] = ("intersection", "bordering")


@dataclass(frozen=True)
class RuleCondition:
    """One condition of a ruleset. A ruleset is the union of its conditions.

    - `intersection`: areas of `categories` within `buffer_metres` of the site (0 = must touch it).
    - `bordering`: areas of `categories` sharing a border with a `host_category` area that
      intersects the site (e.g. the parishes neighbouring the one the site is in).

    The definitions live in the manage app, which sends the selected ruleset's conditions with each
    request - see api.py.
    """

    id: str
    logic_type: LogicType
    categories: tuple[str, ...]
    """`consultee_area.consulteeCategory` values it matches. Empty matches every category."""
    buffer_metres: float = 0
    """intersection only."""
    host_category: str | None = None
    """bordering only."""


@dataclass(frozen=True)
class ConsulteeArea:
    """A row of `consultee_area`, as the manage app receives it."""

    id: str
    """Lowercase, as the manage app's own (Prisma) queries see it - see queries.py."""
    properties: dict
    geometry_wkt: str | None = None
    """Original geometry. Only fetched for areas a condition matched - they're the ones drawn."""


@dataclass(frozen=True)
class AreaMatch:
    """An area one query found."""

    area: ConsulteeArea
    distance_metres: float | None
    """None when the query doesn't measure it - bordering matches are measured afterwards."""


@dataclass(frozen=True)
class ConditionReason:
    """The consultee met this ruleset condition."""

    condition_id: str


@dataclass(frozen=True)
class NearbyReason:
    """The consultee is within the general nearby search's radius."""

    radius_metres: float


Reason = ConditionReason | NearbyReason


@dataclass
class Consultee:
    """One consultee a run found, once, with every reason it qualified."""

    area: ConsulteeArea
    distance_metres: float | None
    reasons: list[Reason] = field(default_factory=list)

    @property
    def matched_a_condition(self) -> bool:
        return any(isinstance(reason, ConditionReason) for reason in self.reasons)

    def record(self, match: AreaMatch, reason: Reason) -> None:
        """Fold in another query's match of this area: keep the nearest measured distance, take its
        geometry if it brought some, and add `reason` once."""
        if match.distance_metres is not None and (
            self.distance_metres is None or match.distance_metres < self.distance_metres
        ):
            self.distance_metres = match.distance_metres
        if match.area.geometry_wkt is not None:
            self.area = match.area
        if reason not in self.reasons:
            self.reasons.append(reason)
