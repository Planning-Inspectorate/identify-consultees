import { mockLogger } from '@planning-inspectorate/core/testing';
import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import { configureNunjucks } from '../../../nunjucks.ts';
import { buildReportCheckPage, buildReportCreatedPage } from './controller.ts';

const realProjectId = '44444444-4444-4444-4444-444444444444';

function realProjectRow(overrides: Record<string, unknown> = {}) {
	return {
		id: realProjectId,
		geometryType: 'Point',
		caseReference: 'EN010099',
		caseName: 'Real Test Project',
		fileName: null,
		receivedDate: null,
		acceptance: 'Acceptance',
		metadata: '{}',
		geometryWkt: 'POINT(-1.5 52.5)',
		...overrides
	};
}

function parishMatchRow() {
	return {
		id: '55555555-5555-5555-5555-555555555555',
		geometryType: 'MultiLineString',
		consulteeCategory: 'Parish Council',
		consultee: 'Little Snoring Parish Council',
		region: 'East of England',
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
	return buildReportCheckPage({ db, logger: mockLogger(), nearbyConsulteeRadiusMetres: 20_000 });
}

describe('consultee report check page', () => {
	it('should render the report details and per-category consultee counts', async () => {
		const nunjucks = configureNunjucks();
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn((view, data) => nunjucks.render(view, data))
		};
		const db = dbReturning([[realProjectRow()], [parishMatchRow()]]);
		await handlerFor(db)({ params: { caseId: realProjectId }, query: { ruleset: 'example-ruleset' } }, mockRes);

		assert.strictEqual(mockRes.render.mock.calls[0].arguments[0], 'views/consultees/report/view.njk');
		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.pageHeading, 'Check consultees before creating the report');
		assert.strictEqual(viewModel.caseName, 'Real Test Project');
		assert.strictEqual(viewModel.reference, 'EN010099');
		assert.strictEqual(viewModel.stage, 'Acceptance');
		assert.strictEqual(viewModel.rulesetName, 'Example ruleset');
		assert.strictEqual(viewModel.backLinkUrl, `/consultees/${realProjectId}?ruleset=example-ruleset`);
		assert.strictEqual(viewModel.rulesetChangeUrl, `/consultees/${realProjectId}/ruleset?ruleset=example-ruleset`);
		assert.strictEqual(
			viewModel.generateReportUrl,
			`/consultees/${realProjectId}/report/created?ruleset=example-ruleset`
		);

		// one row per ruleset category, in ruleset order - matched ones carry their count
		const parishRow = viewModel.consultees.find((row: { name: string }) => row.name === 'Parish Council');
		assert.strictEqual(parishRow.count, '1');
		assert.ok(viewModel.consultees.every((row: { count: string }) => typeof row.count === 'string'));
		assert.ok(viewModel.consultees.length > 1);
		// every category's Change link opens its shared consultees page for the same ruleset
		assert.ok(
			viewModel.consultees.every((row: { changeUrl: string }) =>
				row.changeUrl.startsWith(`/consultees/${realProjectId}/report/consultees?ruleset=example-ruleset&category=`)
			)
		);
		assert.match(parishRow.changeUrl, /category=Parish%20Council/);

		const html = mockRes.render.mock.calls[0].result;
		assert.match(html, /Report details/);
		assert.match(html, /Identified consultees/);
		assert.match(html, /Generate report/);
	});

	it('should subtract excluded consultees from the counts and carry exclusions through the links', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const excludedId = '55555555-5555-5555-5555-555555555555';
		const db = dbReturning([[realProjectRow()], [parishMatchRow()]]);
		await handlerFor(db)(
			{ params: { caseId: realProjectId }, query: { ruleset: 'example-ruleset', exclude: excludedId } },
			mockRes
		);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		// the only match was excluded - the count is the number of rows its Change page would list
		const parishRow = viewModel.consultees.find((row: { name: string }) => row.name === 'Parish Council');
		assert.strictEqual(parishRow.count, '0');
		assert.ok(parishRow.changeUrl.includes(`&exclude=${excludedId}`));
		assert.ok(viewModel.generateReportUrl.includes(`&exclude=${excludedId}`));
	});

	it('should add hand-added consultees to their category count and carry them through the links', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const parishAdd = JSON.stringify({ c: 'Parish Council', n: 'Test Consultee', r: 'Adjacent' });
		const hospitalAdd = JSON.stringify({ c: 'Hospital', n: 'Other Test Consultee', r: '' });
		const db = dbReturning([[realProjectRow()], [parishMatchRow()]]);
		await handlerFor(db)(
			{
				params: { caseId: realProjectId },
				query: { ruleset: 'example-ruleset', add: [parishAdd, hospitalAdd] }
			},
			mockRes
		);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		const parishRow = viewModel.consultees.find((row: { name: string }) => row.name === 'Parish Council');
		const hospitalRow = viewModel.consultees.find((row: { name: string }) => row.name === 'Hospital');
		// one ruleset match + one hand-added row
		assert.strictEqual(parishRow.count, '2');
		assert.strictEqual(hospitalRow.count, '1');
		// the adds reach the Change pages and the report-created link unchanged
		assert.ok(parishRow.changeUrl.includes(`add=${encodeURIComponent(parishAdd)}`));
		assert.ok(hospitalRow.changeUrl.includes(`add=${encodeURIComponent(hospitalAdd)}`));
		assert.ok(viewModel.generateReportUrl.includes(`add=${encodeURIComponent(parishAdd)}`));
	});

	it('should run the default (first) ruleset when none is selected', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const db = dbReturning([[realProjectRow()], []]);
		await handlerFor(db)({ params: { caseId: realProjectId }, query: {} }, mockRes);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.rulesetName, 'Example ruleset');
	});

	it('should 404 for a present-but-unknown ruleset', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const db = dbReturning([[realProjectRow()]]);
		await handlerFor(db)({ params: { caseId: realProjectId }, query: { ruleset: 'not-a-real-ruleset' } }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
	});

	it('should 404 when caseId is missing or malformed', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const handler = handlerFor({ $queryRaw: mock.fn() });
		await handler({ params: {}, query: {} }, mockRes);
		await handler({ params: { caseId: 'not-a-uuid' }, query: {} }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
		assert.strictEqual(mockRes.status.mock.calls[1].arguments[0], 404);
	});

	it('should 404 for a well-formed id that matches no project', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const db = dbReturning([[]]);
		await handlerFor(db)({ params: { caseId: realProjectId }, query: {} }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
	});

	it('should hide the consultee list and flag the failure if the ruleset errors', async () => {
		const nunjucks = configureNunjucks();
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn((view, data) => nunjucks.render(view, data))
		};
		let call = 0;
		const db = {
			$queryRaw: mock.fn(async () => {
				call += 1;
				if (call === 1) return [realProjectRow()];
				throw new Error('query failed');
			})
		};
		const logger = mockLogger();
		const handler = buildReportCheckPage({ db, logger, nearbyConsulteeRadiusMetres: 20_000 });
		await handler({ params: { caseId: realProjectId }, query: {} }, mockRes);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.rulesetFailed, true);
		assert.strictEqual(logger.error.mock.callCount(), 1);
		assert.doesNotMatch(mockRes.render.mock.calls[0].result, /Identified consultees/);
	});
});

describe('report created page', () => {
	function summaryDb() {
		return {
			$queryRaw: mock.fn(async () => [
				{
					id: realProjectId,
					caseReference: 'EN010099',
					caseName: 'Real Test Project',
					receivedDate: null,
					acceptance: null
				}
			])
		};
	}

	it('should render the confirmation panel and the download link', async () => {
		const nunjucks = configureNunjucks();
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn((view, data) => nunjucks.render(view, data))
		};
		const handler = buildReportCreatedPage({ db: summaryDb() });
		await handler({ params: { caseId: realProjectId }, query: {} }, mockRes);

		assert.strictEqual(mockRes.render.mock.calls[0].arguments[0], 'views/consultees/report/created.njk');
		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.pageHeading, 'Report created');
		assert.strictEqual(viewModel.caseName, 'Real Test Project');
		assert.strictEqual(viewModel.reference, 'EN010099');
		assert.strictEqual(viewModel.backLinkUrl, `/consultees/${realProjectId}?ruleset=example-ruleset`);

		const html = mockRes.render.mock.calls[0].result;
		assert.match(html, /Report created/);
		assert.match(html, /Download Real Test Project scoping report/);
	});

	it('should 404 for a present-but-unknown ruleset', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const handler = buildReportCreatedPage({ db: summaryDb() });
		await handler({ params: { caseId: realProjectId }, query: { ruleset: 'not-a-real-ruleset' } }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
	});

	it('should 404 when caseId is missing or malformed', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const handler = buildReportCreatedPage({ db: { $queryRaw: mock.fn() } });
		await handler({ params: {}, query: {} }, mockRes);
		await handler({ params: { caseId: 'not-a-uuid' }, query: {} }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
		assert.strictEqual(mockRes.status.mock.calls[1].arguments[0], 404);
	});

	it('should 404 for a well-formed id that matches no project', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const handler = buildReportCreatedPage({ db: { $queryRaw: mock.fn(async () => []) } });
		await handler({ params: { caseId: realProjectId }, query: {} }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
	});
});
