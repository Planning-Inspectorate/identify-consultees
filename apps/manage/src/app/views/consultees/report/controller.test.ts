import { mockLogger } from '@planning-inspectorate/core/testing';
import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import { configureNunjucks } from '../../../nunjucks.ts';
import type { ConsulteeAreaMatchRow } from '../../../testing/ruleset-runner-stub.ts';
import { failingRulesetRunner, rulesetRunnerReturning } from '../../../testing/ruleset-runner-stub.ts';
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

// rows[0] answers the project lookup; rows[1], if given, is what the ruleset matched - returned by
// the stand-in Python function (see rulesetRunnerFor), and by the database as the map's display geometry
function dbReturning(rows: unknown[][]) {
	let call = 0;
	return {
		matchRows: (rows[1] ?? []) as ConsulteeAreaMatchRow[],
		$queryRaw: mock.fn(async (sql: TemplateStringsArray) => {
			// the map's search area is a query on the site alone (no table) - answer it with the site
			if (!/\bFROM\b/.test(sql.join(''))) return [{ wkt: realProjectRow().geometryWkt }];
			return rows[Math.min(call++, rows.length - 1)] ?? [];
		})
	};
}

function rulesetRunnerFor(db: unknown) {
	return rulesetRunnerReturning((db as { matchRows?: ConsulteeAreaMatchRow[] }).matchRows ?? []);
}

function handlerFor(db: unknown) {
	return buildReportCheckPage({
		db,
		logger: mockLogger(),
		nearbyConsulteeRadiusMetres: 20_000,
		rulesetRunner: rulesetRunnerFor(db)
	});
}

describe('consultee report check page', () => {
	it('should render the report details and per-category consultee counts', async () => {
		const nunjucks = configureNunjucks();
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn((view, data) => nunjucks.render(view, data))
		};
		const db = dbReturning([[realProjectRow()], [parishMatchRow()]]);
		await handlerFor(db)(
			{ params: { caseId: realProjectId }, query: { ruleset: 'england-wales-post-20240430' } },
			mockRes
		);

		assert.strictEqual(mockRes.render.mock.calls[0].arguments[0], 'views/consultees/report/view.njk');
		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.pageHeading, 'Check consultees before creating the report');
		assert.strictEqual(viewModel.caseName, 'Real Test Project');
		assert.strictEqual(viewModel.reference, 'EN010099');
		assert.strictEqual(viewModel.caseChangeUrl, '/');
		assert.strictEqual(viewModel.shapefileName, 'Not provided');
		assert.strictEqual(viewModel.shapefileChangeUrl, `/consultees/${realProjectId}`);
		assert.strictEqual(viewModel.rulesetName, 'England Wales post 30 April 2024');
		// back, and the ruleset's Change, both lead to the ruleset picker the check page followed
		assert.strictEqual(
			viewModel.backLinkUrl,
			`/consultees/${realProjectId}/ruleset?ruleset=england-wales-post-20240430`
		);
		assert.strictEqual(
			viewModel.rulesetChangeUrl,
			`/consultees/${realProjectId}/ruleset?ruleset=england-wales-post-20240430`
		);
		assert.strictEqual(
			viewModel.generateReportUrl,
			`/consultees/${realProjectId}/report/created?ruleset=england-wales-post-20240430`
		);

		// one row per ruleset category, in ruleset order - matched ones carry their consultee names
		const parishRow = viewModel.consultees.find((row: { name: string }) => row.name === 'Parish Council');
		assert.strictEqual(parishRow.total, 1);
		assert.deepStrictEqual(parishRow.names, ['Little Snoring Parish Council']);
		assert.ok(viewModel.consultees.every((row: { names: string[] }) => Array.isArray(row.names)));
		assert.ok(viewModel.consultees.length > 1);
		// every category's Change link opens its shared consultees page for the same ruleset
		assert.ok(
			viewModel.consultees.every((row: { changeUrl: string }) =>
				row.changeUrl.startsWith(
					`/consultees/${realProjectId}/report/consultees?ruleset=england-wales-post-20240430&category=`
				)
			)
		);
		assert.match(parishRow.changeUrl, /category=Parish%20Council/);

		const html = mockRes.render.mock.calls[0].result;
		assert.match(html, /Report details/);
		assert.match(html, /Identified consultees/);
		assert.match(html, /Little Snoring Parish Council/);
		assert.match(html, /Create report/);
	});

	it('should subtract excluded consultees from the counts and carry exclusions through the links', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const excludedId = '55555555-5555-5555-5555-555555555555';
		const db = dbReturning([[realProjectRow()], [parishMatchRow()]]);
		await handlerFor(db)(
			{ params: { caseId: realProjectId }, query: { ruleset: 'england-wales-post-20240430', exclude: excludedId } },
			mockRes
		);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		// the only match was excluded - the total is the number of rows its Change page would list
		const parishRow = viewModel.consultees.find((row: { name: string }) => row.name === 'Parish Council');
		assert.strictEqual(parishRow.total, 0);
		assert.deepStrictEqual(parishRow.names, []);
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
				query: { ruleset: 'england-wales-post-20240430', add: [parishAdd, hospitalAdd] }
			},
			mockRes
		);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		const parishRow = viewModel.consultees.find((row: { name: string }) => row.name === 'Parish Council');
		const hospitalRow = viewModel.consultees.find((row: { name: string }) => row.name === 'Hospital');
		// one ruleset match + one hand-added row
		assert.strictEqual(parishRow.total, 2);
		assert.deepStrictEqual(parishRow.names, ['Little Snoring Parish Council', 'Test Consultee']);
		assert.strictEqual(hospitalRow.total, 1);
		assert.deepStrictEqual(hospitalRow.names, ['Other Test Consultee']);
		// the adds reach the Change pages and the report-created link unchanged
		assert.ok(parishRow.changeUrl.includes(`add=${encodeURIComponent(parishAdd)}`));
		assert.ok(hospitalRow.changeUrl.includes(`add=${encodeURIComponent(hospitalAdd)}`));
		assert.ok(viewModel.generateReportUrl.includes(`add=${encodeURIComponent(parishAdd)}`));
	});

	it('should cap the listed names at 10 and say how many the category really has', async () => {
		const nunjucks = configureNunjucks();
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn((view, data) => nunjucks.render(view, data))
		};
		const manyParishes = Array.from({ length: 12 }, (_, i) => ({
			...parishMatchRow(),
			id: `55555555-5555-5555-5555-${String(i + 1).padStart(12, '0')}`,
			consultee: `Parish Council ${i + 1}`
		}));
		const db = dbReturning([[realProjectRow()], manyParishes]);
		await handlerFor(db)(
			{ params: { caseId: realProjectId }, query: { ruleset: 'england-wales-post-20240430' } },
			mockRes
		);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		const parishRow = viewModel.consultees.find((row: { name: string }) => row.name === 'Parish Council');
		assert.strictEqual(parishRow.total, 12);
		assert.strictEqual(parishRow.names.length, 10);
		assert.strictEqual(parishRow.names[0], 'Parish Council 1');

		const html = mockRes.render.mock.calls[0].result;
		assert.match(html, /Showing 10 of 12 consultees/);
	});

	it('should run the default (first) ruleset when none is selected', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const db = dbReturning([[realProjectRow()], []]);
		await handlerFor(db)({ params: { caseId: realProjectId }, query: {} }, mockRes);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.rulesetName, 'England Wales post 30 April 2024');
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
		const handler = buildReportCheckPage({
			db,
			logger,
			nearbyConsulteeRadiusMetres: 20_000,
			rulesetRunner: failingRulesetRunner()
		});
		await handler({ params: { caseId: realProjectId }, query: {} }, mockRes);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.rulesetFailed, true);
		assert.strictEqual(logger.error.mock.callCount(), 1);
		assert.doesNotMatch(mockRes.render.mock.calls[0].result, /Identified consultees/);
	});
});

describe('report created page', () => {
	const hospitalRow = () => ({
		...parishMatchRow(),
		id: '66666666-6666-6666-6666-666666666666',
		consulteeCategory: 'Hospital',
		consultee: 'Norfolk Hospital',
		reasons: [
			{ type: 'condition' as const, conditionId: 'hospital' },
			{ type: 'nearby' as const, radiusMetres: 20_000 }
		]
	});
	const parishRow = () => ({
		...parishMatchRow(),
		reasons: [{ type: 'condition' as const, conditionId: 'b_host_parish_comm_council' }]
	});

	function createdPage(rows: ConsulteeAreaMatchRow[], rulesetRunner = rulesetRunnerReturning(rows)) {
		const nunjucks = configureNunjucks();
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn((view, data) => nunjucks.render(view, data))
		};
		const handler = buildReportCreatedPage({
			db: dbReturning([[realProjectRow()]]),
			logger: mockLogger(),
			nearbyConsulteeRadiusMetres: 20_000,
			rulesetRunner
		});
		return { handler, mockRes };
	}

	it("should render the confirmation panel, the download link and the report's consultees with why", async () => {
		const { handler, mockRes } = createdPage([parishRow(), hospitalRow()]);
		await handler({ params: { caseId: realProjectId }, query: {} }, mockRes);

		assert.strictEqual(mockRes.render.mock.calls[0].arguments[0], 'views/consultees/report/created.njk');
		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.pageHeading, 'Report created');
		assert.strictEqual(viewModel.caseName, 'Real Test Project');
		assert.strictEqual(viewModel.reference, 'EN010099');
		// back lands on the check page the report was created from
		assert.strictEqual(
			viewModel.backLinkUrl,
			`/consultees/${realProjectId}/report?ruleset=england-wales-post-20240430`
		);
		// by category, in the check page's order (the ruleset names parishes before hospitals)
		assert.deepStrictEqual(viewModel.report, [
			{
				category: 'Parish Council',
				consultees: [
					{
						name: 'Little Snoring Parish Council',
						identified: ['"B" host Parishes or Community Councils: intersects the site']
					}
				]
			},
			{
				category: 'Hospital',
				consultees: [
					{
						name: 'Norfolk Hospital',
						identified: ['Hospitals: within 10km of the site', 'Within 20km of the site']
					}
				]
			}
		]);
		assert.strictEqual(viewModel.consulteeCount, 2);

		const html = mockRes.render.mock.calls[0].result;
		assert.match(html, /Report created/);
		assert.match(html, /Download Real Test Project scoping report/);
		assert.match(html, /Consultees in the report \(2\)/);
		assert.match(html, /Why identified/);
		assert.match(html, /Hospitals: within 10km of the site<br>Within 20km of the site/);
	});

	it('should leave out removed consultees and include hand-added ones, with the reason given', async () => {
		const { handler, mockRes } = createdPage([parishRow(), hospitalRow()]);
		const add = (category: string, name: string, reason = '') => JSON.stringify({ c: category, n: name, r: reason });
		await handler(
			{
				params: { caseId: realProjectId },
				query: {
					exclude: '55555555-5555-5555-5555-555555555555',
					add: [add('Hospital', 'Added Hospital', 'Asked to be consulted'), add('Landowner', 'Mr Smith')]
				}
			},
			mockRes
		);

		const { report, consulteeCount } = mockRes.render.mock.calls[0].arguments[1];
		// the removed parish leaves its category empty, so it's not listed; a category only a
		// hand-added consultee is in comes last
		assert.deepStrictEqual(report, [
			{
				category: 'Hospital',
				consultees: [
					{ name: 'Norfolk Hospital', identified: ['Hospitals: within 10km of the site', 'Within 20km of the site'] },
					{ name: 'Added Hospital', identified: ['Asked to be consulted'] }
				]
			},
			{ category: 'Landowner', consultees: [{ name: 'Mr Smith', identified: ['Manually added'] }] }
		]);
		assert.strictEqual(consulteeCount, 3);
	});

	it('should say when no consultees are in the report', async () => {
		const { handler, mockRes } = createdPage([]);
		await handler({ params: { caseId: realProjectId }, query: {} }, mockRes);
		assert.match(mockRes.render.mock.calls[0].result, /No consultees are in the report/);
	});

	it('should say the ruleset could not be run rather than show an empty report', async () => {
		const { handler, mockRes } = createdPage([], failingRulesetRunner());
		await handler({ params: { caseId: realProjectId }, query: { exclude: 'abc' } }, mockRes);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.rulesetFailed, true);
		assert.deepStrictEqual(viewModel.report, []);
		assert.match(viewModel.retryUrl, /\/report\/created\?ruleset=england-wales-post-20240430/);
		const html = mockRes.render.mock.calls[0].result;
		assert.match(html, /The ruleset could not be run/);
		assert.doesNotMatch(html, /Consultees in the report/);
	});

	it('should 404 for a present-but-unknown ruleset', async () => {
		const { handler, mockRes } = createdPage([]);
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
