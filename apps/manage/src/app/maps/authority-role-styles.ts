import { CONFIG_DIR } from '@pins/identify-consultees-database/src/config-dir.ts';
import type { AuthorityRole } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import { load } from 'js-yaml';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The colours the consultee maps draw host and bordering authorities in, from
 * config/map-styles/authority-roles.yaml - so the authorities bordering the one the site is in
 * stand out from it. Read and checked once when the app starts, so an invalid file stops the app
 * rather than drawing a broken map.
 */

export interface AuthorityRoleStyle {
	colour: string;
	description: string;
}

export type AuthorityRoleStyles = Record<AuthorityRole, AuthorityRoleStyle>;

const FILE = 'config/map-styles/authority-roles.yaml';
const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/;
const ROLES: AuthorityRole[] = ['host', 'bordering'];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Refuse keys `section` doesn't have - a misspelt one would otherwise be ignored. */
function onlyKeys(section: Record<string, unknown>, allowed: string[], name: string): void {
	const unknown = Object.keys(section).filter((key) => !allowed.includes(key));
	if (unknown.length > 0) {
		throw new Error(
			`${FILE}: ${name} has ${unknown.map((key) => `"${key}"`).join(', ')} - it can only have ${allowed.join(', ')}`
		);
	}
}

function parseStyle(value: unknown, role: AuthorityRole): AuthorityRoleStyle {
	if (!isRecord(value)) {
		throw new Error(`${FILE}: ${role} must be a style`);
	}
	onlyKeys(value, ['colour', 'description'], role);
	const { colour, description } = value;
	if (typeof colour !== 'string' || !HEX_COLOUR.test(colour)) {
		throw new Error(`${FILE}: ${role}.colour must be a 6-digit hex colour, like '#007a7a'`);
	}
	if (typeof description !== 'string' || description.trim() === '') {
		throw new Error(`${FILE}: ${role}.description must describe the colour in words`);
	}
	return { colour, description: description.trim() };
}

export function parseAuthorityRoleStyles(text: string): AuthorityRoleStyles {
	const document = text.trim() === '' ? null : load(text);
	if (!isRecord(document) || document.version !== 1) {
		throw new Error(`${FILE} must be a version 1 document`);
	}
	onlyKeys(document, ['version', ...ROLES], 'the document');
	const styles = {
		host: parseStyle(document.host, 'host'),
		bordering: parseStyle(document.bordering, 'bordering')
	};
	if (styles.host.colour.toLowerCase() === styles.bordering.colour.toLowerCase()) {
		throw new Error(`${FILE}: host and bordering need different colours, or the map can't tell them apart`);
	}
	return styles;
}

export const AUTHORITY_ROLE_STYLES = parseAuthorityRoleStyles(
	readFileSync(path.join(CONFIG_DIR, 'map-styles', 'authority-roles.yaml'), 'utf8')
);
