"""The distances screening works to, and why.

Every check runs against simplified shapes - the site is simplified once per run, and each
consultee area's simplified copy is stored in `geometrySimplified` - with thresholds widened to
match. Matches are a superset of an exact calculation's: a consultee within a few tens of metres of
a cut-off may be included, never missed. The service would rather consult one body too many than
miss one.
"""

SIMPLIFY_TOLERANCE_METRES = 10
"""Douglas-Peucker tolerance of `consultee_area.geometrySimplified` - must match the migration that
built it (packages/database/src/migrations/*_add_consultee_area_simplified_geometry) and the
manage app's loader, which maintains it (SIMPLIFY_TOLERANCE_METRES in consultee-areas.ts)."""

DISTANCE_MARGIN_METRES = 2 * SIMPLIFY_TOLERANCE_METRES + 10
"""Added to every distance threshold. Simplifying both shapes can move a distance by up to twice
the tolerance, so simplification can only add a borderline consultee, never drop one."""

BORDERING_TOLERANCE_METRES = 50
"""Areas this close count as bordering: the simplification error, plus small gaps between
boundaries drawn from different sources (e.g. 32m between Sundon parish and Luton, which really do
border)."""

CATEGORIES_EXCLUDED_FROM_NEARBY = ("Railway",)
"""Left out of the "any category" nearby search, whatever the distance. Railway's rows are merged
nationwide (one feature is a single MultiLineString covering the whole GB network), so its bounding
box defeats the spatial index everywhere - roughly doubling that query's cost - and "near the
national rail network" is true for almost every project anyway. Conditions that name Railway run
their own category-scoped query instead."""
