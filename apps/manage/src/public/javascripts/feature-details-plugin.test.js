import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { afterEach, describe, mock, test } from 'node:test';
import { createFeatureDetailsPlugin, featureDetailsHtml } from './feature-details-plugin.mjs';

function installDom(html = '<!DOCTYPE html><html><body></body></html>') {
	const dom = new JSDOM(html);
	globalThis.window = dom.window;
	globalThis.document = dom.window.document;
	globalThis.HTMLElement = dom.window.HTMLElement;
	return dom;
}

afterEach(() => {
	delete globalThis.window;
	delete globalThis.document;
	delete globalThis.HTMLElement;
});

describe('feature-details plugin', () => {
	test('is a plugin descriptor carrying its wire helper', async () => {
		const plugin = createFeatureDetailsPlugin({ addUrl: '/add', removeUrl: '/remove' });
		assert.equal(plugin.id, 'featureDetails');
		assert.equal(typeof plugin.wire, 'function');
		assert.deepEqual(await plugin.load(), {});
	});

	test('featureDetailsHtml describes a consultee or the project site, escaping their text', () => {
		assert.equal(
			featureDetailsHtml({
				consulteeId: 'x',
				name: 'A & <B>',
				consulteeCategory: 'Police and crime commissioners',
				region: 'East',
				distance: '1.2 km'
			}),
			'<p class="govuk-body govuk-!-font-weight-bold govuk-!-margin-bottom-2">A &amp; &lt;B&gt;</p>' +
				'<p class="govuk-body-s govuk-!-margin-bottom-1">Category: Police and crime commissioners</p>' +
				'<p class="govuk-body-s govuk-!-margin-bottom-1">Region: East</p>' +
				'<p class="govuk-body-s govuk-!-margin-bottom-1">Distance: 1.2 km</p>'
		);
		assert.match(
			featureDetailsHtml({
				consulteeId: 'x',
				name: '',
				consulteeCategory: 'Hospitals operated by NHS trusts and NHS foundation trusts (England)',
				region: ''
			}),
			/Unnamed.*Category: Hospitals operated by NHS trusts and NHS foundation trusts \(England\)<\/p>$/
		);
		assert.match(featureDetailsHtml({ name: 'Luton', reference: 'TR020001' }), /Luton.*Reference: TR020001/);
		assert.match(
			featureDetailsHtml({ name: `O'Brien & "Sons"`, reference: 'x' }),
			/O&#39;Brien &amp; &quot;Sons&quot;/
		);
	});

	test('a consultee only the nearby search found links to Add a consultee, its name entered', () => {
		const html = featureDetailsHtml(
			{ consulteeId: 'x', name: 'West Bergholt', identified: 'false' },
			{ addUrl: '/consultees/case/report/consultees/add?ruleset=r&category=c', removeUrl: '/remove' }
		);
		assert.match(
			html,
			/<a class="govuk-link" href="\/consultees\/case\/report\/consultees\/add\?ruleset=r&amp;category=c&amp;name=West%20Bergholt">Add<\/a>/
		);
	});

	test('an identified consultee links to Remove consultee, its removeTarget completing the URL', () => {
		const html = featureDetailsHtml(
			{ consulteeId: 'x', name: 'Copford', identified: 'true', removeTarget: 'match=x' },
			{ addUrl: '/add', removeUrl: '/consultees/case/report/consultees/remove?ruleset=r&category=c' }
		);
		assert.match(
			html,
			/<a class="govuk-link" href="\/consultees\/case\/report\/consultees\/remove\?ruleset=r&amp;category=c&amp;match=x">Remove<\/a>/
		);
		// and one added by hand removes by its add param's index
		assert.match(
			featureDetailsHtml(
				{ consulteeId: 'x', name: 'Copford', identified: 'true', removeTarget: 'added=2' },
				{ addUrl: '/add', removeUrl: '/remove' }
			),
			/href="\/remove&amp;added=2">Remove<\/a>/
		);
	});

	test('a consultee has no action link without the page URLs or removeTarget it needs', () => {
		const nearby = { consulteeId: 'x', name: 'West Bergholt', identified: 'false' };
		const identified = { consulteeId: 'x', name: 'Copford', identified: 'true', removeTarget: 'match=x' };
		assert.doesNotMatch(featureDetailsHtml(nearby, {}), /govuk-link/);
		assert.doesNotMatch(featureDetailsHtml(nearby, { removeUrl: '/remove' }), /govuk-link/);
		assert.doesNotMatch(featureDetailsHtml(identified, { addUrl: '/add' }), /govuk-link/);
		assert.doesNotMatch(
			featureDetailsHtml({ consulteeId: 'x', name: 'Copford', identified: 'true' }, { removeUrl: '/remove' }),
			/govuk-link/
		);
		// an unnamed nearby consultee's Add link still works, its name empty
		assert.match(
			featureDetailsHtml({ consulteeId: 'x', identified: 'false' }, { addUrl: '/add' }),
			/href="\/add&amp;name=">Add<\/a>/
		);
	});

	test('the project site has no action link, whatever the page config', () => {
		const html = featureDetailsHtml({ name: 'Site', reference: 'EN010001' }, { addUrl: '/add', removeUrl: '/remove' });
		assert.doesNotMatch(html, /govuk-link/);
	});

	test('wire shows the selected feature in the panel, and clears the selection when it closes', () => {
		installDom();
		const handlers = {};
		const fire = (event, payload) => {
			for (const handler of handlers[event] ?? []) {
				handler(payload);
			}
		};
		const map = {
			on: (event, handler) => {
				(handlers[event] ??= []).push(handler);
			},
			addPanel: mock.fn((id, options) => {
				document.body.insertAdjacentHTML('beforeend', options.html);
			}),
			showPanel: mock.fn(),
			hidePanel: mock.fn()
		};
		const interact = { enable: mock.fn(), clear: mock.fn() };

		createFeatureDetailsPlugin({
			addUrl: '/add?category=c',
			removeUrl: '/remove?category=c'
		}).wire(map, interact);

		fire('map:ready');
		assert.equal(interact.enable.mock.callCount(), 1);
		assert.equal(map.addPanel.mock.calls[0].arguments[0], 'consultee-details');
		assert.equal(map.hidePanel.mock.callCount(), 1);

		fire('interact:selectionchange', {
			selectedFeatures: [
				{
					properties: {
						consulteeId: 'x',
						name: 'Copford',
						consulteeCategory: 'Parish, town and community councils',
						identified: 'true',
						removeTarget: 'match=x'
					}
				}
			]
		});
		assert.equal(map.showPanel.mock.callCount(), 1);
		const html = document.getElementById('consultee-details-content').innerHTML;
		assert.match(html, /Copford/);
		assert.match(html, /href="\/remove\?category=c&amp;match=x">Remove<\/a>/);

		fire('interact:selectionchange', { selectedFeatures: [] });
		assert.equal(map.hidePanel.mock.callCount(), 2);

		fire('app:panelclosed', { panelId: 'some-other-panel' });
		assert.equal(interact.clear.mock.callCount(), 0);
		fire('app:panelclosed', { panelId: 'consultee-details' });
		assert.equal(interact.clear.mock.callCount(), 1);
	});
});
