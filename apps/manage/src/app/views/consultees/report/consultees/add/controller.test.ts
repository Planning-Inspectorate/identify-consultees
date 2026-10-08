import { mockLogger } from '@planning-inspectorate/core/testing';
import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import { configureNunjucks } from '../../../../../nunjucks.ts';
import { buildReportConsulteeAddPage, buildReportConsulteeAddSubmit } from './controller.ts';

const realProjectId = '44444444-4444-4444-4444-444444444444';
const matchId = '55555555-5555-5555-5555-555555555555';

function summaryRow() {
	return {
		id: realProjectId,
		caseReference: 'EN010099',
		caseName: 'Real Test Project',
		receivedDate: null,
		acceptance: null
	};
}

// the add page only resolves the case summary - one row answers the one query it runs
function dbFor(row = summaryRow()) {
	return { $queryRaw: mock.fn(async () => [row]) };
}

function service(db: unknown) {
	return { db, logger: mockLogger(), nearbyConsulteeRadiusMetres: 20_000 };
}

// `query.add` holds the raw JSON param value (Express has already decoded it); expected URLs
// hold the encoded form
const addJson = (name: string, reason = '', category = 'Parish Council') =>
	JSON.stringify({ c: category, n: name, r: reason });
const addParam = (name: string, reason = '', category = 'Parish Council') =>
	encodeURIComponent(addJson(name, reason, category));

const parishQuery = { ruleset: 'england-wales-post-20240430', category: 'Parish Council' };

describe('report consultee add page', () => {
	it('should render the select-a-consultee form for a valid case/ruleset/category', async () => {
		const nunjucks = configureNunjucks();
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn((view, data) => nunjucks.render(view, data))
		};
		await buildReportConsulteeAddPage(service(dbFor()))(
			{ params: { caseId: realProjectId }, query: parishQuery },
			mockRes
		);

		assert.strictEqual(mockRes.render.mock.calls[0].arguments[0], 'views/consultees/report/consultees/add/view.njk');
		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.pageHeading, 'Select a consultee');
		assert.strictEqual(viewModel.pageCaption, 'Parish Council');
		assert.strictEqual(
			viewModel.backLinkUrl,
			`/consultees/${realProjectId}/report/consultees?ruleset=england-wales-post-20240430&category=Parish%20Council`
		);
		assert.strictEqual(viewModel.formAction, viewModel.backLinkUrl.replace('?', '/add?'));
		assert.strictEqual(viewModel.nameValue, '');
		assert.strictEqual(viewModel.reasonValue, '');
		assert.strictEqual(viewModel.errorSummary, undefined);

		const html = mockRes.render.mock.calls[0].result;
		assert.match(
			html,
			/<h1 class="govuk-heading-xl">\s*<span class="govuk-caption-xl">Parish Council<\/span>\s*Select a consultee/
		);
		assert.match(html, /Name of consultee/);
		assert.match(html, /<input[^>]*name="name"/);
		assert.match(html, /<textarea[^>]*name="reason"/);
		assert.match(html, /Reason for identification/);
		assert.match(html, /Add consultee/);
	});

	it('should fall back to the default ruleset when none is selected', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		await buildReportConsulteeAddPage(service(dbFor()))(
			{ params: { caseId: realProjectId }, query: { category: 'Parish Council' } },
			mockRes
		);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.match(viewModel.formAction, /ruleset=england-wales-post-20240430/);
	});

	it('should carry the current selection through the form action and back link', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const existingAdd = addJson('Existing Test Consultee', 'A reason');
		await buildReportConsulteeAddPage(service(dbFor()))(
			{
				params: { caseId: realProjectId },
				query: { ...parishQuery, exclude: matchId, add: existingAdd }
			},
			mockRes
		);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
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
			const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
			await buildReportConsulteeAddPage(service(dbFor()))({ params: { caseId: realProjectId }, query }, mockRes);
			assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
		});
	}

	it('should 404 when caseId is missing or malformed', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const handler = buildReportConsulteeAddPage(service({ $queryRaw: mock.fn() }));
		await handler({ params: {}, query: parishQuery }, mockRes);
		await handler({ params: { caseId: 'not-a-uuid' }, query: parishQuery }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
		assert.strictEqual(mockRes.status.mock.calls[1].arguments[0], 404);
	});

	it('should 404 for a well-formed id that matches no project', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const db = { $queryRaw: mock.fn(async () => []) };
		await buildReportConsulteeAddPage(service(db))({ params: { caseId: realProjectId }, query: parishQuery }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
	});
});

describe('report consultee add submit', () => {
	const submitFor = (db: unknown) => buildReportConsulteeAddSubmit(service(db));
	const request = (overrides: Record<string, unknown> = {}) => ({
		params: { caseId: realProjectId },
		query: parishQuery,
		body: { name: 'Test Consultee', reason: 'Adjacent landowner' },
		...overrides
	});

	it('should redirect back to the category page with the consultee added', async () => {
		const mockRes = { redirect: mock.fn(), render: mock.fn(), status: mock.fn(() => mockRes) };
		await submitFor(dbFor())(request(), mockRes);

		const location = mockRes.redirect.mock.calls[0].arguments[0];
		assert.strictEqual(
			location,
			`/consultees/${realProjectId}/report/consultees?ruleset=england-wales-post-20240430&category=Parish%20Council&add=${addParam('Test Consultee', 'Adjacent landowner')}`
		);
	});

	it('should keep earlier adds and exclusions so any number can be added one at a time', async () => {
		const mockRes = { redirect: mock.fn(), render: mock.fn(), status: mock.fn(() => mockRes) };
		const existingAdd = addJson('First Test Consultee', 'First reason');
		const existingParam = addParam('First Test Consultee', 'First reason');
		await submitFor(dbFor())(request({ query: { ...parishQuery, exclude: matchId, add: existingAdd } }), mockRes);

		const location = mockRes.redirect.mock.calls[0].arguments[0];
		assert.match(location, /exclude=55555555/);
		assert.ok(location.includes(`add=${existingParam}`));
		assert.ok(location.includes(`add=${addParam('Test Consultee', 'Adjacent landowner')}`));
		// the new add is appended after the existing one
		assert.ok(location.indexOf(existingParam) < location.indexOf(addParam('Test Consultee', 'Adjacent landowner')));
	});

	it('should trim the entered values and allow an empty reason', async () => {
		const mockRes = { redirect: mock.fn(), render: mock.fn(), status: mock.fn(() => mockRes) };
		await submitFor(dbFor())(request({ body: { name: '  Test Consultee  ', reason: '' } }), mockRes);

		const location = mockRes.redirect.mock.calls[0].arguments[0];
		assert.ok(location.includes(`add=${addParam('Test Consultee', '')}`));
	});

	it('should re-render the form with an error and the entered values when the name is blank', async () => {
		const nunjucks = configureNunjucks();
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn((view, data) => nunjucks.render(view, data)),
			redirect: mock.fn()
		};
		await submitFor(dbFor())(request({ body: { name: '   ', reason: 'Still needs a name' } }), mockRes);

		assert.strictEqual(mockRes.redirect.mock.callCount(), 0);
		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.nameError.text, 'Enter the consultee name');
		assert.strictEqual(viewModel.nameValue, '   ');
		assert.strictEqual(viewModel.reasonValue, 'Still needs a name');
		assert.strictEqual(viewModel.errorSummary[0].href, '#consultee-name');

		const html = mockRes.render.mock.calls[0].result;
		assert.match(html, /There is a problem/);
		assert.match(html, /Enter the consultee name/);
		assert.match(html, /govuk-input--error/);
	});

	it('should reject a missing or non-string name the same way', async () => {
		const mockRes = { render: mock.fn(), redirect: mock.fn(), status: mock.fn(() => mockRes) };
		await submitFor(dbFor())(request({ body: { reason: 'r' } }), mockRes);
		assert.strictEqual(mockRes.render.mock.calls[0].arguments[1].nameError.text, 'Enter the consultee name');

		// a request with no parsed body at all is the same validation failure
		const mockResNoBody = { render: mock.fn(), redirect: mock.fn(), status: mock.fn(() => mockResNoBody) };
		await submitFor(dbFor())(request({ body: undefined }), mockResNoBody);
		assert.strictEqual(mockResNoBody.render.mock.calls[0].arguments[1].nameError.text, 'Enter the consultee name');

		const mockRes2 = { render: mock.fn(), redirect: mock.fn(), status: mock.fn(() => mockRes2) };
		// qs can parse name[0]=x into an array/object - not a usable name
		await submitFor(dbFor())(request({ body: { name: ['a'], reason: 'r' } }), mockRes2);
		assert.strictEqual(mockRes2.render.mock.calls[0].arguments[1].nameError.text, 'Enter the consultee name');
		assert.strictEqual(mockRes2.render.mock.calls[0].arguments[1].nameValue, '');
	});

	it('should 404 for a case, ruleset or category the GET would not render', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn(), redirect: mock.fn() };
		const submit = submitFor(dbFor());
		await submit(request({ params: {} }), mockRes);
		await submit(request({ params: { caseId: 'not-a-uuid' } }), mockRes);
		await submit(request({ query: { ...parishQuery, ruleset: 'not-a-real-ruleset' } }), mockRes);
		await submit(request({ query: { ...parishQuery, category: 'Not A Category' } }), mockRes);
		assert.strictEqual(mockRes.status.mock.callCount(), 4);
		for (const call of mockRes.status.mock.calls) {
			assert.strictEqual(call.arguments[0], 404);
		}
		assert.strictEqual(mockRes.redirect.mock.callCount(), 0);
	});
});
