import { fetchWithTimeout } from '#lib/util/index.ts';
import type { ConsulteeAreaProperties } from '@pins/identify-consultees-database/src/geospatial/consultee-areas.ts';
import type {
	ConsulteeReason,
	Ruleset,
	RunRulesetResult
} from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import type { Geometry } from '@pins/identify-consultees-database/src/geospatial/wkt.ts';
import { geometryToWkt } from '@pins/identify-consultees-database/src/geospatial/wkt.ts';

/**
 * Runs a ruleset against a project site - the consultee intersection logic. It lives in the Python
 * function (apps/function-python, `POST /api/run-ruleset`); this is the manage app's side of that
 * call. Injected through ManageService so tests can stand in for the function.
 */
export type RulesetRunner = (site: Geometry, ruleset: Ruleset, nearbyRadiusMetres: number) => Promise<RunRulesetResult>;

// a typical run takes about a second locally and the slowest real projects ~4s, but many times
// that on the smaller Azure databases. One request, within Front Door's timeout: whether to screen
// the outline or its bounding box is decided up front (boundingBoxAbovePoints), not by trying the
// outline and retrying on a timeout - that left the outline's queries running on the database while
// the box's ran too
const RUN_TIMEOUT_MS = 60_000;

// the function stops its run - its queries too - this much sooner, so it's done before the request
// is given up on and a slow run never outlives it. A query still sending rows can run a few seconds
// past the function's limit (pymssql's timeout is for a wait with nothing back), so it's well ahead
const FUNCTION_STOPS_EARLIER_MS = 10_000;

interface RunRulesetResponseFeature {
	id: string;
	properties: ConsulteeAreaProperties;
}

interface RunRulesetResponse {
	consultees: { feature: RunRulesetResponseFeature; distanceMetres: number; reasons: ConsulteeReason[] }[];
	siteScreenedAs?: string;
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
			feature: { id: feature.id, properties: feature.properties }
		})),
		// a covering outline (simplifiedOutline) identifies exactly what the outline does - nothing to
		// warn about - so only the bounding box is told apart
		siteScreenedAs: body.siteScreenedAs === 'boundingBox' ? 'boundingBox' : 'outline'
	};
}

/**
 * Call the Python function's run-ruleset route. The ruleset's conditions travel with the request:
 * the definitions (the ruleset CSV exports and their category aliases) stay here, where the report pages
 * also read them, so there's only one copy. Any failure - unconfigured, unreachable, timed out (504
 * from the function stopping its run, or no answer in time), or a non-2xx response - rejects, and
 * the page shows "The ruleset could not be run".
 */
export function buildPythonRulesetRunner(options: {
	pythonFunctionUrl: string | undefined;
	apiKey: string | undefined;
	/** Each category's own nearby distance (config/nearby-consultees.yaml); others use nearbyRadiusMetres. */
	nearbyRadiusMetresByCategory?: Record<string, number>;
	/** Screen a site more detailed than this against its bounding box (config/screening.yaml); 0 never does. */
	boundingBoxAbovePoints?: number;
}): RulesetRunner {
	const { pythonFunctionUrl, apiKey, nearbyRadiusMetresByCategory = {}, boundingBoxAbovePoints = 0 } = options;
	return async (site, ruleset, nearbyRadiusMetres) => {
		if (!pythonFunctionUrl) {
			throw new Error('PYTHON_FUNCTION_URL is not configured');
		}
		const response = await fetchWithTimeout(
			runRulesetUrl(pythonFunctionUrl),
			{ timeoutMs: RUN_TIMEOUT_MS },
			{
				method: 'POST',
				// the function requires the x-api-key shared secret (see function_app.py) - a missing key
				// on either side fails closed with 401/500
				headers: { 'content-type': 'application/json', ...(apiKey ? { 'x-api-key': apiKey } : {}) },
				body: JSON.stringify({
					siteWkt: geometryToWkt(site),
					nearbyRadiusMetres,
					nearbyRadiusMetresByCategory,
					// the function sends no geometry - the maps draw from their own display geometry (see
					// buildSearchAreaSafely). One deployed before that sent it unless told not to - tens of
					// MB for a run touching whole counties - so it's still told
					includeGeometry: false,
					...(boundingBoxAbovePoints > 0 ? { boundingBoxAbovePoints } : {}),
					timeoutSeconds: (RUN_TIMEOUT_MS - FUNCTION_STOPS_EARLIER_MS) / 1000,
					rules: ruleset.rules.map(({ id, logicType, categories, bufferMetres, hostCategory }) => ({
						id,
						logicType,
						categories,
						bufferMetres,
						hostCategory
					}))
				})
			}
		);
		if (!response.ok) {
			throw new Error(`Python function run-ruleset responded with status ${response.status}`);
		}
		return toRunRulesetResult((await response.json()) as RunRulesetResponse);
	};
}
