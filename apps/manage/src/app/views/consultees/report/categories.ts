import type { ConsulteeMatch, Ruleset } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';

/**
 * Every consultee category a ruleset covers, in the order its rules name them (deduplicated) -
 * the ordering both the check page's list and the category pages agree on.
 */
export function rulesetCategories(ruleset: Ruleset): string[] {
	return [...new Set(ruleset.rules.flatMap((rule) => rule.categories))];
}

/**
 * The check page's categories: every one the ruleset covers (even with nothing found, so the list
 * reads as the ruleset's full coverage), then any other category the run found - consultees the
 * general nearby search picked up in a category no condition names - alphabetically.
 */
export function reportCategories(ruleset: Ruleset, consultees: ConsulteeMatch[]): string[] {
	const covered = rulesetCategories(ruleset);
	const others = new Set<string>();
	for (const consultee of consultees) {
		const category = consultee.feature.properties.consulteeCategory;
		if (category && !covered.includes(category)) {
			others.add(category);
		}
	}
	return [...covered, ...[...others].sort()];
}
