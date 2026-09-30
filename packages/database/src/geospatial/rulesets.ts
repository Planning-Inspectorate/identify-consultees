import type { PrismaClient } from '../client/client.ts';
import type { ConsulteeAreaMatch } from './consultee-areas.ts';
import { findConsulteeAreasNear } from './consultee-areas.ts';
import type { Geometry } from './wkt.ts';

/**
 * A ruleset that can be run against a project's geometry to find the consultees it needs to
 * notify. Every ruleset so far reduces to "consultee areas of these categories within this
 * radius" - one generic, spatial-index-backed query (see runRuleset) covers all of them, so
 * adding a ruleset is just adding an entry to RULESETS, not writing new query logic.
 *
 * Only two are wired up for real (railways, local councils) as a first pass - the full set
 * (around 8) will be added here later.
 */
export interface RulesetDefinition {
	id: string;
	name: string;
	/** consultee_area.consulteeCategory values this ruleset matches (OR'd together). */
	categories: string[];
	radiusMetres: number;
}

export const RULESETS: RulesetDefinition[] = [
	{
		id: 'railways-500m',
		name: 'Railways within 500m',
		categories: ['Railway'],
		radiusMetres: 500
	},
	{
		id: 'local-councils-5km',
		name: 'Local councils within 5km',
		categories: ['Parish Council', 'Lower Tier Authority', 'Unitary Authority', 'Upper Tier Authority'],
		radiusMetres: 5000
	}
];

export function getRuleset(id: string): RulesetDefinition | undefined {
	return RULESETS.find((ruleset) => ruleset.id === id);
}

/**
 * Run a ruleset against a project's geometry, nearest match first.
 */
export async function runRuleset(
	dbClient: PrismaClient,
	geometry: Geometry,
	ruleset: RulesetDefinition
): Promise<ConsulteeAreaMatch[]> {
	return findConsulteeAreasNear(dbClient, geometry, ruleset.radiusMetres, ruleset.categories);
}
