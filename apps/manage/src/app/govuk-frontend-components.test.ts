import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import {
	compareGovukComponentHtml,
	createGovukNunjucksEnvironment,
	formatGovukHtmlMismatch,
	getVisibleFixtures,
	loadComponentCatalogue,
	loadGovukFixtures,
	renderGovukComponent,
	scopeFixtureIds
} from './govuk-frontend-components.ts';

const require = createRequire(import.meta.url);
const govukFrontendVersion = require('govuk-frontend/package.json').version as string;

describe('GOV.UK Frontend component fixtures', () => {
	const env = createGovukNunjucksEnvironment();
	const fixturesFiles = loadGovukFixtures();

	it(`loads fixtures for every component in govuk-frontend@${govukFrontendVersion}`, () => {
		assert.ok(fixturesFiles.length > 0, 'Expected at least one GOV.UK Frontend component fixture file');
	});

	it('every shipped fixture declares expected HTML so parity coverage cannot shrink silently', () => {
		for (const { component, fixtures } of fixturesFiles) {
			for (const fixture of fixtures) {
				assert.equal(typeof fixture.html, 'string', `Fixture "${fixture.name}" for ${component} has no expected html`);
			}
		}
	});

	for (const { component, fixtures } of fixturesFiles) {
		describe(component, () => {
			for (const fixture of fixtures) {
				it(fixture.name, () => {
					const expected = String(fixture.html);
					const rendered = renderGovukComponent(env, component, fixture.options);
					const matches = compareGovukComponentHtml(expected, rendered);

					assert.ok(
						matches,
						formatGovukHtmlMismatch(expected, rendered) ||
							`Fixture "${fixture.name}" for ${component} did not match rendered HTML`
					);
				});
			}
		});
	}

	it('formatGovukHtmlMismatch describes the first differing character', () => {
		const message = formatGovukHtmlMismatch('<div>a</div>', '<div>b</div>');
		assert.match(message, /First difference at character/);
		assert.match(message, /Expected:/);
		assert.match(message, /Actual:/);
	});
});

describe('component catalogue helpers', () => {
	it('loadComponentCatalogue returns the memoised fixture list', () => {
		const first = loadComponentCatalogue();
		const second = loadComponentCatalogue();
		assert.ok(first.length > 0);
		assert.strictEqual(first, second);
	});

	it('getVisibleFixtures filters out hidden fixtures', () => {
		const fixturesFile = {
			component: 'example',
			fixtures: [
				{ name: 'visible', options: {}, html: '<p>one</p>' },
				{ name: 'internal', options: {}, html: '<p>two</p>', hidden: true }
			]
		};
		const visible = getVisibleFixtures(fixturesFile);
		assert.equal(visible.length, 1);
		assert.equal(visible[0].name, 'visible');
	});
});

describe('scopeFixtureIds', () => {
	it('returns html unchanged when there are no ids', () => {
		const html = '<p class="govuk-body">Hello</p>';
		assert.equal(scopeFixtureIds(html, 'x'), html);
	});

	it('prefixes ids and the attributes referencing them', () => {
		const html = [
			'<label class="govuk-label" for="more-detail">More detail</label>',
			'<textarea id="more-detail" aria-describedby="more-detail-hint other"></textarea>',
			'<div id="more-detail-hint">Hint</div>',
			'<a href="#more-detail" aria-controls="more-detail more-detail-hint">Jump</a>',
			'<span aria-labelledby="more-detail">Label</span>'
		].join('');

		const scoped = scopeFixtureIds(html, 'textarea-0');

		assert.match(scoped, /id="textarea-0-more-detail"/);
		assert.match(scoped, /for="textarea-0-more-detail"/);
		assert.match(scoped, /aria-describedby="textarea-0-more-detail-hint other"/);
		assert.match(scoped, /aria-controls="textarea-0-more-detail textarea-0-more-detail-hint"/);
		assert.match(scoped, /aria-labelledby="textarea-0-more-detail"/);
		assert.match(scoped, /href="#textarea-0-more-detail"/);
	});

	it('leaves references to ids that do not exist in the fragment untouched', () => {
		const html = '<a href="#content" class="govuk-skip-link">Skip</a><div id="target"></div>';
		assert.equal(
			scopeFixtureIds(html, 'skip-0'),
			'<a href="#content" class="govuk-skip-link">Skip</a><div id="skip-0-target"></div>'
		);
	});
});
