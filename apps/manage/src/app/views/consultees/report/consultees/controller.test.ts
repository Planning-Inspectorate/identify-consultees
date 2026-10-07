import { mockLogger } from '@planning-inspectorate/core/testing';
import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import { configureNunjucks } from '../../../../nunjucks.ts';
import { buildReportConsulteesPage } from './controller.ts';

const realProjectId = '44444444-4444-4444-4444-444444444444';
const matchId = '55555555-5555-5555-5555-555555555555';
const otherMatchId = '66666666-6666-6666-6666-666666666666';

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

function parishMatchRow(id = matchId, consultee = 'Little Snoring Parish Council', distanceMetres = 0) {
	return {
		id,
		geometryType: 'MultiLineString',
		consulteeCategory: 'Parish Council',
		consultee,
		region: 'East of England',
		caseReference: null,
		documentId: null,
		consulteeId: null,
		organisationId: null,
		currentVersion: 1,
		metadata: '{}',
		geometryWkt: 'MULTILINESTRING((-1.5 52.5, -1.4 52.6))',
		distanceMetres
	};
}

// `query.add` holds the raw JSON param value (Express has already decoded it); expected URLs
// hold the encoded form
const addJson = (name: string, reason = '', category = 'Parish Council') =>
	JSON.stringify({ c: category, n: name, r: reason });
const addParam = (name: string, reason = '', category = 'Parish Council') =>
	encodeURIComponent(addJson(name, reason, category));

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
	return buildReportConsulteesPage({ db, logger: mockLogger(), nearbyConsulteeRadiusMetres: 20_000 });
}

describe('report consultees change page', () => {
	it('should render the category heading, map and consultee table with Remove links', async () => {
		const nunjucks = configureNunjucks();
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn((view, data) => nunjucks.render(view, data))
		};
		const db = dbReturning([[realProjectRow()], [parishMatchRow()]]);
		await handlerFor(db)(
			{ params: { caseId: realProjectId }, query: { ruleset: 'example-ruleset', category: 'Parish Council' } },
			mockRes
		);

		assert.strictEqual(mockRes.render.mock.calls[0].arguments[0], 'views/consultees/report/consultees/view.njk');
		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.pageHeading, 'Parish Council');
		assert.strictEqual(viewModel.pageCaption, 'Real Test Project');
		assert.strictEqual(viewModel.backLinkUrl, `/consultees/${realProjectId}/report?ruleset=example-ruleset`);
		assert.strictEqual(viewModel.saveAndReturnUrl, `/consultees/${realProjectId}/report?ruleset=example-ruleset`);
		assert.strictEqual(viewModel.rows.length, 1);
		assert.strictEqual(viewModel.rows[0].name, 'Little Snoring Parish Council');
		// the parish rules intersect the site - a zero-buffer identification
		assert.strictEqual(viewModel.rows[0].identified, 'Intersects the site');
		assert.strictEqual(
			viewModel.rows[0].removeUrl,
			`/consultees/${realProjectId}/report/consultees?ruleset=example-ruleset&category=Parish%20Council&exclude=${matchId}`
		);
		assert.strictEqual(
			viewModel.addConsulteeUrl,
			`/consultees/${realProjectId}/report/consultees/add?ruleset=example-ruleset&category=Parish%20Council`
		);
		assert.ok(viewModel.mapConfigJson.includes('FeatureCollection'));

		const html = mockRes.render.mock.calls[0].result;
		assert.match(html, /Remove/);
		assert.match(html, /Add consultee/);
		assert.match(html, /Save and return/);
	});

	it('should report a buffered identification when the match sits inside a rule’s buffer', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const hospitalRow = {
			...parishMatchRow(),
			consulteeCategory: 'Hospital',
			consultee: 'Norfolk Hospital',
			distanceMetres: 123.456
		};
		const db = dbReturning([[realProjectRow()], [hospitalRow]]);
		await handlerFor(db)({ params: { caseId: realProjectId }, query: { category: 'Hospital' } }, mockRes);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.rows[0].identified, 'Within 10km buffer');
	});

	it('should report the smallest buffer when several rules cover the category', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		// Ambulance Trust has both a 1km and a 10km rule - a match at 500m sits inside both, so the
		// honest label is the tighter one
		const ambulanceRow = {
			...parishMatchRow(),
			consulteeCategory: 'Ambulance Trust',
			consultee: 'East of England Ambulance Service',
			distanceMetres: 500
		};
		const db = dbReturning([[realProjectRow()], [ambulanceRow]]);
		await handlerFor(db)({ params: { caseId: realProjectId }, query: { category: 'Ambulance Trust' } }, mockRes);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.rows[0].identified, 'Within 1km buffer');
	});

	it('should report the bordering condition’s description when no buffer rule reached the match', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		// 500m is beyond the parish intersection rule's 0 buffer, so only the bordering condition
		// can have identified it - its own description is the honest label
		const db = dbReturning([[realProjectRow()], [parishMatchRow(matchId, 'Little Snoring Parish Council', 500)]]);
		await handlerFor(db)({ params: { caseId: realProjectId }, query: { category: 'Parish Council' } }, mockRes);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.rows[0].identified, '"A" Community Councils bordering "B" host Community Councils');
	});

	it('should leave the identification blank when no covering rule can explain the match', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		// a quirk of this mock: the same row comes back for every condition's own query, so it lands
		// in matches at 50km - outside Hospital's only (10km intersection) rule's reach and with no
		// bordering rule covering the category. Real data can't produce this, but the column must
		// still render something sane rather than crash
		const hospitalRow = {
			...parishMatchRow(),
			consulteeCategory: 'Hospital',
			consultee: 'Norfolk Hospital',
			distanceMetres: 50_000
		};
		const db = dbReturning([[realProjectRow()], [hospitalRow]]);
		await handlerFor(db)({ params: { caseId: realProjectId }, query: { category: 'Hospital' } }, mockRes);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.rows.length, 1);
		assert.strictEqual(viewModel.rows[0].identified, '');
	});

	it('should hide excluded consultees from the rows and the remove links keep the rest', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const db = dbReturning([
			[realProjectRow()],
			[parishMatchRow(), parishMatchRow(otherMatchId, 'Great Snoring Parish Council')]
		]);
		await handlerFor(db)(
			{
				params: { caseId: realProjectId },
				query: { category: 'Parish Council', exclude: matchId }
			},
			mockRes
		);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.rows.length, 1);
		assert.strictEqual(viewModel.rows[0].name, 'Great Snoring Parish Council');
		// the remaining row's remove link carries the existing exclusion forward
		assert.strictEqual(
			viewModel.rows[0].removeUrl,
			`/consultees/${realProjectId}/report/consultees?ruleset=example-ruleset&category=Parish%20Council&exclude=${matchId}&exclude=${otherMatchId}`
		);
		assert.strictEqual(
			viewModel.saveAndReturnUrl,
			`/consultees/${realProjectId}/report?ruleset=example-ruleset&exclude=${matchId}`
		);
	});

	it('should accept repeated exclude params and ignore blank or non-string values', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const unnamedRow = { ...parishMatchRow(otherMatchId, ''), consultee: null };
		const db = dbReturning([[realProjectRow()], [parishMatchRow(), unnamedRow]]);
		await handlerFor(db)(
			{
				params: { caseId: realProjectId },
				// ?exclude=a&exclude=b parses to an array; blanks and non-strings are ignored
				query: { category: 'Parish Council', exclude: [matchId, '', 42] }
			},
			mockRes
		);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.rows.length, 1);
		// a match with no consultee name still renders a usable row label
		assert.strictEqual(viewModel.rows[0].name, 'Unnamed consultee');
		// only the real exclusion is carried forward
		assert.strictEqual(
			viewModel.saveAndReturnUrl,
			`/consultees/${realProjectId}/report?ruleset=example-ruleset&exclude=${matchId}`
		);
	});

	it('should list hand-added consultees for the category after the ruleset matches', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const firstAdd = addJson('First Test Consultee', 'Bordering landowner');
		const secondAdd = addJson('Second Test Consultee');
		// an add recorded under a different category doesn't appear here
		const otherCategoryAdd = addJson('Hospital Test Consultee', 'r', 'Hospital');
		const db = dbReturning([[realProjectRow()], [parishMatchRow()]]);
		await handlerFor(db)(
			{
				params: { caseId: realProjectId },
				query: { category: 'Parish Council', add: [firstAdd, secondAdd, otherCategoryAdd] }
			},
			mockRes
		);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.rows.length, 3);
		assert.strictEqual(viewModel.rows[1].name, 'First Test Consultee');
		assert.strictEqual(viewModel.rows[1].identified, 'Bordering landowner');
		assert.strictEqual(viewModel.rows[2].name, 'Second Test Consultee');
		assert.strictEqual(viewModel.rows[2].identified, 'Manually added');

		// removing the first added row drops only its add param - the second stays
		assert.strictEqual(
			viewModel.rows[1].removeUrl,
			`/consultees/${realProjectId}/report/consultees?ruleset=example-ruleset&category=Parish%20Council&add=${encodeURIComponent(secondAdd)}&add=${encodeURIComponent(otherCategoryAdd)}`
		);
		assert.strictEqual(
			viewModel.rows[2].removeUrl,
			`/consultees/${realProjectId}/report/consultees?ruleset=example-ruleset&category=Parish%20Council&add=${encodeURIComponent(firstAdd)}&add=${encodeURIComponent(otherCategoryAdd)}`
		);
		// the adds ride along to the check page and the next add
		assert.ok(viewModel.saveAndReturnUrl.includes(`add=${encodeURIComponent(firstAdd)}`));
		assert.ok(viewModel.addConsulteeUrl.includes(`add=${encodeURIComponent(firstAdd)}`));
		// a ruleset match's remove link keeps the adds while excluding the match
		assert.match(viewModel.rows[0].removeUrl, /exclude=55555555/);
		assert.ok(viewModel.rows[0].removeUrl.includes(`add=${encodeURIComponent(firstAdd)}`));
	});

	it('should ignore malformed add params rather than fail the page', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const db = dbReturning([[realProjectRow()], [parishMatchRow()]]);
		await handlerFor(db)(
			{
				params: { caseId: realProjectId },
				query: {
					category: 'Parish Council',
					add: [
						'not-json',
						'{}',
						JSON.stringify({ c: '', n: 'empty category' }),
						addJson('', 'no name'),
						JSON.stringify({ c: 'Parish Council', n: 'Kept Consultee' }),
						42
					]
				}
			},
			mockRes
		);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.rows.length, 2);
		assert.strictEqual(viewModel.rows[1].name, 'Kept Consultee');
		// the dropped params aren't carried forward either
		assert.strictEqual((viewModel.saveAndReturnUrl.match(/add=/g) ?? []).length, 1);
	});

	it('should 404 for a category the ruleset does not cover', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const db = dbReturning([[realProjectRow()]]);
		await handlerFor(db)({ params: { caseId: realProjectId }, query: { category: 'Not A Category' } }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
	});

	it('should 404 for a missing category', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const db = dbReturning([[realProjectRow()]]);
		await handlerFor(db)({ params: { caseId: realProjectId }, query: {} }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
	});

	it('should 404 for a present-but-unknown ruleset', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const db = dbReturning([[realProjectRow()]]);
		await handlerFor(db)(
			{ params: { caseId: realProjectId }, query: { ruleset: 'not-a-real-ruleset', category: 'Parish Council' } },
			mockRes
		);
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
		await handlerFor(db)({ params: { caseId: realProjectId }, query: { category: 'Parish Council' } }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
	});

	it('should flag the ruleset as failed if the run errors', async () => {
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
		const handler = buildReportConsulteesPage({ db, logger, nearbyConsulteeRadiusMetres: 20_000 });
		await handler({ params: { caseId: realProjectId }, query: { category: 'Parish Council' } }, mockRes);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.rulesetFailed, true);
		assert.strictEqual(viewModel.rows.length, 0);
		assert.strictEqual(logger.error.mock.callCount(), 1);
		assert.doesNotMatch(mockRes.render.mock.calls[0].result, />Consultees</);
	});
});
