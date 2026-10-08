import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import { configureNunjucks } from '../../../nunjucks.ts';
import { buildShapefilePickerPage, buildShapefilePickerSubmit } from './controller.ts';
import { formatUploadedAt } from './format-uploaded.ts';

const realProjectId = '44444444-4444-4444-4444-444444444444';
const siblingFileId = '66666666-6666-6666-6666-666666666666';

function summaryRow() {
	return {
		id: realProjectId,
		caseReference: 'EN010099',
		caseName: 'Real Test Project',
		receivedDate: null,
		acceptance: null
	};
}

function fileRows() {
	return [
		{ id: realProjectId, fileName: 'EN010099.geojson', receivedDate: new Date('2026-09-19T10:20:00.000Z') },
		{ id: siblingFileId, fileName: 'solar farm shapefiles.geojson', receivedDate: new Date('2026-07-29T11:16:00.000Z') }
	];
}

function dbReturning(rowSets: unknown[][]) {
	let call = 0;
	return {
		$queryRaw: mock.fn(async () => rowSets[Math.min(call++, rowSets.length - 1)] ?? [])
	};
}

describe('formatUploadedAt', () => {
	it('formats time then date, UK style', () => {
		assert.strictEqual(formatUploadedAt(new Date('2026-09-19T10:20:00.000Z')), '11:20, 19 Sept 2026');
	});
});

describe('shapefile picker page', () => {
	it('should render the project’s files as radios with the current file checked', async () => {
		const nunjucks = configureNunjucks();
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn((view, data) => nunjucks.render(view, data))
		};
		const handler = buildShapefilePickerPage({ db: dbReturning([[summaryRow()], fileRows()]) });
		await handler({ params: { caseId: realProjectId }, query: { ruleset: 'england-wales-post-20240430' } }, mockRes);

		assert.strictEqual(mockRes.render.mock.calls[0].arguments[0], 'views/consultees/shapefile/view.njk');
		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.pageHeading, 'Project shapefile');
		assert.strictEqual(viewModel.rulesetId, 'england-wales-post-20240430');
		assert.strictEqual(viewModel.backLinkUrl, `/consultees/${realProjectId}?ruleset=england-wales-post-20240430`);
		assert.strictEqual(viewModel.files.length, 2);
		assert.strictEqual(viewModel.files[0].text, 'EN010099.geojson');
		assert.strictEqual(viewModel.files[0].checked, true);
		assert.strictEqual(viewModel.files[1].checked, false);
		assert.strictEqual(viewModel.files[1].hint.text, 'Uploaded: 12:16, 29 Jul 2026');
	});

	it('should fall back to unnamed text and no hint for a file with neither set', async () => {
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn()
		};
		const files = [{ id: realProjectId, fileName: null, receivedDate: null }];
		const handler = buildShapefilePickerPage({ db: dbReturning([[summaryRow()], files]) });
		await handler({ params: { caseId: realProjectId }, query: {} }, mockRes);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.files[0].text, 'Unnamed file');
		assert.strictEqual(viewModel.files[0].hint, undefined);
		// still the current file, so still checked
		assert.strictEqual(viewModel.files[0].checked, true);
	});

	it('should check the top file when the list does not contain the current case', async () => {
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn()
		};
		// e.g. the file list no longer contains the boundary the map page was opened on
		const files = [{ id: siblingFileId, fileName: 'other.geojson', receivedDate: null }];
		const handler = buildShapefilePickerPage({ db: dbReturning([[summaryRow()], files]) });
		await handler({ params: { caseId: realProjectId }, query: {} }, mockRes);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.files[0].checked, true);
	});

	it('should leave nothing checked when the project has no files at all', async () => {
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn()
		};
		const handler = buildShapefilePickerPage({ db: dbReturning([[summaryRow()], []]) });
		await handler({ params: { caseId: realProjectId }, query: {} }, mockRes);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.deepStrictEqual(viewModel.files, []);
	});

	it('should 404 when caseId is missing or malformed', async () => {
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn()
		};
		const handler = buildShapefilePickerPage({ db: { $queryRaw: mock.fn() } });
		await handler({ params: {}, query: {} }, mockRes);
		await handler({ params: { caseId: 'not-a-uuid' }, query: {} }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
		assert.strictEqual(mockRes.status.mock.calls[1].arguments[0], 404);
	});

	it('should 404 for a well-formed id that matches no project', async () => {
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn()
		};
		const handler = buildShapefilePickerPage({ db: dbReturning([[]]) });
		await handler({ params: { caseId: realProjectId }, query: {} }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
	});
});

describe('shapefile picker submit', () => {
	it('should redirect to the map page for the chosen file, keeping the ruleset', async () => {
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn(),
			redirect: mock.fn()
		};
		const handler = buildShapefilePickerSubmit({ db: dbReturning([[summaryRow()], fileRows()]) });
		await handler(
			{ params: { caseId: realProjectId }, body: { shapefile: siblingFileId, ruleset: 'england-wales-post-20240430' } },
			mockRes
		);
		assert.strictEqual(
			mockRes.redirect.mock.calls[0].arguments[0],
			`/consultees/${siblingFileId}?ruleset=england-wales-post-20240430`
		);
	});

	it('should return to the picker when the submitted file is not one of the project’s', async () => {
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn(),
			redirect: mock.fn()
		};
		const handler = buildShapefilePickerSubmit({ db: dbReturning([[summaryRow()], fileRows()]) });
		await handler(
			{
				params: { caseId: realProjectId },
				body: { shapefile: '99999999-9999-9999-9999-999999999999', ruleset: 'england-wales-post-20240430' }
			},
			mockRes
		);
		assert.strictEqual(
			mockRes.redirect.mock.calls[0].arguments[0],
			`/consultees/${realProjectId}/shapefile?ruleset=england-wales-post-20240430`
		);

		// missing body entirely - nothing selected
		await handler({ params: { caseId: realProjectId } }, mockRes);
		assert.strictEqual(
			mockRes.redirect.mock.calls[1].arguments[0],
			`/consultees/${realProjectId}/shapefile?ruleset=england-wales-post-20240430`
		);
	});

	it('should 404 when caseId is missing or malformed', async () => {
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn(),
			redirect: mock.fn()
		};
		const handler = buildShapefilePickerSubmit({ db: { $queryRaw: mock.fn() } });
		await handler({ params: {}, body: {} }, mockRes);
		await handler({ params: { caseId: 'not-a-uuid' }, body: {} }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
		assert.strictEqual(mockRes.status.mock.calls[1].arguments[0], 404);
	});

	it('should 404 for a well-formed id that matches no project', async () => {
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn(),
			redirect: mock.fn()
		};
		const handler = buildShapefilePickerSubmit({ db: dbReturning([[]]) });
		await handler({ params: { caseId: realProjectId }, body: { shapefile: siblingFileId } }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
	});
});
