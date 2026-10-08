import type { ConsulteeAreaProperties } from '@pins/identify-consultees-database/src/geospatial/consultee-areas.ts';
import type {
	ConsulteeReason,
	Ruleset,
	RunRulesetResult
} from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import type { Geometry } from '@pins/identify-consultees-database/src/geospatial/wkt.ts';
import { geometryToWkt, wktToGeometry } from '@pins/identify-consultees-database/src/geospatial/wkt.ts';

/**
 * Runs a ruleset against a project site - the consultee intersection logic. It lives in the Python
 * function (apps/function-python, `POST /api/run-ruleset`); this is the manage app's side of that
 * call. Injected through ManageService so tests can stand in for the function.
 */
export type RulesetRunner = (site: Geometry, ruleset: Ruleset, nearbyRadiusMetres: number) => Promise<RunRulesetResult>;

// a typical run takes about a second and the largest real projects ~10s locally (several hundred
// conditions' worth of spatial queries) - this only stops a hung function holding a page forever
const RUN_RULESET_TIMEOUT_MS = 60_000;

interface RunRulesetResponseFeature {
	id: string;
	properties: ConsulteeAreaProperties;
	geometryWkt?: string;
}

interface RunRulesetResponse {
	consultees: { feature: RunRulesetResponseFeature; distanceMetres: number; reasons: ConsulteeReason[] }[];
}

/**
 * The run-ruleset route's URL. PYTHON_FUNCTION_URL names the consultee-areas route (the
 * Function App's first, and the URL the infrastructure already wires up - see
 * infrastructure/app-web.tf), so run-ruleset is resolved as its sibling under the same `/api/`.
 */
export function runRulesetUrl(pythonFunctionUrl: string): string {
	return new URL('run-ruleset', pythonFunctionUrl).toString();
}

export function toRunRulesetResult(body: RunRulesetResponse): RunRulesetResult {
	if (!Array.isArray(body?.consultees)) {
		throw new Error('Python function returned an unexpected run-ruleset response');
	}
	return {
		consultees: body.consultees.map(({ feature, distanceMetres, reasons }) => ({
			distanceMetres,
			reasons,
			feature: {
				id: feature.id,
				properties: feature.properties,
				...(feature.geometryWkt ? { geometry: wktToGeometry(feature.geometryWkt) } : {})
			}
		}))
	};
}

/**
 * Call the Python function's run-ruleset route. The ruleset's conditions travel with the request:
 * the definitions (the ruleset CSV exports and their category aliases) stay here, where the report pages
 * also read them, so there's only one copy. Any failure - unconfigured, unreachable, timed out, or
 * a non-2xx response - rejects, and the page shows "The ruleset could not be run".
 */
export function buildPythonRulesetRunner(options: {
	pythonFunctionUrl: string | undefined;
	apiKey: string | undefined;
	fetchImpl?: typeof fetch;
}): RulesetRunner {
	const { pythonFunctionUrl, apiKey, fetchImpl = fetch } = options;
	return async (site, ruleset, nearbyRadiusMetres) => {
		if (!pythonFunctionUrl) {
			throw new Error('PYTHON_FUNCTION_URL is not configured');
		}
		const response = await fetchImpl(runRulesetUrl(pythonFunctionUrl), {
			method: 'POST',
			// the function requires the x-api-key shared secret (see function_app.py) - a missing key
			// on either side fails closed with 401/500
			headers: { 'content-type': 'application/json', ...(apiKey ? { 'x-api-key': apiKey } : {}) },
			body: JSON.stringify({
				siteWkt: geometryToWkt(site),
				nearbyRadiusMetres,
				rules: ruleset.rules.map(({ id, logicType, categories, bufferMetres, hostCategory }) => ({
					id,
					logicType,
					categories,
					bufferMetres,
					hostCategory
				}))
			}),
			signal: AbortSignal.timeout(RUN_RULESET_TIMEOUT_MS)
		});
		if (!response.ok) {
			throw new Error(`Python function run-ruleset responded with status ${response.status}`);
		}
		return toRunRulesetResult((await response.json()) as RunRulesetResponse);
	};
}
