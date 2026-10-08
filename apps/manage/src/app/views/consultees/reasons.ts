import type {
	ConsulteeMatch,
	ConsulteeReason,
	Ruleset
} from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';

function kilometres(metres: number): string {
	return `${Number((metres / 1000).toFixed(2))}km`;
}

/**
 * One reason a consultee was identified, as the report pages show it: the ruleset condition it met
 * ("Hospitals: within 10km of the site", "\"B\" host District Councils: intersects the site", or a
 * bordering condition's own description), or the general search ("Within 20km of the site"). A
 * condition the ruleset no longer has - it can't happen within one request, but the text shouldn't
 * vanish if it did - falls back to its id.
 */
export function describeReason(reason: ConsulteeReason, ruleset: Ruleset): string {
	if (reason.type === 'nearby') {
		return `Within ${kilometres(reason.radiusMetres)} of the site`;
	}
	const rule = ruleset.rules.find((candidate) => candidate.id === reason.conditionId);
	if (!rule) {
		return reason.conditionId;
	}
	if (rule.logicType === 'bordering') {
		return rule.name;
	}
	const bufferMetres = rule.bufferMetres ?? 0;
	return `${rule.name}: ${bufferMetres > 0 ? `within ${kilometres(bufferMetres)} of the site` : 'intersects the site'}`;
}

/** Every reason a consultee was identified, in the order the run gave them, each once. */
export function describeReasons(match: ConsulteeMatch, ruleset: Ruleset): string[] {
	return [...new Set(match.reasons.map((reason) => describeReason(reason, ruleset)))];
}
