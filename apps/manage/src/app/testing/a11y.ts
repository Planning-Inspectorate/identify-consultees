import axe from 'axe-core';
import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';

/** What every page's template expects from res.locals, for rendering pages in tests. */
export const pageLocals = {
	config: {
		styleFile: 'style.css',
		govukFrontendJs: 'assets/js/govuk-frontend.min.js',
		consulteesMapJs: 'javascripts/consultees-map.js',
		mapLayersDemoJs: 'javascripts/map-layers-demo.js',
		accessibleAutocompleteJs: 'assets/js/accessible-autocomplete.min.js',
		accessibleAutocompleteCss: 'assets/css/accessible-autocomplete.min.css',
		consulteeAutocompleteJs: 'javascripts/consultee-autocomplete.js',
		vendorInteractiveMapJs: 'vendor/interactive-map/js/index.js',
		vendorInteractiveMapCss: 'vendor/interactive-map/css/index.css',
		vendorMaplibreProviderJs: 'vendor/maplibre-provider/js/index.js',
		interactiveMapExamplesJs: 'javascripts/interactive-map-examples.js',
		headerTitle: 'Identify consultees',
		// the same support links config-middleware puts on every page
		footerLinks: [
			{ text: 'Terms and conditions', link: '/terms-and-conditions', hidden: true },
			{ text: 'Accessibility statement', link: '/accessibility-statement', hidden: true },
			{
				text: 'Privacy',
				link: 'https://www.gov.uk/government/publications/planning-inspectorate-privacy-notices/customer-privacy-notice'
			},
			{ text: 'Cookies', link: '/cookies' },
			{ text: 'Contact', link: '/contact' }
		]
	},
	cspNonce: 'test-nonce'
};

/** Fail when axe finds a critical or serious accessibility violation in `html`. */
export async function assertNoSeriousA11yViolations(html: string) {
	const dom = new JSDOM(html);
	const results = await axe.run(dom.window.document.documentElement, {
		// jsdom cannot compute styles reliably
		rules: {
			'color-contrast': { enabled: false },
			'link-in-text-block': { enabled: false }
		}
	});

	// loops, not filter/map callbacks - a callback that only runs on a violation would never be
	// covered by a passing suite
	const serious: string[] = [];
	for (const violation of results.violations) {
		if (violation.impact === 'critical' || violation.impact === 'serious') {
			serious.push(`${violation.id}: ${violation.help}`);
		}
	}

	assert.equal(serious.length, 0, serious.join('\n'));
}
