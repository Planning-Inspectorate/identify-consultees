/**
 * Fixture ids for e2e specs, derived from the sample data `npm run db-seed` always loads (see
 * packages/database/src/seed/data-dev.ts) - stable across local dev and CI, unlike a real
 * imported dataset which may or may not be present.
 */

// deterministicId('case-boundary:EN010025:72_EN010025.geojson') - see
// apps/function-python/setup_database/sample_data/sample_application_boundaries.geojson
export const SAMPLE_CASE_ID = '9aba1d63-8575-ce89-847f-0a978e848bca';
export const SAMPLE_CASE_REFERENCE = 'EN010025';
export const SAMPLE_CASE_NAME = 'East Anglia ONE Offshore Windfarm';

// from apps/function-python/setup_database/sample_data/example_ruleset.csv
export const SAMPLE_RULESET_ID = 'railway';
export const SAMPLE_RULESET_NAME = 'Railways';
