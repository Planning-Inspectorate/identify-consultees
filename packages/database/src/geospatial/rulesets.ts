import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PrismaClient } from '../client/client.ts';
import type { ConsulteeAreaMatch } from './consultee-areas.ts';
import { findConsulteeAreasBordering, findConsulteeAreasNear } from './consultee-areas.ts';
import type { Geometry } from './wkt.ts';

/**
 * A ruleset that can be run against a project's geometry to find the consultees it needs to
 * notify. Loaded from the real ruleset export (see RULESET_CSV_PATH below) - each row is one of
 * two shapes:
 *
 * - `intersection`: match consultee areas of `categories` within `bufferMetres` of the site
 *   (0 = must actually intersect, not just be nearby).
 * - `bordering`: find the `hostCategory` area that intersects the site (e.g. the parish the site
 *   sits in), then match consultee areas of `categories` that share a border with that host area
 *   (e.g. neighbouring parishes) - a different query shape to `intersection`, not just a distance
 *   check, so it isn't expressible as a radius.
 */
export type RulesetLogicType = 'intersection' | 'bordering';

export interface RulesetDefinition {
	id: string;
	name: string;
	logicType: RulesetLogicType;
	/** consultee_area.consulteeCategory values this ruleset matches (OR'd together). */
	categories: string[];
	/** intersection only: buffer radius in metres (0 = must actually intersect). */
	bufferMetres?: number;
	/** bordering only: the category of the area that must intersect the site first. */
	hostCategory?: string;
}

// The ruleset export uses short internal identifiers (e.g. "parish", "rail_epsg27700") where the
// loaded reference data uses human-readable category names (e.g. "Parish Council", "Railway") -
// this bridges the two. A handful of export identifiers (canals, MoD safeguarding/low-flying
// areas, coal mining reporting areas, Cheshire brine area, Joint Transport Authorities Wales)
// have no current mapping because that reference data hasn't been loaded yet - left as-is below,
// which just means that ruleset matches nothing until it is, rather than guessing wrong.
// a Map, not an object literal - these keys are snake_case source identifiers, not JS property
// names, and an object literal's keys get flagged (rightly) by the camelcase lint rule
const CATEGORY_ALIASES = new Map<string, string[]>([
	['parish', ['Parish Council']],
	['distr_council', ['Lower Tier Authority']],
	['unitary_auth', ['Unitary Authority']],
	['unit_auth', ['Unitary Authority']],
	['nat_park', ['National Park']],
	['county_council', ['Upper Tier Authority']],
	['greater_london_authority', ['Greater London Authority']],
	['rail_epsg27700', ['Railway']],
	['ambulance_services_epsg27700', ['Ambulance Trust']],
	['fire_and_rescue_service', ['Fire and Rescue Authority']],
	[
		'passenger_transport_exec_integrated_transport_auth',
		['Passenger Transport Executive', 'Integrated Transport Authority']
	],
	['police_crime_commissioner', ['Police']],
	['hospital', ['Hospital']],
	['integrated_care_board', ['ICB']],
	['idd_w_epsg27700', ['Internal Drainage District']],
	['internal_drainage_board_england', ['Internal Drainage Board']],
	['local_resilience_forum', ['Local Resilience Forum']],
	['local_health_board', ['Local Health Board']],
	['national_landscape_aonb_england', ['National Landscape']],
	['national_landscape_aonb_wales', ['National Landscape']],
	['ports_harbours_epsg27700', ['Dock or Harbour']],
	['offshore_areas_wind_site', ['Offshore Wind Site']],
	['offshore_areas_export_cable', ['Offshore Wind Export Cable']],
	['office_for_nuclear_regulation_site', ['ONR Site']]
]);

function resolveCategories(token: string): string[] {
	const trimmed = token.trim();
	return CATEGORY_ALIASES.get(trimmed) ?? [trimmed];
}

/** A row's matching categories: referenceData if set, else matchingConsulteeType (`;`-separated), else consulteeName. */
function matchingCategoriesFor(row: {
	consulteeName: string;
	referenceData: string;
	matchingConsulteeType: string;
}): string[] {
	if (row.referenceData) {
		return resolveCategories(row.referenceData);
	}
	if (row.matchingConsulteeType) {
		return row.matchingConsulteeType.split(';').flatMap(resolveCategories);
	}
	return resolveCategories(row.consulteeName);
}

const RULESET_CSV_COLUMNS = [
	'consulteeName',
	'referenceData',
	'consulteeDescription',
	'matchingConsulteeType',
	'hostType',
	'logicDescription',
	'logicType',
	'intersectionBufferKm'
] as const;

/**
 * Parse the tab-separated ruleset export into RulesetDefinitions. Not a general CSV parser -
 * fields here are never quoted/escaped, so a plain split on tabs and newlines is enough.
 */
export function parseRulesetCsv(contents: string): RulesetDefinition[] {
	const lines = contents.split('\n').filter((line) => line.trim() !== '');
	const [header, ...dataLines] = lines;
	const columns = header.split('\t').map((column) => column.trim());
	for (const expected of RULESET_CSV_COLUMNS) {
		if (!columns.includes(expected)) {
			throw new Error(`Ruleset CSV is missing expected column "${expected}"`);
		}
	}

	return dataLines.map((line) => {
		const cells = line.split('\t');
		const row = Object.fromEntries(columns.map((column, index) => [column, (cells[index] ?? '').trim()])) as Record<
			(typeof RULESET_CSV_COLUMNS)[number],
			string
		>;

		const logicType: RulesetLogicType = row.logicType === 'bordering' ? 'bordering' : 'intersection';
		const categories = matchingCategoriesFor(row);

		if (logicType === 'bordering') {
			return {
				id: row.consulteeName,
				name: row.consulteeDescription,
				logicType,
				categories,
				hostCategory: row.hostType ? resolveCategories(row.hostType)[0] : undefined
			};
		}

		return {
			id: row.consulteeName,
			name: row.consulteeDescription,
			logicType,
			categories,
			bufferMetres: (Number.parseFloat(row.intersectionBufferKm) || 0) * 1000
		};
	});
}

// co-located with this module (not under apps/function-python/setup_database/sample_data, where
// it originally lived) so it's guaranteed to exist wherever packages/database is deployed - a
// cross-app relative path here previously crashed the manage app's Docker image at startup, since
// that image only ever copies packages/ and apps/manage/, never apps/function-python
const RULESET_CSV_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'example_ruleset.csv');

export const RULESETS: RulesetDefinition[] = parseRulesetCsv(readFileSync(RULESET_CSV_PATH, 'utf8'));

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
	if (ruleset.logicType === 'bordering') {
		if (!ruleset.hostCategory) {
			return [];
		}
		return findConsulteeAreasBordering(dbClient, geometry, ruleset.hostCategory, ruleset.categories);
	}
	return findConsulteeAreasNear(dbClient, geometry, ruleset.bufferMetres ?? 0, ruleset.categories);
}
