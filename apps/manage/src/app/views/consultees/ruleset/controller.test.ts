import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import { configureNunjucks } from '../../../nunjucks.ts';
import { buildRulesetPickerPage, buildRulesetPickerSubmit } from './controller.ts';

const realProjectId = '44444444-4444-4444-4444-444444444444';

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

function summaryDb() {
	return { $queryRaw: mock.fn(async () => [realProjectRow()]) };
}

describe('ruleset picker page', () => {
	it('should render the ruleset radios with the current ruleset checked', async () => {
		const nunjucks = configureNunjucks();
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn((view, data) => nunjucks.render(view, data))
		};
		const handler = buildRulesetPickerPage({ db: summaryDb() });
		await handler({ params: { caseId: realProjectId }, query: { ruleset: 'england-wales-post-20240430' } }, mockRes);

		assert.strictEqual(mockRes.render.mock.callCount(), 1);
		assert.strictEqual(mockRes.render.mock.calls[0].arguments[0], 'views/consultees/ruleset/view.njk');
		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.pageHeading, 'Ruleset');
		assert.strictEqual(viewModel.pageCaption, 'Real Test Project');
		assert.strictEqual(viewModel.caseId, realProjectId);
		// back to the boundary page that continued here
		assert.strictEqual(viewModel.backLinkUrl, `/consultees/${realProjectId}`);
		assert.strictEqual(
			viewModel.formAction,
			`/consultees/${realProjectId}/ruleset?ruleset=england-wales-post-20240430`
		);
		assert.ok(viewModel.rulesets.length >= 1);
		const current = viewModel.rulesets.find((ruleset) => ruleset.value === 'england-wales-post-20240430');
		assert.strictEqual(current.checked, true);

		const html = mockRes.render.mock.calls[0].result;
		assert.match(html, /govuk-caption-xl">\s*Real Test Project/);
		assert.match(html, /Identify consultees/);
	});

	it('should pre-check the top option when no ruleset is selected yet', async () => {
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn()
		};
		const handler = buildRulesetPickerPage({ db: summaryDb() });
		await handler({ params: { caseId: realProjectId }, query: {} }, mockRes);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.rulesets[0].checked, true);
	});

	it('should fall back to the top option when the selected ruleset is unknown', async () => {
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn()
		};
		const handler = buildRulesetPickerPage({ db: summaryDb() });
		await handler({ params: { caseId: realProjectId }, query: { ruleset: 'not-a-real-ruleset' } }, mockRes);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.rulesets[0].checked, true);
	});

	it('should carry the consultee selection through the form action', async () => {
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn()
		};
		const handler = buildRulesetPickerPage({ db: summaryDb() });
		const add = JSON.stringify({ c: 'Parish Council', n: 'Test Consultee', r: 'Adjacent' });
		await handler(
			{
				params: { caseId: realProjectId },
				query: { ruleset: 'england-wales-post-20240430', exclude: 'abc', add }
			},
			mockRes
		);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.ok(viewModel.formAction.includes('&exclude=abc'));
		assert.ok(viewModel.formAction.includes(`&add=${encodeURIComponent(add)}`));
	});

	it('should 404 when caseId is missing', async () => {
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn()
		};
		const handler = buildRulesetPickerPage({ db: { $queryRaw: mock.fn() } });
		await handler({ params: {}, query: {} }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
	});

	it('should 404 for an id that is not a well-formed UUID', async () => {
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn()
		};
		const handler = buildRulesetPickerPage({ db: { $queryRaw: mock.fn() } });
		await handler({ params: { caseId: 'not-a-uuid' }, query: {} }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
	});

	it('should 404 for a well-formed id that matches no project', async () => {
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn()
		};
		const db = { $queryRaw: mock.fn(async () => []) };
		const handler = buildRulesetPickerPage({ db });
		await handler({ params: { caseId: realProjectId }, query: {} }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
	});
});

describe('ruleset picker submit', () => {
	it('should redirect to the check page with the chosen ruleset', async () => {
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn(),
			redirect: mock.fn()
		};
		const handler = buildRulesetPickerSubmit();
		await handler({ params: { caseId: realProjectId }, body: { ruleset: 'england-wales-post-20240430' } }, mockRes);
		assert.strictEqual(
			mockRes.redirect.mock.calls[0].arguments[0],
			`/consultees/${realProjectId}/report?ruleset=england-wales-post-20240430`
		);
	});

	it('should carry the consultee selection on to the check page', async () => {
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn(),
			redirect: mock.fn()
		};
		const handler = buildRulesetPickerSubmit();
		const add = JSON.stringify({ c: 'Parish Council', n: 'Test Consultee', r: 'Adjacent' });
		await handler(
			{
				params: { caseId: realProjectId },
				query: { exclude: 'abc', add },
				body: { ruleset: 'england-wales-post-20240430' }
			},
			mockRes
		);
		const location = mockRes.redirect.mock.calls[0].arguments[0];
		assert.ok(location.startsWith(`/consultees/${realProjectId}/report?ruleset=england-wales-post-20240430`));
		assert.ok(location.includes('&exclude=abc'));
		assert.ok(location.includes(`&add=${encodeURIComponent(add)}`));
	});

	it('should return to the picker when the submitted ruleset is unknown or missing', async () => {
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn(),
			redirect: mock.fn()
		};
		const handler = buildRulesetPickerSubmit();
		await handler({ params: { caseId: realProjectId }, body: { ruleset: 'not-a-real-ruleset' } }, mockRes);
		assert.strictEqual(
			mockRes.redirect.mock.calls[0].arguments[0],
			`/consultees/${realProjectId}/ruleset?ruleset=england-wales-post-20240430`
		);

		// and a missing body entirely (no parser on a bare handler call)
		await handler({ params: { caseId: realProjectId } }, mockRes);
		assert.strictEqual(
			mockRes.redirect.mock.calls[1].arguments[0],
			`/consultees/${realProjectId}/ruleset?ruleset=england-wales-post-20240430`
		);
	});

	it('should 404 when caseId is missing or malformed', async () => {
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn(),
			redirect: mock.fn()
		};
		const handler = buildRulesetPickerSubmit();
		await handler({ params: {}, body: {} }, mockRes);
		await handler({ params: { caseId: 'not-a-uuid' }, body: {} }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
		assert.strictEqual(mockRes.status.mock.calls[1].arguments[0], 404);
	});
});
