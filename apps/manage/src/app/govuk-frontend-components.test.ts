import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import {
	compareGovukComponentHtml,
	createGovukNunjucksEnvironment,
	formatGovukHtmlMismatch,
	loadGovukFixtures,
	renderGovukComponent
} from './govuk-frontend-components.ts';

const require = createRequire(import.meta.url);
const govukFrontendVersion = require('govuk-frontend/package.json').version as string;

describe('GOV.UK Frontend component fixtures', () => {
	const env = createGovukNunjucksEnvironment();
	const fixturesFiles = loadGovukFixtures();

	it(`loads fixtures for every component in govuk-frontend@${govukFrontendVersion}`, () => {
		assert.ok(fixturesFiles.length > 0, 'Expected at least one GOV.UK Frontend component fixture file');
	});

	for (const { component, fixtures } of fixturesFiles) {
		describe(component, () => {
			for (const fixture of fixtures) {
				if (!fixture.html) {
					continue;
				}

				it(fixture.name, () => {
					const rendered = renderGovukComponent(env, component, fixture.options);
					const matches = compareGovukComponentHtml(fixture.html, rendered);

					assert.ok(
						matches,
						formatGovukHtmlMismatch(fixture.html, rendered) ||
							`Fixture "${fixture.name}" for ${component} did not match rendered HTML`
					);
				});
			}
		});
	}
});
