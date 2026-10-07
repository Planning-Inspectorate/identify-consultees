import type { Ruleset } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';

/**
 * Every consultee category a ruleset covers, in the order its rules name them (deduplicated) -
 * the ordering both the check page's list and the category pages agree on.
 */
export function rulesetCategories(ruleset: Ruleset): string[] {
	return [...new Set(ruleset.rules.flatMap((rule) => rule.categories))];
}
