import { mockLogger } from '@planning-inspectorate/core/testing';
import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import { configureNunjucks } from '../../../../../nunjucks.ts';
import type { ConsulteeAreaMatchRow } from '../../../../../testing/ruleset-runner-stub.ts';
import { failingRulesetRunner, rulesetRunnerReturning } from '../../../../../testing/ruleset-runner-stub.ts';
import { buildReportConsulteeAddPage, buildReportConsulteeAddSubmit, NOT_LISTED } from './controller.ts';

const realProjectId = '44444444-4444-4444-4444-444444444444';
const matchId = '55555555-5555-5555-5555-555555555555';
const nearbyId = '77777777-7777-7777-7777-777777777777';
const fartherNearbyId = '88888888-8888-8888-8888-888888888888';

function projectRow() {
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

// the add page resolves the case, and the reference data's categories for one the ruleset doesn't cover
function dbFor(rows: unknown[] = [projectRow()], categories: string[] = []) {
	return {
		$queryRaw: mock.fn(async (sql: TemplateStringsArray) =>
			sql.join('').includes('DISTINCT consulteeCategory')
				? categories.map((consulteeCategory) => ({ consulteeCategory }))
				: rows
		)
	};
}

function matchRow(
	id: string,
	consultee: string,
	distanceMetres: number,
	reasons: ConsulteeAreaMatchRow['reasons'],
	consulteeCategory = 'Parish Council'
): ConsulteeAreaMatchRow {
	return { id, consulteeCategory, consultee, region: 'East', distanceMetres, reasons };
}

const nearby = [{ type: 'nearby' as const, radiusMetres: 20_000 }];

// one identified parish (not offered - it's already in the report), two nearby-only parishes
// (offered, nearest first), and a nearby-only consultee in another category (not offered)
const RUN = [
	matchRow(matchId, 'Identified Parish Council', 0, [{ type: 'condition', conditionId: 'b_host_parish' }]),
	matchRow(nearbyId, 'Nearby Parish Council', 1_250, nearby),
	matchRow(fartherNearbyId, 'Farther Parish Council', 4_000, nearby),
	matchRow('99999999-9999-9999-9999-999999999999', 'Nearby Hospital', 900, nearby, 'Hospital')
];

function service(db: unknown, rulesetRunner: unknown = rulesetRunnerReturning(RUN)) {
	return { db, logger: mockLogger(), nearbyConsulteeRadiusMetres: 20_000, rulesetRunner };
}

// `query.add` holds the raw JSON param value (Express has already decoded it); expected URLs
// hold the encoded form
const addJson = (name: string, reason = '', category = 'Parish Council', id?: string) =>
	JSON.stringify({ ...(id ? { i: id } : {}), c: category, n: name, r: reason });
const addParam = (name: string, reason = '', category = 'Parish Council', id?: string) =>
	encodeURIComponent(addJson(name, reason, category, id));

const parishQuery = { ruleset: 'england-wales-post-20240430', category: 'Parish Council' };

function renderingResponse() {
	const nunjucks = configureNunjucks();
	const res = {
		status: mock.fn(() => res),
		render: mock.fn((view: string, data: object) => nunjucks.render(view, data)),
		redirect: mock.fn()
	};
	return res;
}

function response() {
	const res = { status: mock.fn(() => res), render: mock.fn(), redirect: mock.fn() };
	return res;
}

describe('report consultee add page', () => {
	it("should offer the category's nearby consultees, nearest first, or one not listed by name", async () => {
		const res = renderingResponse();
		await buildReportConsulteeAddPage(service(dbFor()))(
			{ params: { caseId: realProjectId }, query: parishQuery } as never,
			res as never
		);

		assert.strictEqual(res.render.mock.calls[0].arguments[0], 'views/consultees/report/consultees/add/view.njk');
		const viewModel = res.render.mock.calls[0].arguments[1] as Record<string, unknown>;
		assert.strictEqual(viewModel.pageHeading, 'Add consultee');
		assert.strictEqual(viewModel.pageCaption, 'Parish Council');
		assert.strictEqual(
			viewModel.backLinkUrl,
			`/consultees/${realProjectId}/report/consultees?ruleset=england-wales-post-20240430&category=Parish%20Council`
		);
		assert.strictEqual(viewModel.formAction, (viewModel.backLinkUrl as string).replace('?', '/add?'));
		assert.deepStrictEqual(viewModel.nearbyOptions, [
			{
				value: nearbyId,
				text: 'Nearby Parish Council',
				hint: { text: '1.3 km from the site' },
				checked: false
			},
			{
				value: fartherNearbyId,
				text: 'Farther Parish Council',
				hint: { text: '4.0 km from the site' },
				checked: false
			}
		]);
		assert.strictEqual(viewModel.notListedChecked, false);
		assert.strictEqual(viewModel.errorSummary, undefined);

		const html = res.render.mock.calls[0].result as string;
		assert.match(
			html,
			/<h1 class="govuk-heading-xl">\s*<span class="govuk-caption-xl">Parish Council<\/span>\s*Add consultee/
		);
		assert.match(html, /Which consultee do you want to add\?/);
		assert.match(html, new RegExp(`<input[^>]*name="consultee" type="radio" value="${nearbyId}"`));
		assert.match(html, /1\.3 km from the site/);
		assert.match(html, new RegExp(`value="${NOT_LISTED}"[^>]*data-aria-controls="conditional-consultee-4"`));
		// the name input is revealed by "A consultee not listed"
		assert.match(html, /id="conditional-consultee-4"[^]*?<input[^>]*name="name"/);
		assert.match(html, /<textarea[^>]*name="reason"/);
		assert.doesNotMatch(html, /Identified Parish Council|Nearby Hospital/);
	});

	it('should ask for a name alone when nothing nearby is left to pick', async () => {
		const res = renderingResponse();
		// the one nearby parish is already added
		const query = { ...parishQuery, add: addJson('Nearby Parish Council', 'r', 'Parish Council', nearbyId) };
		await buildReportConsulteeAddPage(service(dbFor(), rulesetRunnerReturning(RUN.slice(0, 2))))(
			{ params: { caseId: realProjectId }, query } as never,
			res as never
		);

		const viewModel = res.render.mock.calls[0].arguments[1] as Record<string, unknown>;
		assert.deepStrictEqual(viewModel.nearbyOptions, []);
		const html = res.render.mock.calls[0].result as string;
		assert.doesNotMatch(html, /type="radio"/);
		assert.match(html, /<input[^>]*name="name"/);
	});

	it("should still take a name when the ruleset can't be run", async () => {
		const res = response();
		await buildReportConsulteeAddPage(service(dbFor(), failingRulesetRunner()))(
			{ params: { caseId: realProjectId }, query: parishQuery } as never,
			res as never
		);
		assert.deepStrictEqual((res.render.mock.calls[0].arguments[1] as Record<string, unknown>).nearbyOptions, []);
	});

	it('should reuse the run the session keeps rather than run the ruleset again', async () => {
		const runner = rulesetRunnerReturning(RUN);
		const session = {};
		const handler = buildReportConsulteeAddPage(service(dbFor(), runner));
		for (let i = 0; i < 2; i++) {
			await handler({ params: { caseId: realProjectId }, query: parishQuery, session } as never, response() as never);
		}
		assert.strictEqual(runner.mock.callCount(), 1);
	});

	it('should fall back to the default ruleset when none is selected', async () => {
		const res = response();
		await buildReportConsulteeAddPage(service(dbFor()))(
			{ params: { caseId: realProjectId }, query: { category: 'Parish Council' } } as never,
			res as never
		);
		const viewModel = res.render.mock.calls[0].arguments[1] as Record<string, string>;
		assert.match(viewModel.formAction, /ruleset=england-wales-post-20240430/);
	});

	it('should carry the current selection through the form action and back link', async () => {
		const res = response();
		await buildReportConsulteeAddPage(service(dbFor()))(
			{
				params: { caseId: realProjectId },
				query: { ...parishQuery, exclude: matchId, add: addJson('Existing Test Consultee', 'A reason') }
			} as never,
			res as never
		);

		const viewModel = res.render.mock.calls[0].arguments[1] as Record<string, string>;
		assert.match(viewModel.backLinkUrl, /exclude=55555555/);
		assert.match(viewModel.backLinkUrl, /add=/);
		assert.match(viewModel.formAction, /exclude=55555555/);
		assert.match(viewModel.formAction, /add=/);
	});

	for (const [title, query] of [
		['an unknown category', { ...parishQuery, category: 'Not A Category' }],
		['a missing category', { ruleset: 'england-wales-post-20240430' }],
		['an unknown ruleset', { ...parishQuery, ruleset: 'not-a-real-ruleset' }]
	] as const) {
		it(`should 404 for ${title}`, async () => {
			const res = response();
			await buildReportConsulteeAddPage(service(dbFor()))(
				{ params: { caseId: realProjectId }, query } as never,
				res as never
			);
			assert.strictEqual(res.status.mock.calls[0].arguments[0], 404);
		});
	}

	it('should accept a category the ruleset does not cover but the reference data has', async () => {
		// the nearby search finds consultees in categories no condition names - their category page
		// links here, so the form has to accept them
		const res = response();
		await buildReportConsulteeAddPage(service(dbFor([projectRow()], ['Interconnector'])))(
			{ params: { caseId: realProjectId }, query: { ...parishQuery, category: 'Interconnector' } } as never,
			res as never
		);

		assert.strictEqual(res.status.mock.callCount(), 0);
		assert.strictEqual((res.render.mock.calls[0].arguments[1] as Record<string, string>).pageCaption, 'Interconnector');
	});

	it('should 404 when caseId is missing or malformed', async () => {
		const res = response();
		const handler = buildReportConsulteeAddPage(service({ $queryRaw: mock.fn() }));
		await handler({ params: {}, query: parishQuery } as never, res as never);
		await handler({ params: { caseId: 'not-a-uuid' }, query: parishQuery } as never, res as never);
		assert.strictEqual(res.status.mock.calls[0].arguments[0], 404);
		assert.strictEqual(res.status.mock.calls[1].arguments[0], 404);
	});

	it('should 404 for a well-formed id that matches no project', async () => {
		const res = response();
		await buildReportConsulteeAddPage(service(dbFor([])))(
			{ params: { caseId: realProjectId }, query: parishQuery } as never,
			res as never
		);
		assert.strictEqual(res.status.mock.calls[0].arguments[0], 404);
	});
});

describe('report consultee add submit', () => {
	const submitFor = (rulesetRunner: unknown = rulesetRunnerReturning(RUN)) =>
		buildReportConsulteeAddSubmit(service(dbFor(), rulesetRunner));
	const request = (overrides: Record<string, unknown> = {}) =>
		({
			params: { caseId: realProjectId },
			query: parishQuery,
			body: { consultee: nearbyId, reason: 'Borders the site' },
			...overrides
		}) as never;
	const categoryUrl = `/consultees/${realProjectId}/report/consultees?ruleset=england-wales-post-20240430&category=Parish%20Council`;
	const viewModelOf = (res: ReturnType<typeof response>) =>
		res.render.mock.calls[0].arguments[1] as unknown as Record<string, any>;

	it('should add a picked nearby consultee by its id and name, and go back to the category page', async () => {
		const res = response();
		await submitFor()(request(), res as never);

		assert.strictEqual(
			res.redirect.mock.calls[0].arguments[0],
			`${categoryUrl}&add=${addParam('Nearby Parish Council', 'Borders the site', 'Parish Council', nearbyId)}`
		);
	});

	it('should add one not listed by the name entered', async () => {
		const res = response();
		await submitFor()(
			request({ body: { consultee: NOT_LISTED, name: '  Test Consultee  ', reason: '  Adjacent landowner  ' } }),
			res as never
		);

		assert.strictEqual(
			res.redirect.mock.calls[0].arguments[0],
			`${categoryUrl}&add=${addParam('Test Consultee', 'Adjacent landowner')}`
		);
	});

	it('should take a name alone when there is nothing nearby to pick', async () => {
		const res = response();
		await submitFor(failingRulesetRunner())(
			request({ body: { name: 'Test Consultee', reason: 'Adjacent landowner' } }),
			res as never
		);

		assert.ok(res.redirect.mock.calls[0].arguments[0].endsWith(addParam('Test Consultee', 'Adjacent landowner')));
	});

	it('should keep earlier adds and exclusions so any number can be added one at a time', async () => {
		const res = response();
		const existingParam = addParam('First Test Consultee', 'First reason');
		await submitFor()(
			request({
				query: { ...parishQuery, exclude: matchId, add: addJson('First Test Consultee', 'First reason') }
			}),
			res as never
		);

		const location = res.redirect.mock.calls[0].arguments[0] as string;
		const newParam = addParam('Nearby Parish Council', 'Borders the site', 'Parish Council', nearbyId);
		assert.match(location, /exclude=55555555/);
		// the new add is appended after the existing one
		assert.ok(location.indexOf(existingParam) > 0);
		assert.ok(location.indexOf(existingParam) < location.indexOf(newParam));
	});

	it('should ask which consultee, and for a reason, when neither is given', async () => {
		const res = renderingResponse();
		await submitFor()(request({ body: {} }), res as never);

		assert.strictEqual(res.redirect.mock.callCount(), 0);
		const viewModel = res.render.mock.calls[0].arguments[1] as Record<string, any>;
		assert.deepStrictEqual(viewModel.errorSummary, [
			{ text: 'Select the consultee to add', href: '#consultee' },
			{ text: 'Enter a reason for adding this consultee.', href: '#consultee-reason' }
		]);
		const html = res.render.mock.calls[0].result as string;
		assert.match(html, /There is a problem/);
		// the error sits on the radios' fieldset, which the summary's #consultee link reaches
		assert.match(html, /id="consultee-error"[^>]*>[^]*?Select the consultee to add/);
	});

	it('should treat an id that is not on offer as nothing picked', async () => {
		const res = response();
		// an identified consultee is already in the report - a crafted submit can't add it twice
		await submitFor()(request({ body: { consultee: matchId, reason: 'r' } }), res as never);
		assert.strictEqual(viewModelOf(res).consulteeError.text, 'Select the consultee to add');
	});

	it('should re-render with the entered values when the reason is blank', async () => {
		const res = renderingResponse();
		await submitFor()(request({ body: { consultee: nearbyId, reason: '   ' } }), res as never);

		const viewModel = res.render.mock.calls[0].arguments[1] as Record<string, any>;
		assert.strictEqual(viewModel.reasonError.text, 'Enter a reason for adding this consultee.');
		assert.strictEqual(viewModel.reasonValue, '   ');
		assert.strictEqual(viewModel.nearbyOptions[0].checked, true);
		assert.strictEqual(viewModel.errorSummary[0].href, '#consultee-reason');
		assert.match(res.render.mock.calls[0].result as string, /govuk-textarea--error/);
	});

	it('should re-render with the not-listed choice open when its name is blank', async () => {
		const res = renderingResponse();
		await submitFor()(
			request({ body: { consultee: NOT_LISTED, name: '   ', reason: 'Still needs a name' } }),
			res as never
		);

		const viewModel = res.render.mock.calls[0].arguments[1] as Record<string, any>;
		assert.strictEqual(viewModel.nameError.text, 'Enter the consultee name');
		assert.strictEqual(viewModel.nameValue, '   ');
		assert.strictEqual(viewModel.reasonValue, 'Still needs a name');
		assert.strictEqual(viewModel.notListedChecked, true);
		assert.strictEqual(viewModel.errorSummary[0].href, '#consultee-name');
		const html = res.render.mock.calls[0].result as string;
		assert.match(html, new RegExp(`value="${NOT_LISTED}" checked`));
		assert.match(html, /govuk-input--error/);
	});

	it('should reject a missing or non-string name, with nothing nearby to pick, the same way', async () => {
		for (const body of [{ reason: 'r' }, undefined, { name: ['a'], reason: 'r' }]) {
			const res = response();
			await submitFor(failingRulesetRunner())(request({ body }), res as never);
			assert.strictEqual(viewModelOf(res).nameError.text, 'Enter the consultee name');
			assert.strictEqual(viewModelOf(res).nameValue, '');
		}
	});

	it('should 404 for a case, ruleset or category the GET would not render', async () => {
		const res = response();
		const submit = submitFor();
		await submit(request({ params: {} }), res as never);
		await submit(request({ params: { caseId: 'not-a-uuid' } }), res as never);
		await submit(request({ query: { ...parishQuery, ruleset: 'not-a-real-ruleset' } }), res as never);
		await submit(request({ query: { ...parishQuery, category: 'Not A Category' } }), res as never);
		assert.strictEqual(res.status.mock.callCount(), 4);
		for (const call of res.status.mock.calls) {
			assert.strictEqual(call.arguments[0], 404);
		}
		assert.strictEqual(res.redirect.mock.callCount(), 0);
	});
});
