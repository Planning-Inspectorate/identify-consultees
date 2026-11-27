import { CONFIG_DIR } from '@pins/identify-consultees-database/src/config-dir.ts';
import type { AuthorityRole } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import path from 'node:path';
import type { DefraStyleConfig } from './style-utils.ts';
import { HEX_COLOUR, isRecord, loadVersionedMapStylesFile, onlyKeys } from './style-utils.ts';

/**
 * Styles for the project boundary page's map, from config/map-styles/boundary-map.yaml: the most recent
 * boundary file in one style (red), each earlier file in the next of a list. Read and checked once
 * when the app starts, so an invalid file stops the app rather than drawing a broken map.
 */

export interface ConsulteeMapStyle {
	colour: string;
	description: string;
}

export interface ConsulteeMapStyles {
	projectSite: ConsulteeMapStyle;
	consulteeCategoryStyles: ConsulteeMapStyle[];
	manuallyAddedCategoryStyles: ConsulteeMapStyle[];
	authorityStyles: Record<AuthorityRole, ConsulteeMapStyle>;
}

export interface ConsulteeRoleDatasetStyle {
	stroke: DefraStyleConfig['stroke'];
	symbolDescription: DefraStyleConfig['symbolDescription'];
}

function parseStyle(value: unknown, stylePath: string, path: string): ConsulteeMapStyle {
	if (!isRecord(value)) {
		throw new Error(`${path} must be a style`);
	}
	onlyKeys(value, ['colour', 'description'], stylePath, path);
	const { colour, description } = value;
	if (typeof colour !== 'string' || !HEX_COLOUR.test(colour)) {
		throw new Error(`${path}.colour must be a 6-digit hex colour string, like '#C44E52'`);
	}
	if (typeof description !== 'string' || description.trim() === '') {
		throw new Error(`${path}.description must describe the style in words`);
	}
	return {
		colour,
		description
	};
}

export function parseConsulteeMapStyles(document: Record<string, unknown>, stylePath: string): ConsulteeMapStyles {
	onlyKeys(
		document,
		['version', 'projectSite', 'consulteeCategoryStyles', 'manuallyAddedCategoryStyles', 'authorityRoles'],
		stylePath,
		'the document'
	);
	if (!Array.isArray(document.consulteeCategoryStyles) || document.consulteeCategoryStyles.length === 0) {
		throw new Error(`${stylePath}: consulteeCategoryStyles must list at least one style`);
	}
	if (!Array.isArray(document.manuallyAddedCategoryStyles) || document.manuallyAddedCategoryStyles.length === 0) {
		throw new Error(`${stylePath}: manuallyAddedCategoryStyles must list at least one style`);
	}

	if (
		!document.authorityRoles ||
		typeof document.authorityRoles !== 'object' ||
		!('host' in document.authorityRoles) ||
		!('bordering' in document.authorityRoles)
	) {
		throw new Error(`${stylePath}: authorityRoles must be an Object with keys 'host' and 'bordering'`);
	}

	const host = parseStyle(document.authorityRoles.host, stylePath, 'authorityRoles.host');
	const bordering = parseStyle(document.authorityRoles.bordering, stylePath, 'authorityRoles.bordering');

	if (host.colour === bordering.colour) {
		throw new Error(`${stylePath}: authorityRoles must contain a host and border with different colours`);
	}

	return {
		projectSite: parseStyle(document.projectSite, stylePath, 'projectSite'),
		consulteeCategoryStyles: document.consulteeCategoryStyles.map((style, index) =>
			parseStyle(style, stylePath, `consulteeColours[${index}]`)
		),
		manuallyAddedCategoryStyles: document.manuallyAddedCategoryStyles.map((style, index) =>
			parseStyle(style, stylePath, `manuallyAddedColours[${index}]`)
		),
		authorityStyles: {
			host,
			bordering
		}
	};
}

export function readConsulteeMapStyles(stylePath: string): ConsulteeMapStyles {
	const document = loadVersionedMapStylesFile(stylePath, 1);
	return parseConsulteeMapStyles(document, stylePath);
}

export const CONSULTEE_MAP_STYLES = readConsulteeMapStyles(path.join(CONFIG_DIR, 'map-styles', 'consultee-map.yaml'));

export const UNCATEGORISED = 'Other';

export type CategoryPalette = { base: string; addedByHand: string };
export type ColourMap = Map<string, CategoryPalette>;

/**
 * A colour for every category, shared by every layer on a map. `priority` categories (the ruleset's
 * matches) are coloured first, so the palette only repeats among the less important ones.
 */
export function assignCategoryColours(priority: string[], others: string[] = []): ColourMap {
	const ordered = [...new Set([...[...new Set(priority)].sort(), ...[...new Set(others)].sort()])];
	return new Map(
		ordered.map((category, index) => [
			category,
			{
				base: CONSULTEE_MAP_STYLES.consulteeCategoryStyles[index % CONSULTEE_MAP_STYLES.consulteeCategoryStyles.length]
					.colour,
				addedByHand:
					CONSULTEE_MAP_STYLES.manuallyAddedCategoryStyles[
						index % CONSULTEE_MAP_STYLES.manuallyAddedCategoryStyles.length
					].colour
			}
		])
	);
}

/**
 * A category's colour from `assignCategoryColours`, or the palette's first for one it didn't include.
 * The priority order is:
 * - added by hand
 * - authority roles
 * - category colour
 * - default colour
 *
 * Nearby consultees use the same colour, but have a different fill and border, and is not controlled
 * by the config.
 */
export function colourFor(
	colours: ColourMap,
	category: string,
	role: AuthorityRole | undefined,
	addedByHand: boolean
): string {
	if (addedByHand) {
		return colours.get(category)?.addedByHand ?? CONSULTEE_MAP_STYLES.consulteeCategoryStyles[0].colour;
	}

	if (role) {
		return CONSULTEE_MAP_STYLES.authorityStyles[role].colour;
	}

	return colours.get(category)?.base ?? CONSULTEE_MAP_STYLES.consulteeCategoryStyles[0].colour;
}
