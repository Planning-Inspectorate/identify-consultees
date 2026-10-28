import type { Ruleset } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import { mockLogger } from '@planning-inspectorate/core/testing';
import { unzipSync } from 'fflate';
import assert from 'node:assert';
import { after, before, describe, it, mock } from 'node:test';
import { configureNunjucks } from '../../../nunjucks.ts';
import { ONE_PIXEL_PNG } from '../../../testing/pdf-text.ts';
import type { ConsulteeAreaMatchRow } from '../../../testing/ruleset-runner-stub.ts';
import { failingRulesetRunner, rulesetRunnerReturning } from '../../../testing/ruleset-runner-stub.ts';
import { buildReportCheckPage, buildReportCreatedPage, groupedConsultees } from './controller.ts';
import { rememberedReportZip } from './export/report-zip.ts';

// a selection entry as the app's URLs carry it - base64url-encoded JSON (see urls.ts's ENCODED_JSON)
const urlParam = (json: string) => Buffer.from(json).toString('base64url');

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
			const text = sql.join('');
			// the map's search area is a query on the site alone (no table) - answer it with the site
			if (!/\bFROM\b/.test(text)) return [{ wkt: realProjectRow().geometryWkt }];
			// the report maps' display-geometry query - each matched consultee's shape
			if (text.includes('AS tolerance')) {
				return ((rows[1] ?? []) as { id: string; geometryWkt?: string }[]).map((row) => ({
					id: row.id,
					geometryWkt: row.geometryWkt ?? 'POINT(-1.5 52.5)'
				}));
			}
			return rows[Math.min(call++, rows.length - 1)] ?? [];
		}),
		consulteeArea: {
			findMany: mock.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
				where.id.in.map((id) => ({
					id,
					geometryType: 'Point',
					sourceId: null,
					consulteeCategory: 'Parish Council',
					consulteeGroup: null,
					consultee: `Parish ${id}`,
					region: 'East',
					metadata: '{}',
					lastUpdated: new Date('2026-10-01T09:00:00Z')
				}))
			)
		}
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

// every category row the page lists, whichever group it sits under
const allRows = (viewModel: { groups: { consultees: { name: string }[] }[] }) =>
	viewModel.groups.flatMap((group) => group.consultees);
const rowNamed = (viewModel: { groups: { consultees: { name: string }[] }[] }, name: string) =>
	allRows(viewModel).find((row) => row.name === name);

describe('consultee report check page', () => {
	it('should count only consultees a condition identified, not ones only the nearby search found', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const nearbyParish = {
			...parishMatchRow('88888888-8888-8888-8888-888888888888', 'Nearby Parish Council'),
			reasons: [{ type: 'nearby' as const, radiusMetres: 20_000 }]
		};
		// the default ruleset (England Wales post 30 April 2024) has no Local Resilience Forum condition
		const nearbyForum = {
			...parishMatchRow('99999999-9999-9999-9999-999999999999', 'Example Local Resilience Forum'),
			consulteeCategory: 'Local Resilience Forum',
			reasons: [{ type: 'nearby' as const, radiusMetres: 20_000 }]
		};
		const db = dbReturning([[realProjectRow()], [parishMatchRow(), nearbyParish, nearbyForum]]);
		await handlerFor(db)({ params: { caseId: realProjectId }, query: {} }, mockRes);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.deepStrictEqual(rowNamed(viewModel, 'Parish Council')?.names, ['Little Snoring Parish Council']);
		// a category only the nearby search found isn't listed at all
		assert.ok(!allRows(viewModel).some((category) => category.name === 'Local Resilience Forum'));
	});

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

		// one row per ruleset category, grouped under the export's tabs, in ruleset order
		const parishRow = rowNamed(viewModel, 'Parish Council');
		assert.deepStrictEqual(parishRow.names, ['Little Snoring Parish Council']);
		assert.ok(allRows(viewModel).every((row: { names: string[] }) => Array.isArray(row.names)));
		assert.ok(allRows(viewModel).length > 1);
		// every category's Change link opens its shared consultees page for the same ruleset
		assert.ok(
			allRows(viewModel).every((row: { changeUrl: string }) =>
				row.changeUrl.startsWith(
					`/consultees/${realProjectId}/report/consultees?ruleset=england-wales-post-20240430&category=`
				)
			)
		);
		assert.match(parishRow.changeUrl, /category=Parish%20Council/);

		// a group's rows are the categories the export's tab of the same name lists
		const administrative = viewModel.groups.find(
			(group: { name: string }) => group.name === 'Administrative boundaries'
		);
		assert.ok(administrative.consultees.some((row: { name: string }) => row.name === 'Parish Council'));
		const publicBodies = viewModel.groups.find((group: { name: string }) => group.name === 'Public bodies');
		assert.ok(publicBodies.consultees.some((row: { name: string }) => row.name === 'Hospital'));

		const html = mockRes.render.mock.calls[0].result;
		assert.match(html, /Report details/);
		assert.match(html, /Identified consultees/);
		assert.match(html, /Administrative boundaries/);
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
		// the only match was excluded - the category row lists no names
		const parishRow = rowNamed(viewModel, 'Parish Council');
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
		const parishRow = rowNamed(viewModel, 'Parish Council');
		const hospitalRow = rowNamed(viewModel, 'Hospital');
		// one ruleset match + one hand-added row
		assert.deepStrictEqual(parishRow.names, ['Little Snoring Parish Council', 'Test Consultee']);
		assert.deepStrictEqual(hospitalRow.names, ['Other Test Consultee']);
		// the adds reach the Change pages and the report-created link unchanged
		assert.ok(parishRow.changeUrl.includes(`add=${urlParam(parishAdd)}`));
		assert.ok(hospitalRow.changeUrl.includes(`add=${urlParam(hospitalAdd)}`));
		assert.ok(viewModel.generateReportUrl.includes(`add=${urlParam(parishAdd)}`));
	});

	it('should list the first five names and put the rest behind "Show more"', async () => {
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
		const parishRow = rowNamed(viewModel, 'Parish Council');
		assert.strictEqual(parishRow.names.length, 12);

		// all twelve names are in the row - the first five listed, the rest inside the details
		const html = mockRes.render.mock.calls[0].result;
		assert.match(html, /Show more/);
		// the open state's "Show less" is the same summary moved below the list (see
		// .pins-show-more in style.scss) - both labels ship inside the one summary
		assert.match(html, /class="govuk-details pins-show-more"/);
		assert.match(html, /pins-show-more__less">Show less/);
		assert.strictEqual(html.match(/<li>Parish Council \d+<\/li>/g)?.length, 12);
		const shown = html.slice(0, html.indexOf('Show more'));
		assert.match(shown, /<li>Parish Council 5<\/li>/);
		assert.doesNotMatch(shown, /Parish Council 6/);
		const details = html.slice(html.indexOf('Show more'), html.indexOf('</details>'));
		assert.match(details, /<li>Parish Council 12<\/li>/);
	});

	it('should leave out a group the ruleset covers no categories in', () => {
		// the shipped rulesets all span the five tabs, but a ruleset isn't required to
		const ruleset = {
			id: 'test-ruleset',
			name: 'Test',
			rules: [
				{ id: 'a', name: 'a', group: 'Administative boundaries', categories: ['Parish Council'] },
				{ id: 'b', name: 'b', group: 'Public bodies', categories: ['Hospital'] }
			]
		} as unknown as Ruleset;
		const groups = groupedConsultees(ruleset, realProjectId, [], { removed: [], adds: [] });
		assert.deepStrictEqual(
			groups.map((group) => group.name),
			['Administrative boundaries', 'Public bodies']
		);
	});

	it('should list Nearby NSIPs last, under their own heading, while they are looked for - found or not', () => {
		const ruleset = {
			id: 'test-ruleset',
			name: 'Test',
			rules: [{ id: 'a', name: 'a', group: 'Administative boundaries', categories: ['Parish Council'] }]
		} as unknown as Ruleset;
		const none = { removed: [], adds: [] };
		assert.deepStrictEqual(
			groupedConsultees(ruleset, realProjectId, [], none, true).map((group) => [
				group.name,
				group.consultees.map((row) => [row.name, row.names])
			]),
			[
				['Administrative boundaries', [['Parish Council', []]]],
				['NSIPs', [['NSIPs', []]]]
			]
		);
		const nearbyNsip = {
			feature: { id: 'n', properties: { consulteeCategory: 'NSIPs', consultee: 'Neighbour (EN010200)' } },
			distanceMetres: 2_000,
			reasons: [{ type: 'nearbyNsip' as const, radiusMetres: 10_000 }]
		};
		const found = groupedConsultees(ruleset, realProjectId, [nearbyNsip], none, true);
		assert.deepStrictEqual(found.at(-1)?.consultees, [
			{
				name: 'NSIPs',
				names: ['Neighbour (EN010200)'],
				changeUrl:
					'/consultees/44444444-4444-4444-4444-444444444444/report/consultees?ruleset=test-ruleset&category=NSIPs'
			}
		]);
		// not looked for, there's no row for them
		assert.ok(!groupedConsultees(ruleset, realProjectId, [], none).some((group) => group.name === 'NSIPs'));
	});

	it('should warn when the site was screened against its bounding box, so the list gets reviewed', async () => {
		const nunjucks = configureNunjucks();
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn((view: string, data: object) => nunjucks.render(view, data))
		};
		const db = dbReturning([[realProjectRow()], []]);
		await buildReportCheckPage({
			db,
			logger: mockLogger(),
			nearbyConsulteeRadiusMetres: 20_000,
			rulesetRunner: mock.fn(async () => ({ consultees: [], siteScreenedAs: 'boundingBox' as const }))
		} as never)({ params: { caseId: realProjectId }, query: {} } as never, mockRes as never);

		assert.strictEqual(mockRes.render.mock.calls[0].arguments[1].screenedBoundingBox, true);
		assert.match(mockRes.render.mock.calls[0].result as string, /outline is too detailed to screen in time/);
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
			{
				type: 'condition' as const,
				conditionId: 'hospitals_operated_by_nhs_trusts_and_nhs_foundation_trusts_england_10km'
			},
			{ type: 'nearby' as const, radiusMetres: 20_000 }
		]
	});
	const parishRow = () => ({
		...parishMatchRow(),
		reasons: [{ type: 'condition' as const, conditionId: 'b_host_parish_town_community_councils' }]
	});

	// the report's map PDFs fetch basemap tiles - never the real tile server from a test
	const originalFetch = globalThis.fetch;
	before(() => {
		globalThis.fetch = async () =>
			new Response(ONE_PIXEL_PNG, { status: 200, headers: { 'content-type': 'image/png' } });
	});
	after(() => {
		globalThis.fetch = originalFetch;
	});

	function createdPage(
		rows: ConsulteeAreaMatchRow[],
		rulesetRunner = rulesetRunnerReturning(rows),
		db = dbReturning([[realProjectRow()]])
	) {
		const nunjucks = configureNunjucks();
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn((view, data) => nunjucks.render(view, data))
		};
		const handler = buildReportCreatedPage({
			db,
			logger: mockLogger(),
			nearbyConsulteeRadiusMetres: 20_000,
			nearbySearchRadiusMetres: 20_000,
			rulesetRunner
		});
		return { handler, mockRes, db };
	}

	it("should render the confirmation panel and the download link with the built report's size", async () => {
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

		const html = mockRes.render.mock.calls[0].result;
		assert.match(html, /Report created/);
		assert.match(html, /Project: Real Test Project/);
		assert.match(html, /govuk-grid-column-two-thirds/);
		// the report ZIP is built as the page renders, so the link can give its real size
		assert.match(html, /Download Real Test Project Consultee List report \(ZIP, [\d.]+[KM]B\)/);
		assert.match(html, new RegExp(`href="/consultees/${realProjectId}/report/download\\?ruleset=`));
		// the page no longer lists the report's consultees
		assert.doesNotMatch(html, /Consultees in the report/);
		assert.doesNotMatch(html, /Little Snoring/);

		// and the built report is kept for the download link to serve
		const kept = rememberedReportZip(viewModel.downloadUrl);
		assert.ok(kept);
		const files = unzipSync(new Uint8Array(kept.contents));
		assert.ok(Object.keys(files).some((name) => name.endsWith('.xlsx')));
		assert.ok(files['maps/01 Parish Council.pdf']);
		assert.ok(files['maps/02 Hospital.pdf']);
	});

	it('should carry the consultee selection into the download link and the report it serves', async () => {
		const { handler, mockRes } = createdPage([parishRow(), hospitalRow()]);
		const add = JSON.stringify({ c: 'Landowner', n: 'Mr Smith', r: 'Owns the access road' });
		await handler(
			{
				params: { caseId: realProjectId },
				query: { exclude: '55555555-5555-5555-5555-555555555555', add }
			},
			mockRes
		);

		const { downloadUrl } = mockRes.render.mock.calls[0].arguments[1];
		assert.match(downloadUrl, /exclude=/);
		assert.match(downloadUrl, /add=/);
		// the kept report reflects the selection: the removed parish is out, the added landowner in
		const kept = rememberedReportZip(downloadUrl);
		assert.ok(kept);
		const files = unzipSync(new Uint8Array(kept.contents));
		assert.ok(files['maps/01 Hospital.pdf']);
		assert.ok(files['maps/02 Landowner.pdf']);
		assert.ok(!files['maps/01 Parish Council.pdf']);
	});

	it('should build the report once for a URL and serve the kept copy on a refresh', async () => {
		const { handler, mockRes, db } = createdPage([parishRow()]);
		const request = {
			params: { caseId: realProjectId },
			query: {
				add: urlParam(
					JSON.stringify({ i: '99999999-9999-9999-9999-999999999999', c: 'Parish Council', n: 'Kept', r: '' })
				)
			}
		};
		await handler(request, mockRes);
		const downloadText = mockRes.render.mock.calls[0].arguments[1].downloadText;
		await handler(request, mockRes);

		// the second render served the kept report - the stored rows were fetched only once
		assert.strictEqual(db.consulteeArea.findMany.mock.callCount(), 1);
		assert.strictEqual(mockRes.render.mock.calls[1].arguments[1].downloadText, downloadText);
	});

	it('should show the download error and no link when the report cannot be built', async () => {
		const db = dbReturning([[realProjectRow()]]);
		db.consulteeArea.findMany = mock.fn(async () => {
			throw new Error('db down');
		});
		const { handler, mockRes } = createdPage([parishRow()], rulesetRunnerReturning([parishRow()]), db);
		await handler(
			{
				params: { caseId: realProjectId },
				// a URL no other test uses - a kept copy would hide that the build failed
				query: { exclude: 'cccccccc-0000-0000-0000-000000000042' }
			},
			mockRes
		);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.downloadFailed, true);
		const html = mockRes.render.mock.calls[0].result;
		assert.match(html, /govuk-panel--error/);
		assert.match(html, /scoping report could not be downloaded/);
		assert.doesNotMatch(html, /report\/download/);
	});

	it('should show the size even when no consultees are in the report', async () => {
		const { handler, mockRes } = createdPage([]);
		await handler(
			{
				params: { caseId: realProjectId },
				query: { exclude: 'dddddddd-0000-0000-0000-000000000042' }
			},
			mockRes
		);
		assert.match(mockRes.render.mock.calls[0].result, /\(ZIP, [\d.]+[KM]B\)/);
	});

	it('should fail to build the report while the test-fail=download fault is set', async () => {
		const db = dbReturning([[realProjectRow()]]);
		const nunjucks = configureNunjucks();
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn((view, data) => nunjucks.render(view, data))
		};
		const handler = buildReportCreatedPage({
			db,
			logger: mockLogger(),
			nearbyConsulteeRadiusMetres: 20_000,
			nearbySearchRadiusMetres: 20_000,
			rulesetRunner: rulesetRunnerReturning([parishRow()]),
			testFaultsEnabled: true
		});
		await handler(
			{
				params: { caseId: realProjectId },
				// a URL no other test uses - a kept copy would hide that the build was skipped
				query: { exclude: 'abababab-0000-0000-0000-000000000042', 'test-fail': 'download' },
				session: {}
			},
			mockRes
		);

		// the build never ran, so nothing is kept for the download, and the page shows the
		// failure state straight away - red panel, error, no download link
		assert.strictEqual(db.consulteeArea.findMany.mock.callCount(), 0);
		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(rememberedReportZip(viewModel.downloadUrl), undefined);
		assert.strictEqual(viewModel.downloadFailed, true);
		assert.strictEqual(viewModel.pageHeading, 'Report could not be created');
		const html = mockRes.render.mock.calls[0].result;
		assert.match(html, /govuk-panel--error/);
		assert.match(html, /scoping report could not be downloaded/);
		assert.doesNotMatch(html, /report\/download/);
	});

	it('should show a govuk error message in a red panel, and no download link, when the download itself failed', async () => {
		const { handler, mockRes } = createdPage([parishRow()]);
		await handler(
			{
				params: { caseId: realProjectId },
				query: { download: 'failed', exclude: 'ffffffff-0000-0000-0000-000000000042' }
			},
			mockRes
		);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.downloadFailed, true);
		const html = mockRes.render.mock.calls[0].result;
		assert.match(html, /govuk-panel--error/);
		assert.match(html, /govuk-error-message/);
		assert.match(html, /scoping report could not be downloaded/);
		assert.match(html, /try again/);
		// no way back to the download while it's failing
		assert.doesNotMatch(html, /report\/download/);
		assert.doesNotMatch(html, /Retry download/);
	});

	it('should say the ruleset could not be run rather than build a report', async () => {
		const { handler, mockRes, db } = createdPage([], failingRulesetRunner());
		await handler({ params: { caseId: realProjectId }, query: { exclude: 'abc' } }, mockRes);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.rulesetFailed, true);
		assert.match(viewModel.retryUrl, /\/report\/created\?ruleset=england-wales-post-20240430/);
		// no report was built, so the link can't give a size
		assert.strictEqual(db.consulteeArea.findMany.mock.callCount(), 0);
		const html = mockRes.render.mock.calls[0].result;
		assert.match(html, /The ruleset could not be run/);
		assert.match(html, /The report could not be created/);
		assert.match(html, /\(ZIP\)/);
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
