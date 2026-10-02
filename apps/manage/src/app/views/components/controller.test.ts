import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';
import { loadComponentCatalogue } from '../../govuk-frontend-components.ts';
import { buildComponentDetailPage, buildComponentsIndexPage } from './controller.ts';
import type { ComponentDetailViewModel, ComponentsIndexViewModel } from './view-model.ts';

function mockRequest(params: Record<string, string> = {}, query: Record<string, string> = {}) {
	return { params, query } as never;
}

describe('components index page', () => {
	test('lists every GOV.UK Frontend component sorted by name', async () => {
		const handler = buildComponentsIndexPage();
		const mockRes = { render: mock.fn() };

		await handler(mockRequest(), mockRes as never);

		assert.equal(mockRes.render.mock.callCount(), 1);
		const [view, model] = mockRes.render.mock.calls[0].arguments as [string, ComponentsIndexViewModel];
		assert.equal(view, 'views/components/view.njk');
		assert.equal(model.pageHeading, 'GOV.UK Frontend components');

		const catalogue = loadComponentCatalogue();
		assert.equal(model.components.length, catalogue.length);
		const names = model.components.map((component) => component.name);
		assert.deepEqual(
			names,
			[...names].sort((a, b) => a.localeCompare(b))
		);
		assert.ok(model.components.every((component) => component.exampleCount > 0));
		const button = model.components.find((component) => component.name === 'button');
		assert.equal(button?.title, 'Button');
		assert.equal(button?.href, '/components/button');
	});

	test('component links keep ?components=true when the nav flag is on', async () => {
		const handler = buildComponentsIndexPage();
		const mockRes = { render: mock.fn() };

		await handler(mockRequest({}, { components: 'true' }), mockRes as never);

		const [, model] = mockRes.render.mock.calls[0].arguments as [string, ComponentsIndexViewModel];
		assert.ok(model.components.every((component) => component.href.endsWith('?components=true')));
	});
});

describe('component detail page', () => {
	test('renders every non-hidden fixture with ids scoped per example', async () => {
		const handler = buildComponentDetailPage();
		const mockRes = { render: mock.fn() };

		await handler(mockRequest({ component: 'checkboxes' }), mockRes as never);

		assert.equal(mockRes.render.mock.callCount(), 1);
		const [view, model] = mockRes.render.mock.calls[0].arguments as [string, ComponentDetailViewModel];
		assert.equal(view, 'views/components/component.njk');
		assert.equal(model.pageHeading, 'Checkboxes');
		assert.equal(model.componentName, 'checkboxes');
		assert.equal(model.backLinkUrl, '/components');
		assert.equal(model.backLinkText, 'Back to components');
		assert.ok(model.examples.length > 0);
		assert.ok(
			model.examples.every((example) => example.html.length > 0),
			'expected every example to have rendered html'
		);
		// fixture ids are namespaced so repeated examples cannot collide on the page
		assert.match(model.examples[0].html, /id="checkboxes-0-/);
	});

	test('back link keeps ?components=true when the nav flag is on', async () => {
		const handler = buildComponentDetailPage();
		const mockRes = { render: mock.fn() };

		await handler(mockRequest({ component: 'button' }, { components: 'true' }), mockRes as never);

		const [, model] = mockRes.render.mock.calls[0].arguments as [string, ComponentDetailViewModel];
		assert.equal(model.backLinkUrl, '/components?components=true');
	});

	test('404s for an unknown component', async () => {
		const handler = buildComponentDetailPage();
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };

		await handler(mockRequest({ component: 'not-a-component' }), mockRes as never);

		assert.equal(mockRes.status.mock.calls[0].arguments[0], 404);
		assert.equal(mockRes.render.mock.calls[0].arguments[0], 'views/errors/404.njk');
	});
});
