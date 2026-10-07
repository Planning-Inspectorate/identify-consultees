/**
 * Consultee category colours for the results maps. Interim: consultee categories aren't in the GIS
 * Tool Styling tables in AGENTS.md, so this palette needs product/design sign-off.
 *
 * None of these reuse the project site's red, or are grey (which reads as disabled).
 */
export const CONSULTEE_CATEGORY_COLOURS = [
	'#1d70b8',
	'#f47738',
	'#912b88',
	'#28a197',
	'#b58840',
	'#d53880',
	'#5694ca',
	'#85994b',
	'#6f72af',
	'#003078',
	'#00703c',
	'#4c2c92',
	'#ffdd00',
	'#f499be'
] as const;

export const UNCATEGORISED = 'Other';

/**
 * A colour for every category, shared by every layer on a map. `priority` categories (the ruleset's
 * matches) are coloured first, so the palette only repeats among the less important ones.
 */
export function assignCategoryColours(priority: string[], others: string[] = []): Map<string, string> {
	const ordered = [...new Set([...[...new Set(priority)].sort(), ...[...new Set(others)].sort()])];
	return new Map(
		ordered.map((category, index) => [category, CONSULTEE_CATEGORY_COLOURS[index % CONSULTEE_CATEGORY_COLOURS.length]])
	);
}

/** A category's colour from `assignCategoryColours`, or the palette's first for one it didn't include. */
export function colourFor(colours: Map<string, string>, category: string): string {
	return colours.get(category) ?? CONSULTEE_CATEGORY_COLOURS[0];
}
