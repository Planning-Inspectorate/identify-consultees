import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import nunjucks from 'nunjucks';

export type GovukFixture = {
	name: string;
	options: Record<string, unknown>;
	html?: string;
	hidden?: boolean;
};

export type GovukFixturesFile = {
	component: string;
	fixtures: GovukFixture[];
};

const require = createRequire(import.meta.url);

/**
 * Resolve the GOV.UK Frontend package root used for Nunjucks templates.
 */
export function getGovukFrontendRoot(): string {
	return path.resolve(require.resolve('govuk-frontend'), '../..');
}

/**
 * Directory containing component folders and their fixtures.json files.
 */
export function getGovukComponentsDir(): string {
	return path.join(getGovukFrontendRoot(), 'govuk/components');
}

/**
 * Convert a kebab-case component name to its Nunjucks macro name.
 * e.g. "error-summary" -> "govukErrorSummary"
 */
export function getGovukMacroName(component: string): string {
	const macroSuffix = component
		.split('-')
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join('');

	return `govuk${macroSuffix}`;
}

/**
 * Normalise HTML for comparison.
 *
 * GOV.UK Frontend documents that Nunjucks may add leading or trailing
 * whitespace around macro output, so fixtures are compared after trimming.
 *
 * @see https://frontend.design-system.service.gov.uk/testing-your-html/#using-the-html-test-files
 */
export function normaliseGovukHtml(html: string): string {
	return html.replace(/\r\n/g, '\n').trim();
}

/**
 * Create a Nunjucks environment configured the same way as this application.
 */
export function createGovukNunjucksEnvironment(): nunjucks.Environment {
	return nunjucks.configure([getGovukFrontendRoot()], {
		autoescape: true,
		trimBlocks: true,
		lstripBlocks: true
	});
}

/**
 * Load every fixtures.json file shipped with GOV.UK Frontend.
 */
export function loadGovukFixtures(): GovukFixturesFile[] {
	const componentsDir = getGovukComponentsDir();

	return fs
		.readdirSync(componentsDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => path.join(componentsDir, entry.name, 'fixtures.json'))
		.filter((fixturePath) => fs.existsSync(fixturePath))
		.map((fixturePath) => JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as GovukFixturesFile)
		.sort((a, b) => a.component.localeCompare(b.component));
}

let componentCatalogue: GovukFixturesFile[] | undefined;

/**
 * Memoised component catalogue for the showcase pages - avoids re-reading
 * every fixtures.json from node_modules on each request.
 */
export function loadComponentCatalogue(): GovukFixturesFile[] {
	if (!componentCatalogue) {
		componentCatalogue = loadGovukFixtures();
	}
	return componentCatalogue;
}

/**
 * Fixtures GOV.UK Frontend marks `hidden` are internal to its own review app,
 * not documented examples - the showcase only lists visible ones.
 */
export function getVisibleFixtures(fixturesFile: GovukFixturesFile): GovukFixture[] {
	return fixturesFile.fixtures.filter((fixture) => !fixture.hidden);
}

/**
 * Render a GOV.UK Frontend component macro using fixture options.
 */
export function renderGovukComponent(
	env: nunjucks.Environment,
	component: string,
	options: Record<string, unknown>
): string {
	const macroName = getGovukMacroName(component);
	const template = `{% from "govuk/components/${component}/macro.njk" import ${macroName} %}{{ ${macroName}(params) }}`;

	return env.renderString(template, { params: options });
}

/**
 * Compare rendered HTML to a GOV.UK Frontend fixture.
 */
export function compareGovukComponentHtml(expected: string, actual: string): boolean {
	return normaliseGovukHtml(expected) === normaliseGovukHtml(actual);
}

/**
 * Build a short diff message when rendered HTML does not match a fixture.
 */
export function formatGovukHtmlMismatch(expected: string, actual: string): string {
	const normalisedExpected = normaliseGovukHtml(expected);
	const normalisedActual = normaliseGovukHtml(actual);

	for (let index = 0; index < Math.max(normalisedExpected.length, normalisedActual.length); index++) {
		if (normalisedExpected[index] === normalisedActual[index]) {
			continue;
		}

		const contextStart = Math.max(0, index - 40);
		const contextEnd = index + 80;

		return [
			`First difference at character ${index}.`,
			`Expected: ${JSON.stringify(normalisedExpected.slice(contextStart, contextEnd))}`,
			`Actual:   ${JSON.stringify(normalisedActual.slice(contextStart, contextEnd))}`
		].join('\n');
	}

	return 'Rendered HTML length differs after normalisation.';
}

// attributes whose values are space-separated lists of ids (or a single id, like `for`)
const ID_REFERENCE_ATTRIBUTES = ['for', 'aria-describedby', 'aria-labelledby', 'aria-controls'];

/**
 * Prefix every `id` in a rendered fixture (and the attributes referencing it)
 * so several fixtures can be shown on one page without duplicate-id conflicts.
 * Display-layer only: fixture parity tests compare the raw macro output.
 */
export function scopeFixtureIds(html: string, prefix: string): string {
	const ids = new Set(Array.from(html.matchAll(/\sid="([^"]+)"/g), (match) => match[1]));

	if (ids.size === 0) {
		return html;
	}

	let scoped = html.replace(/\sid="([^"]+)"/g, (_match, id: string) => ` id="${prefix}-${id}"`);

	for (const attribute of ID_REFERENCE_ATTRIBUTES) {
		scoped = scoped.replace(new RegExp(`\\s${attribute}="([^"]+)"`, 'g'), (_match, value: string) => {
			const rewritten = value
				.split(/\s+/)
				.map((token) => (ids.has(token) ? `${prefix}-${token}` : token))
				.join(' ');
			return ` ${attribute}="${rewritten}"`;
		});
	}

	return scoped.replace(/\bhref="#([^"]+)"/g, (match, id: string) => (ids.has(id) ? `href="#${prefix}-${id}"` : match));
}
