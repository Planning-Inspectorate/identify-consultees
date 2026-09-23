import { mockLogger } from '@planning-inspectorate/core/testing';
import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import { configureNunjucks } from '../../../nunjucks.ts';
import { buildConsulteesResultsPage, buildSectionStaticMap } from './controller.ts';

describe('consultees results page', () => {
	it('should render results for a known geometry', async () => {
		const nunjucks = configureNunjucks();
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn((view, data) => nunjucks.render(view, data))
		};
		const handler = buildConsulteesResultsPage({ logger: mockLogger() });
		await handler({ params: { geometryId: 'geo-1' }, query: { ruleset: 'post-30-apr-2024-england-wales' } }, mockRes);

		assert.strictEqual(mockRes.render.mock.callCount(), 1);
		assert.strictEqual(mockRes.render.mock.calls[0].arguments[0], 'views/consultees/results/view.njk');
		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.match(viewModel.pageHeading, /Consultees identified for/);
		assert.ok(viewModel.sections.length >= 2);
		assert.ok(viewModel.sections[0].mapConfigJson.includes('FeatureCollection'));
	});

	it('should 404 for an unknown geometry', async () => {
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn()
		};
		const handler = buildConsulteesResultsPage({ logger: mockLogger() });
		await handler({ params: { geometryId: 'missing' }, query: {} }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
	});

	it('should serve a static SVG map for a section', async () => {
		const mockRes = {
			status: mock.fn(() => mockRes),
			type: mock.fn(() => mockRes),
			set: mock.fn(() => mockRes),
			send: mock.fn()
		};
		const handler = buildSectionStaticMap({ logger: mockLogger() });
		await handler({ params: { geometryId: 'geo-1', sectionId: 'ambulance-trusts' } }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 200);
		assert.strictEqual(mockRes.type.mock.calls[0].arguments[0], 'image/svg+xml');
		assert.match(mockRes.send.mock.calls[0].arguments[0], /<svg/);
	});
});
