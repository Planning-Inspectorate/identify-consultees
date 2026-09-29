import { mockLogger } from '@planning-inspectorate/core/testing';
import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import { configureNunjucks } from '../../nunjucks.ts';
import { buildConsulteeAreasDirectPage, buildRunConsulteeAreasDirect } from './controller.ts';

describe('consultee areas direct', () => {
	const nunjucks = configureNunjucks();
	const newRes = () => ({ render: mock.fn((view, data) => nunjucks.render(view, data)) });
	const newRow = () => ({
		id: '11111111-1111-1111-1111-111111111111',
		geometryType: 'Point',
		consulteeCategory: 'Statutory',
		consultee: 'Environment Agency',
		region: 'South West',
		caseReference: null,
		documentId: null,
		consulteeId: null,
		organisationId: null,
		currentVersion: 1,
		metadata: '{}',
		geometryWkt: 'POINT(-2.5 51.5)'
	});

	it('renders the page with no rows', async () => {
		const res = newRes();
		const page = buildConsulteeAreasDirectPage();
		await page({}, res);
		assert.strictEqual(res.render.mock.callCount(), 1);
		assert.strictEqual(res.render.mock.calls[0].arguments[0], 'views/consultee-areas-direct/view.njk');
		assert.strictEqual(res.render.mock.calls[0].arguments[1].rows, undefined);
	});

	it('renders the rows when the query succeeds', async () => {
		const db = { $queryRaw: mock.fn(async () => [newRow()]) };
		const res = newRes();
		const run = buildRunConsulteeAreasDirect({ db, logger: mockLogger() });
		await run({}, res);

		const { rows, error } = res.render.mock.calls[0].arguments[1];
		assert.strictEqual(error, undefined);
		assert.strictEqual(rows.length, 1);
		assert.strictEqual(rows[0].properties.consultee, 'Environment Agency');
		assert.deepStrictEqual(rows[0].geometry, { type: 'Point', coordinates: [-2.5, 51.5] });
	});

	it('renders no results message data when the query returns nothing', async () => {
		const db = { $queryRaw: mock.fn(async () => []) };
		const res = newRes();
		const run = buildRunConsulteeAreasDirect({ db, logger: mockLogger() });
		await run({}, res);

		assert.deepStrictEqual(res.render.mock.calls[0].arguments[1].rows, []);
	});

	it('renders an error when the query fails', async () => {
		const db = {
			$queryRaw: mock.fn(async () => {
				throw new Error('connection lost');
			})
		};
		const res = newRes();
		const run = buildRunConsulteeAreasDirect({ db, logger: mockLogger() });
		await run({}, res);

		assert.strictEqual(res.render.mock.calls[0].arguments[1].rows, undefined);
		assert.ok(res.render.mock.calls[0].arguments[1].error);
	});
});
