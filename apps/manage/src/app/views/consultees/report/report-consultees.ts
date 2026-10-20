import type { ConsulteeMatch, Ruleset } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import { isIdentified } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import { describeReasons } from '../reasons.ts';
import { reportCategories } from './categories.ts';
import type { AddedConsultee, ConsulteeSelection } from './urls.ts';
import { excludedMatchIds } from './urls.ts';

/** One consultee as the report lists it. */
export interface ReportConsultee {
	name: string;
	/** Every reason it's in the report, one per line - see reasons.ts. */
	identified: string[];
	/**
	 * False for one added by hand that the maps don't draw: one beyond the nearby search, or (in an
	 * older link) one added by name alone, with no area.
	 */
	mapped: boolean;
}

/** The report's consultees in one category. */
export interface ReportCategory {
	category: string;
	consultees: ReportConsultee[];
}

/** How the report names a consultee the ruleset found. */
export function consulteeName(match: ConsulteeMatch): string {
	return match.feature.properties.consultee ?? 'Unnamed consultee';
}

/** Why a hand-added consultee is in the report: the reason given when adding it, if any. */
export function addedConsulteeReason(add: AddedConsultee): string {
	return add.reason || 'Manually added';
}

/**
 * The report's consultees, by category: what the ruleset's conditions identified (not consultees
 * only the nearby search found - they're map context, not report content), less anything removed on a category's
 * Change page, plus anything added by hand - each with why it's in the report. Categories follow
 * the check page's order (see reportCategories), then any category only a hand-added consultee is
 * in; a category with nothing in it is left out.
 */
export function reportByCategory(
	ruleset: Ruleset,
	consultees: ConsulteeMatch[],
	selection: ConsulteeSelection
): ReportCategory[] {
	const identified = consultees.filter(isIdentified);
	const categories = reportCategories(ruleset, identified);
	for (const add of selection.adds) {
		if (!categories.includes(add.category)) {
			categories.push(add.category);
		}
	}
	const excluded = excludedMatchIds(selection.removed);
	// a consultee added by hand is drawn only if the run found it - see markAddedByHand
	const runIds = new Set(consultees.map((match) => match.feature.id));

	return categories
		.map((category) => ({
			category,
			consultees: [
				...identified
					.filter((match) => match.feature.properties.consulteeCategory === category && !excluded.has(match.feature.id))
					.map((match) => ({
						name: consulteeName(match),
						identified: describeReasons(match, ruleset, { nearby: false }),
						mapped: true
					})),
				...selection.adds
					.filter((add) => add.category === category)
					.map((add) => ({
						name: add.name,
						identified: [addedConsulteeReason(add)],
						mapped: add.id !== undefined && runIds.has(add.id)
					}))
			]
		}))
		.filter((section) => section.consultees.length > 0);
}
