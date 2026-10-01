import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import { configureNunjucks } from '../../../nunjucks.ts';
import { buildRulesetPickerPage } from './controller.ts';

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

describe('ruleset picker page', () => {
	it('should render the ruleset options for a known project', async () => {
		const nunjucks = configureNunjucks();
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn((view, data) => nunjucks.render(view, data))
		};
		const db = { $queryRaw: mock.fn(async () => [realProjectRow()]) };
		const handler = buildRulesetPickerPage({ db });
		await handler({ params: { caseId: realProjectId } }, mockRes);

		assert.strictEqual(mockRes.render.mock.callCount(), 1);
		assert.strictEqual(mockRes.render.mock.calls[0].arguments[0], 'views/consultees/ruleset/view.njk');
		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.match(viewModel.pageHeading, /Real Test Project/);
		assert.strictEqual(viewModel.caseId, realProjectId);
		assert.ok(viewModel.rulesets.length >= 1);
		assert.ok(viewModel.rulesets.some((ruleset) => ruleset.value === 'example-ruleset'));
	});

	it('should 404 when caseId is missing', async () => {
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn()
		};
		const handler = buildRulesetPickerPage({ db: { $queryRaw: mock.fn() } });
		await handler({ params: {} }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
	});

	it('should 404 for an id that is not a well-formed UUID', async () => {
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn()
		};
		const handler = buildRulesetPickerPage({ db: { $queryRaw: mock.fn() } });
		await handler({ params: { caseId: 'not-a-uuid' } }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
	});

	it('should 404 for a well-formed id that matches no project', async () => {
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn()
		};
		const db = { $queryRaw: mock.fn(async () => []) };
		const handler = buildRulesetPickerPage({ db });
		await handler({ params: { caseId: realProjectId } }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
	});
});
