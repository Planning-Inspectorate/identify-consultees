import { mockLogger } from '#lib/testing/index.ts';
import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import { configureNunjucks } from '../../../../../nunjucks.ts';
import type { ConsulteeAreaMatchRow } from '../../../../../testing/ruleset-runner-stub.ts';
import { failingRulesetRunner, rulesetRunnerReturning } from '../../../../../testing/ruleset-runner-stub.ts';
import { buildReportConsulteeRemovePage, buildReportConsulteeRemoveSubmit } from './controller.ts';

// a selection entry as the app's URLs carry it - base64url-encoded JSON (see urls.ts's ENCODED_JSON)
const urlParam = (json: string) => Buffer.from(json).toString('base64url');

const realProjectId = '44444444-4444-4444-4444-444444444444';
const matchId = '55555555-5555-5555-5555-555555555555';

function realProjectRow() {
	return {
		id: realProjectId,
		geometryType: 'Point',
		caseReference: 'EN010099',
		caseName: 'Real Test Project',
		fileName: null,
		receivedDate: null,
		acceptance: null,
		metadata: '{}',
		geometryWkt: 'POINT(-1.5 52.5)'
	};
}

function summaryRow() {
	return {
		id: realProjectId,
		caseReference: 'EN010099',
		caseName: 'Real Test Project',
		receivedDate: null,
		acceptance: null
	};
}

function parishMatchRow(id = matchId, consultee = 'Little Snoring Parish Council') {
	return {
		reasons: [{ type: 'condition' as const, conditionId: 'b_host_parish_town_community_councils' }],
		id,
		geometryType: 'MultiLineString',
		consulteeCategory: 'Parish Council',
		consultee,
		region: 'East of England',
		metadata: '{}',
		geometryWkt: 'MULTILINESTRING((-1.5 52.5, -1.4 52.6))',
		distanceMetres: 0
	};
}

// `query.add`/`query.exclude` hold the raw param values (Express has already decoded them);
// expected URLs hold the encoded forms
const addJson = (name: string, reason = '', category = 'Parish Council') =>
	JSON.stringify({ c: category, n: name, r: reason });
const removalJson = (name: string, reason: string, id?: string, category = 'Parish Council') =>
	JSON.stringify({ ...(id ? { i: id } : {}), c: category, n: name, r: reason });

const parishQuery = { ruleset: 'england-wales-post-20240430', category: 'Parish Council' };

// rows[0] answers the project lookup; matchRows, if given, is what the ruleset matched - the
// added-consultee path only reads the summary, so dbFor covers it
function dbReturning(rows: unknown[][], matchRows: ConsulteeAreaMatchRow[] = []) {
	let call = 0;
	return {
		matchRows,
		$queryRaw: mock.fn(async () => rows[Math.min(call++, rows.length - 1)] ?? [])
	};
}

function service(db: unknown) {
	return {
		db,
		logger: mockLogger(),
		nearbyConsulteeRadiusMetres: 20_000,
		rulesetRunner: rulesetRunnerReturning((db as { matchRows?: ConsulteeAreaMatchRow[] }).matchRows ?? [])
	};
}

const removePage = (db: unknown) => buildReportConsulteeRemovePage(service(db));
const removeSubmit = (db: unknown) => buildReportConsulteeRemoveSubmit(service(db));

describe('report consultee remove page', () => {
	it('should render the remove-consultee form for a ruleset match target', async () => {
		const nunjucks = configureNunjucks();
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn((view, data) => nunjucks.render(view, data))
		};
		const db = dbReturning([[realProjectRow()]], [parishMatchRow()]);
		await removePage(db)({ params: { caseId: realProjectId }, query: { ...parishQuery, match: matchId } }, mockRes);

		assert.strictEqual(mockRes.render.mock.calls[0].arguments[0], 'views/consultees/report/consultees/remove/view.njk');
		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.pageHeading, 'Remove consultee');
		assert.strictEqual(viewModel.pageCaption, 'Real Test Project');
		assert.strictEqual(viewModel.name, 'Little Snoring Parish Council');
		assert.deepStrictEqual(viewModel.identified, ['"B" host Parish / Town / Community Councils: intersects the site']);
		assert.strictEqual(
			viewModel.backLinkUrl,
			`/consultees/${realProjectId}/report/consultees?ruleset=england-wales-post-20240430&category=Parish%20Council`
		);
		assert.strictEqual(
			viewModel.formAction,
			`/consultees/${realProjectId}/report/consultees/remove?ruleset=england-wales-post-20240430&category=Parish%20Council&match=${matchId}`
		);
		assert.strictEqual(viewModel.reasonValue, '');
		assert.strictEqual(viewModel.errorSummary, undefined);
		assert.strictEqual(viewModel.rulesetFailed, false);

		const html = mockRes.render.mock.calls[0].result;
		assert.match(html, /Remove consultee/);
		assert.match(html, /Little Snoring Parish Council/);
		assert.match(html, /Reason for removing/);
		assert.match(html, /<textarea[^>]*name="reason"/);
		// the reviewed layout: a two-thirds column, a large (not extra-large) heading, a bold label
		assert.match(html, /govuk-grid-column-two-thirds/);
		assert.match(html, /govuk-heading-l/);
		assert.match(html, /govuk-label--m/);
	});

	it('should fall back to the default ruleset when none is given', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		await removePage(dbReturning([[realProjectRow()]], [parishMatchRow()]))(
			{ params: { caseId: realProjectId }, query: { category: 'Parish Council', match: matchId } },
			mockRes
		);
		assert.strictEqual(mockRes.status.mock.callCount(), 0);
		assert.match(mockRes.render.mock.calls[0].arguments[1].formAction, /ruleset=england-wales-post-20240430/);
	});

	it('should render the form for a hand-added consultee target without running the ruleset', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const rulesetRunner = rulesetRunnerReturning([]);
		const db = { $queryRaw: mock.fn(async () => [summaryRow()]) };
		const handler = buildReportConsulteeRemovePage({ ...service(db), rulesetRunner });
		await handler(
			{
				params: { caseId: realProjectId },
				query: { ...parishQuery, add: addJson('Manual Consultee', 'Adjacent landowner'), added: '0' }
			},
			mockRes
		);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.name, 'Manual Consultee');
		assert.deepStrictEqual(viewModel.identified, ['Adjacent landowner']);
		assert.match(viewModel.formAction, /added=0/);
		assert.strictEqual(rulesetRunner.mock.callCount(), 0);
	});

	for (const [title, query] of [
		['neither a match nor an added target', parishQuery],
		['an unknown match id', { ...parishQuery, match: '99999999-9999-9999-9999-999999999999' }],
		['a match already removed', { ...parishQuery, match: matchId, exclude: matchId }],
		['a match in another category', { ...parishQuery, category: 'Hospital', match: matchId }],
		['a missing added index', { ...parishQuery, added: '0' }],
		['a non-numeric added index', { ...parishQuery, add: addJson('Manual Consultee'), added: 'abc' }],
		['an out-of-range added index', { ...parishQuery, add: addJson('Manual Consultee'), added: '5' }],
		['an added consultee in another category', { ...parishQuery, add: addJson('Other', 'r', 'Hospital'), added: '0' }],
		['an unknown ruleset', { ...parishQuery, ruleset: 'not-a-real-ruleset', match: matchId }]
	] as const) {
		it(`should 404 for ${title}`, async () => {
			const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
			await removePage(dbReturning([[realProjectRow()]], [parishMatchRow()]))(
				{ params: { caseId: realProjectId }, query },
				mockRes
			);
			assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
		});
	}

	it('should 404 for a consultee only the nearby search found - it is not in the report', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const nearbyOnly = { ...parishMatchRow(), reasons: [{ type: 'nearby' as const, radiusMetres: 20_000 }] };
		await removePage(dbReturning([[realProjectRow()]], [nearbyOnly]))(
			{ params: { caseId: realProjectId }, query: { ...parishQuery, match: matchId } },
			mockRes
		);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
	});

	it('should 404 when caseId is missing, malformed or matches no project', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const handler = removePage(dbReturning([[realProjectRow()]], [parishMatchRow()]));
		await handler({ params: {}, query: { ...parishQuery, match: matchId } }, mockRes);
		await handler({ params: { caseId: 'not-a-uuid' }, query: { ...parishQuery, match: matchId } }, mockRes);
		await removePage(dbReturning([[]], [parishMatchRow()]))(
			{ params: { caseId: realProjectId }, query: { ...parishQuery, match: matchId } },
			mockRes
		);
		assert.strictEqual(mockRes.status.mock.callCount(), 3);
		for (const call of mockRes.status.mock.calls) {
			assert.strictEqual(call.arguments[0], 404);
		}
	});

	it('should 404 for an added-consultee target when the project is not found', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		await removePage(dbReturning([[]]))(
			{
				params: { caseId: realProjectId },
				query: { ...parishQuery, add: addJson('Manual Consultee'), added: '0' }
			},
			mockRes
		);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
	});

	it('should flag the ruleset as failed when a match target cannot be resolved', async () => {
		const nunjucks = configureNunjucks();
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn((view, data) => nunjucks.render(view, data))
		};
		const logger = mockLogger();
		const handler = buildReportConsulteeRemovePage({
			db: dbReturning([[realProjectRow()]]),
			logger,
			nearbyConsulteeRadiusMetres: 20_000,
			rulesetRunner: failingRulesetRunner()
		});
		await handler({ params: { caseId: realProjectId }, query: { ...parishQuery, match: matchId } }, mockRes);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.rulesetFailed, true);
		assert.strictEqual(logger.error.mock.callCount(), 1);
		assert.match(mockRes.render.mock.calls[0].result, /The ruleset could not be run/);
	});
});

describe('report consultee remove submit', () => {
	const request = (overrides: Record<string, unknown> = {}) => ({
		params: { caseId: realProjectId },
		query: { ...parishQuery, match: matchId },
		body: { reason: 'Outside the search area' },
		...overrides
	});

	it('should record the removal with its reason and return to the category page', async () => {
		const mockRes = { redirect: mock.fn(), render: mock.fn(), status: mock.fn(() => mockRes) };
		await removeSubmit(dbReturning([[realProjectRow()]], [parishMatchRow()]))(request(), mockRes);

		const location = mockRes.redirect.mock.calls[0].arguments[0];
		assert.strictEqual(
			location,
			`/consultees/${realProjectId}/report/consultees?ruleset=england-wales-post-20240430&category=Parish%20Council&exclude=${urlParam(
				removalJson('Little Snoring Parish Council', 'Outside the search area', matchId)
			)}&removed=open`
		);
	});

	it('should drop a hand-added consultee’s add param and record the removal', async () => {
		const mockRes = { redirect: mock.fn(), render: mock.fn(), status: mock.fn(() => mockRes) };
		const kept = addJson('Kept Consultee', 'Still borders');
		const db = { $queryRaw: mock.fn(async () => [summaryRow()]) };
		await removeSubmit(db)(
			request({
				query: { ...parishQuery, add: [addJson('Manual Consultee'), kept], added: '0' },
				body: { reason: 'Added in error' }
			}),
			mockRes
		);

		const location = mockRes.redirect.mock.calls[0].arguments[0];
		// the removal is recorded (with no match id to exclude) and only the kept add remains
		assert.ok(location.includes(`exclude=${urlParam(removalJson('Manual Consultee', 'Added in error'))}`));
		assert.strictEqual(location.includes(urlParam(addJson('Manual Consultee'))), false);
		assert.ok(location.includes(`add=${urlParam(kept)}`));
	});

	it('should keep earlier removals and adds so any number can be removed one at a time', async () => {
		const mockRes = { redirect: mock.fn(), render: mock.fn(), status: mock.fn(() => mockRes) };
		const earlierRemoval = removalJson('Earlier Consultee', 'Duplicate entry');
		const existingAdd = addJson('Added Consultee', 'Landowner');
		await removeSubmit(dbReturning([[realProjectRow()]], [parishMatchRow()]))(
			request({ query: { ...parishQuery, match: matchId, exclude: earlierRemoval, add: existingAdd } }),
			mockRes
		);

		const location = mockRes.redirect.mock.calls[0].arguments[0];
		assert.ok(location.includes(`exclude=${urlParam(earlierRemoval)}`));
		assert.ok(
			location.includes(
				`exclude=${urlParam(removalJson('Little Snoring Parish Council', 'Outside the search area', matchId))}`
			)
		);
		assert.ok(location.includes(`add=${urlParam(existingAdd)}`));
	});

	it('should re-render the form with an error when the reason is blank', async () => {
		const nunjucks = configureNunjucks();
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn((view, data) => nunjucks.render(view, data)),
			redirect: mock.fn()
		};
		await removeSubmit(dbReturning([[realProjectRow()]], [parishMatchRow()]))(
			request({ body: { reason: '   ' } }),
			mockRes
		);

		assert.strictEqual(mockRes.redirect.mock.callCount(), 0);
		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.reasonError.text, 'Enter a reason for removing this consultee');
		assert.strictEqual(viewModel.reasonValue, '   ');
		assert.strictEqual(viewModel.errorSummary[0].href, '#removal-reason');

		const html = mockRes.render.mock.calls[0].result;
		assert.match(html, /There is a problem/);
		assert.match(html, /Enter a reason for removing this consultee(?!\.)/);
		assert.match(html, /govuk-textarea--error/);
	});

	it('should reject a missing or non-string reason the same way', async () => {
		const mockRes = { render: mock.fn(), redirect: mock.fn(), status: mock.fn(() => mockRes) };
		await removeSubmit(dbReturning([[realProjectRow()]], [parishMatchRow()]))(request({ body: {} }), mockRes);
		assert.strictEqual(
			mockRes.render.mock.calls[0].arguments[1].reasonError.text,
			'Enter a reason for removing this consultee'
		);

		const mockResNoBody = { render: mock.fn(), redirect: mock.fn(), status: mock.fn(() => mockResNoBody) };
		await removeSubmit(dbReturning([[realProjectRow()]], [parishMatchRow()]))(
			request({ body: undefined }),
			mockResNoBody
		);
		assert.strictEqual(
			mockResNoBody.render.mock.calls[0].arguments[1].reasonError.text,
			'Enter a reason for removing this consultee'
		);
	});

	it('should re-render the form when the ruleset could not be run', async () => {
		const nunjucks = configureNunjucks();
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn((view, data) => nunjucks.render(view, data)),
			redirect: mock.fn()
		};
		const submit = buildReportConsulteeRemoveSubmit({
			db: dbReturning([[realProjectRow()]]),
			logger: mockLogger(),
			nearbyConsulteeRadiusMetres: 20_000,
			rulesetRunner: failingRulesetRunner()
		});
		await submit(request(), mockRes);

		assert.strictEqual(mockRes.redirect.mock.callCount(), 0);
		assert.strictEqual(mockRes.render.mock.calls[0].arguments[0], 'views/consultees/report/consultees/remove/view.njk');
		assert.strictEqual(mockRes.render.mock.calls[0].arguments[1].rulesetFailed, true);
		assert.match(mockRes.render.mock.calls[0].result, /The ruleset could not be run/);
	});

	it('should 404 for a request the GET would not render', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn(), redirect: mock.fn() };
		const submit = removeSubmit(dbReturning([[realProjectRow()]], [parishMatchRow()]));
		await submit(request({ params: {} }), mockRes);
		await submit(request({ params: { caseId: 'not-a-uuid' } }), mockRes);
		await submit(request({ query: parishQuery }), mockRes);
		await submit(request({ query: { ...parishQuery, match: '99999999-9999-9999-9999-999999999999' } }), mockRes);
		assert.strictEqual(mockRes.status.mock.callCount(), 4);
		for (const call of mockRes.status.mock.calls) {
			assert.strictEqual(call.arguments[0], 404);
		}
		assert.strictEqual(mockRes.redirect.mock.callCount(), 0);
	});
});
