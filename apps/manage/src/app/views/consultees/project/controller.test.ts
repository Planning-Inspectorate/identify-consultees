import { mockLogger } from '@planning-inspectorate/core/testing';
import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import { configureNunjucks } from '../../../nunjucks.ts';
import { buildConsulteeProjectPage, buildRunIntersectionSubmit } from './controller.ts';

const realProjectId = '44444444-4444-4444-4444-444444444444';

function realProjectRow(overrides: Record<string, unknown> = {}) {
	return {
		id: realProjectId,
		geometryType: 'Point',
		caseReference: 'EN010099',
		caseName: 'Real Test Project',
		fileName: null,
		receivedDate: null,
		acceptance: null,
		metadata: '{}',
		geometryWkt: 'POINT(-1.5 52.5)',
		...overrides
	};
}

function railwayMatchRow() {
	return {
		id: '55555555-5555-5555-5555-555555555555',
		geometryType: 'MultiLineString',
		consulteeCategory: 'Railway',
		consultee: 'Network Rail',
		region: 'Midlands',
		caseReference: null,
		documentId: null,
		consulteeId: null,
		organisationId: null,
		currentVersion: 1,
		metadata: '{}',
		geometryWkt: 'MULTILINESTRING((-1.5 52.5, -1.4 52.6))',
		distanceMetres: 123.456
	};
}

function dbReturning(rows: unknown[][]) {
	let call = 0;
	return {
		$queryRaw: mock.fn(async (sql: TemplateStringsArray) => {
			// runRuleset simplifies the site, and grows it for bordering checks, with queries on the
			// site alone (no table) - answer those with the site unchanged
			if (!/\bFROM\b/.test(sql.join(''))) return [{ wkt: realProjectRow().geometryWkt }];
			return rows[Math.min(call++, rows.length - 1)] ?? [];
		})
	};
}

function handlerFor(db: unknown) {
	return buildConsulteeProjectPage({ db, logger: mockLogger(), nearbyConsulteeRadiusMetres: 20_000 });
}

describe('consultee project map page', () => {
	it('should render the project header, shapefile/ruleset rows, map and preview button', async () => {
		const nunjucks = configureNunjucks();
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn((view, data) => nunjucks.render(view, data))
		};
		const db = dbReturning([[realProjectRow()], [railwayMatchRow()]]);
		await handlerFor(db)({ params: { caseId: realProjectId }, query: { ruleset: 'example-ruleset' } }, mockRes);

		assert.strictEqual(mockRes.render.mock.calls[0].arguments[0], 'views/consultees/project/view.njk');
		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.pageHeading, 'Real Test Project');
		assert.strictEqual(viewModel.reference, 'EN010099');
		assert.strictEqual(viewModel.backLinkUrl, '/');
		assert.strictEqual(viewModel.rulesetName, 'Example ruleset');
		assert.strictEqual(viewModel.rulesetChangeUrl, `/consultees/${realProjectId}/ruleset?ruleset=example-ruleset`);
		assert.strictEqual(viewModel.shapefileChangeUrl, `/consultees/${realProjectId}/shapefile?ruleset=example-ruleset`);
		// no fileName on the row
		assert.strictEqual(viewModel.shapefileName, 'Not provided');
		// EN01 = Energy, Generating Stations; "Real Test Project" has no energy sub-type keyword
		assert.strictEqual(viewModel.sectorDescription, 'Energy, Generating Stations');
		assert.strictEqual(viewModel.stage, null);
		assert.strictEqual(viewModel.previewReportUrl, `/consultees/${realProjectId}/report?ruleset=example-ruleset`);
		assert.strictEqual(viewModel.runIntersectionUrl, `/consultees/${realProjectId}/run-intersection`);
		assert.strictEqual(viewModel.rulesetId, 'example-ruleset');
		assert.ok(viewModel.mapConfigJson.includes('FeatureCollection'));

		const html = mockRes.render.mock.calls[0].result;
		assert.match(html, /Back to projects/);
		assert.match(html, /Preview report/);
		assert.match(html, /Run Intersection logic/);
		assert.match(html, /Change/);
	});

	it('should show the file name, stage tag and sector sub-type when the data has them', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const row = realProjectRow({
			caseReference: 'EN0110007',
			caseName: 'Longfield Solar Farm',
			fileName: 'EN0110007.geojson',
			acceptance: 'Acceptance'
		});
		const db = dbReturning([[row], []]);
		await handlerFor(db)({ params: { caseId: realProjectId }, query: {} }, mockRes);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.shapefileName, 'EN0110007.geojson');
		assert.strictEqual(viewModel.stage, 'Acceptance');
		assert.strictEqual(viewModel.sectorDescription, 'Energy, Generating Stations, Solar');
	});

	it('should run the default (first) ruleset when none is selected', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const db = dbReturning([[realProjectRow()], []]);
		await handlerFor(db)({ params: { caseId: realProjectId }, query: {} }, mockRes);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.rulesetName, 'Example ruleset');
		assert.strictEqual(viewModel.rulesetChangeUrl, `/consultees/${realProjectId}/ruleset?ruleset=example-ruleset`);
	});

	it('should 404 for a present-but-unknown ruleset', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const db = dbReturning([[realProjectRow()]]);
		await handlerFor(db)({ params: { caseId: realProjectId }, query: { ruleset: 'not-a-real-ruleset' } }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
	});

	it('should 404 when caseId is missing', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		await handlerFor({ $queryRaw: mock.fn() })({ params: {}, query: {} }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
	});

	it('should 404 for an id that is not a well-formed UUID', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		await handlerFor({ $queryRaw: mock.fn() })({ params: { caseId: 'not-a-uuid' }, query: {} }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
	});

	it('should 404 for a well-formed id that matches no project', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const db = dbReturning([[]]);
		await handlerFor(db)({ params: { caseId: realProjectId }, query: {} }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
	});

	it('should flag the ruleset as failed, with a retry link to this page, if the run errors', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		let call = 0;
		const db = {
			$queryRaw: mock.fn(async () => {
				call += 1;
				if (call === 1) return [realProjectRow()];
				throw new Error('query failed');
			})
		};
		const logger = mockLogger();
		const handler = buildConsulteeProjectPage({ db, logger, nearbyConsulteeRadiusMetres: 20_000 });
		await handler({ params: { caseId: realProjectId }, query: {} }, mockRes);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.rulesetFailed, true);
		assert.strictEqual(viewModel.retryUrl, `/consultees/${realProjectId}?ruleset=example-ruleset`);
		assert.strictEqual(logger.error.mock.callCount(), 1);
	});
});

describe('run intersection submit', () => {
	const handler = buildRunIntersectionSubmit();

	it('should redirect back to the map page with the posted ruleset', async () => {
		const mockRes = { status: mock.fn(() => mockRes), redirect: mock.fn() };
		await handler({ params: { caseId: realProjectId }, body: { ruleset: 'example-ruleset' } }, mockRes);

		assert.strictEqual(
			mockRes.redirect.mock.calls[0].arguments[0],
			`/consultees/${realProjectId}?ruleset=example-ruleset`
		);
	});

	it('should fall back to the first ruleset when the posted one is unknown', async () => {
		const mockRes = { status: mock.fn(() => mockRes), redirect: mock.fn() };
		await handler({ params: { caseId: realProjectId }, body: { ruleset: 'not-a-real-ruleset' } }, mockRes);

		assert.strictEqual(
			mockRes.redirect.mock.calls[0].arguments[0],
			`/consultees/${realProjectId}?ruleset=example-ruleset`
		);
	});

	it('should 404 for an id that is not a well-formed UUID', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn(), redirect: mock.fn() };
		await handler({ params: {}, body: {} }, mockRes);
		await handler({ params: { caseId: 'not-a-uuid' }, body: {} }, mockRes);

		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
		assert.strictEqual(mockRes.redirect.mock.callCount(), 0);
	});
});
