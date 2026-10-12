import { mockLogger } from '@planning-inspectorate/core/testing';
import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import { BOUNDARY_MAP_STYLES } from '../../../maps/boundary-map-styles.ts';
import { configureNunjucks } from '../../../nunjucks.ts';
import { buildBoundaryStaticMap, buildBoundarySubmit, buildConsulteeProjectPage } from './controller.ts';

const realProjectId = '44444444-4444-4444-4444-444444444444';
const siblingProjectId = '55555555-5555-5555-5555-555555555555';

function realProjectRow(overrides: Record<string, unknown> = {}) {
	return {
		id: realProjectId,
		geometryType: 'Point',
		caseReference: 'EN010099',
		caseName: 'Real Test Project',
		fileName: 'EN010099.geojson',
		receivedDate: new Date('2026-09-19T11:20:00Z'),
		acceptance: null,
		metadata: '{}',
		geometryWkt: 'POINT(-1.5 52.5)',
		...overrides
	};
}

function siblingProjectRow() {
	return realProjectRow({
		id: siblingProjectId,
		fileName: 'EN010099-v2.geojson',
		receivedDate: new Date('2026-10-01T09:00:00Z'),
		geometryWkt: 'POINT(-1.6 52.6)'
	});
}

function boundaryFile(row: ReturnType<typeof realProjectRow>) {
	return { id: row.id, fileName: row.fileName, receivedDate: row.receivedDate };
}

// rows answer $queryRaw calls in order: the case_boundary lookups (resolveCase or the submit's
// summary + siblings' geometries) and the listCaseBoundaryFiles call between them
function dbReturning(calls: unknown[][]) {
	let call = 0;
	return {
		$queryRaw: mock.fn(async () => calls[Math.min(call++, calls.length - 1)] ?? [])
	};
}

function pageHandlerFor(db: unknown) {
	return buildConsulteeProjectPage({ db, logger: mockLogger() });
}

describe('consultee project boundary page', () => {
	it('should render the boundary heading, file radios and the shapefile map config', async () => {
		const nunjucks = configureNunjucks();
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn((view, data) => nunjucks.render(view, data))
		};
		const polygonRow = realProjectRow({
			geometryType: 'Polygon',
			geometryWkt: 'POLYGON((-1.5 52.5, -1.4 52.5, -1.4 52.6, -1.5 52.6, -1.5 52.5))'
		});
		const db = dbReturning([[polygonRow], [boundaryFile(polygonRow)]]);
		await pageHandlerFor(db)({ params: { caseId: realProjectId }, query: {} }, mockRes);

		assert.strictEqual(mockRes.render.mock.calls[0].arguments[0], 'views/consultees/project/view.njk');
		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.pageHeading, 'Project boundary');
		assert.strictEqual(viewModel.pageCaption, 'Real Test Project');
		assert.strictEqual(viewModel.reference, 'EN010099');
		assert.strictEqual(viewModel.backLinkUrl, '/');
		assert.strictEqual(viewModel.backLinkText, 'Back to projects');
		assert.strictEqual(viewModel.formAction, `/consultees/${realProjectId}`);
		assert.ok(viewModel.mapConfigJson.includes('FeatureCollection'));

		// a single-file case lists just that file, checked
		assert.strictEqual(viewModel.files.length, 1);
		assert.strictEqual(viewModel.files[0].value, realProjectId);
		assert.strictEqual(viewModel.files[0].text, 'EN010099.geojson');
		assert.strictEqual(viewModel.files[0].checked, true);
		assert.match(viewModel.files[0].hint.text, /Uploaded: /);

		const mapConfig = JSON.parse(viewModel.mapConfigJson);
		assert.strictEqual(mapConfig.shapefileGroupLabel, 'GIS shapefiles');
		assert.strictEqual(mapConfig.shapefileDatasets.length, 1);
		assert.strictEqual(mapConfig.shapefileDatasets[0].checked, true);
		assert.strictEqual(mapConfig.fallback.src, `/consultees/${realProjectId}/boundary-map`);

		const html = mockRes.render.mock.calls[0].result;
		assert.match(html, /Back to projects/);
		assert.match(html, /Confirm shapefile for report/);
		assert.match(html, /Continue/);
		assert.match(html, /app-consultee-map/);
	});

	it('should list every stored file when a case has more than one', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const db = dbReturning([
			[realProjectRow()],
			[boundaryFile(siblingProjectRow()), boundaryFile(realProjectRow())],
			[siblingProjectRow()]
		]);
		await pageHandlerFor(db)({ params: { caseId: realProjectId }, query: {} }, mockRes);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.files.length, 2);
		// receivedDate DESC puts the newer sibling first; the file the page was opened on is checked
		assert.strictEqual(viewModel.files[0].value, siblingProjectId);
		assert.strictEqual(viewModel.files[0].checked, false);
		assert.strictEqual(viewModel.files[1].value, realProjectId);
		assert.strictEqual(viewModel.files[1].checked, true);

		const mapConfig = JSON.parse(viewModel.mapConfigJson);
		// the sibling's geometry came from its own case_boundary row
		assert.deepStrictEqual(mapConfig.shapefileDatasets[0].geojson.features[0].geometry, {
			type: 'Point',
			coordinates: [-1.6, 52.6]
		});
	});

	it('should leave a file off the map when its geometry cannot be loaded', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		// the sibling is listed as a file but its geometry row is gone by the time it is fetched
		const db = dbReturning([
			[realProjectRow()],
			[boundaryFile(siblingProjectRow()), boundaryFile(realProjectRow())],
			[]
		]);
		await pageHandlerFor(db)({ params: { caseId: realProjectId }, query: {} }, mockRes);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		// the radios still offer both files; only the map loses the unresolvable one
		assert.strictEqual(viewModel.files.length, 2);
		const mapConfig = JSON.parse(viewModel.mapConfigJson);
		assert.strictEqual(mapConfig.shapefileDatasets.length, 1);
		assert.strictEqual(mapConfig.shapefileDatasets[0].id, `shapefile-${realProjectId}`);
	});

	it('should render radios without hints when the files have no upload date', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const undatedRow = realProjectRow({ receivedDate: null });
		const db = dbReturning([[undatedRow], [boundaryFile(undatedRow)]]);
		await pageHandlerFor(db)({ params: { caseId: realProjectId }, query: {} }, mockRes);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.files.length, 1);
		assert.ok(viewModel.files.every((file: { hint?: unknown }) => file.hint === undefined));
	});

	it('should 404 when caseId is missing', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		await pageHandlerFor({ $queryRaw: mock.fn() })({ params: {}, query: {} }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
	});

	it('should 404 for an id that is not a well-formed UUID', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		await pageHandlerFor({ $queryRaw: mock.fn() })({ params: { caseId: 'not-a-uuid' }, query: {} }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
	});

	it('should 404 for a well-formed id that matches no project', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		await pageHandlerFor(dbReturning([[]]))({ params: { caseId: realProjectId }, query: {} }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
	});
});

describe('project boundary submit', () => {
	function submitHandlerFor(db: unknown) {
		return buildBoundarySubmit({ db });
	}

	it('should redirect to the ruleset page for the chosen file', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn(), redirect: mock.fn() };
		const db = dbReturning([[realProjectRow()], [boundaryFile(siblingProjectRow()), boundaryFile(realProjectRow())]]);
		await submitHandlerFor(db)({ params: { caseId: realProjectId }, body: { shapefile: siblingProjectId } }, mockRes);
		assert.strictEqual(mockRes.redirect.mock.calls[0].arguments[0], `/consultees/${siblingProjectId}/ruleset`);
	});

	it('should return to the page when the submitted file is missing or not one of this project', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn(), redirect: mock.fn() };
		// each submit needs the summary row then the file list - supply them for all three calls
		const db = dbReturning([
			[realProjectRow()],
			[boundaryFile(realProjectRow())],
			[realProjectRow()],
			[boundaryFile(realProjectRow())],
			[realProjectRow()],
			[boundaryFile(realProjectRow())]
		]);
		await submitHandlerFor(db)({ params: { caseId: realProjectId }, body: {} }, mockRes);
		await submitHandlerFor(db)({ params: { caseId: realProjectId } }, mockRes);
		await submitHandlerFor(db)(
			{ params: { caseId: realProjectId }, body: { shapefile: '99999999-9999-9999-9999-999999999999' } },
			mockRes
		);
		assert.strictEqual(mockRes.redirect.mock.calls[0].arguments[0], `/consultees/${realProjectId}`);
		assert.strictEqual(mockRes.redirect.mock.calls[1].arguments[0], `/consultees/${realProjectId}`);
		assert.strictEqual(mockRes.redirect.mock.calls[2].arguments[0], `/consultees/${realProjectId}`);
	});

	it('should 404 for a malformed or unknown case', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn(), redirect: mock.fn() };
		await submitHandlerFor({ $queryRaw: mock.fn() })({ params: {}, body: {} }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);

		await submitHandlerFor({ $queryRaw: mock.fn() })({ params: { caseId: 'not-a-uuid' }, body: {} }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[1].arguments[0], 404);

		await submitHandlerFor(dbReturning([[]]))({ params: { caseId: realProjectId }, body: {} }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[2].arguments[0], 404);
	});
});

describe('project boundary static map', () => {
	it('should serve the boundary-only static map with cache headers', async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () =>
			new Response(
				Buffer.from(
					'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
					'base64'
				),
				{ status: 200, headers: { 'content-type': 'image/png' } }
			);
		const mockRes = {
			status: mock.fn(() => mockRes),
			type: mock.fn(() => mockRes),
			set: mock.fn(() => mockRes),
			send: mock.fn(),
			end: mock.fn()
		};
		try {
			const db = dbReturning([[realProjectRow()], [realProjectRow()]]);
			const handler = buildBoundaryStaticMap({ db, logger: mockLogger() }, true);
			await handler(
				{
					params: { caseId: realProjectId },
					query: {},
					headers: { 'if-none-match': '"stale-etag"', accept: 'image/png' }
				},
				mockRes
			);
			// and without conditional-request headers
			await handler({ params: { caseId: realProjectId }, query: {}, headers: {} }, mockRes);
			assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 200);
			assert.match(String(mockRes.type.mock.calls[0].arguments[0]), /image\/svg\+xml/);
			assert.match(String(mockRes.send.mock.calls[0].arguments[0]), /<svg/);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("should draw the opened file in its own style - an earlier file's colour, else red", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () => new Response(null, { status: 503 });
		const svgFor = async (files: ReturnType<typeof boundaryFile>[]) => {
			const mockRes = {
				status: mock.fn(() => mockRes),
				type: mock.fn(() => mockRes),
				set: mock.fn(() => mockRes),
				send: mock.fn(),
				end: mock.fn()
			};
			const handler = buildBoundaryStaticMap(
				{ db: dbReturning([[realProjectRow()], files]), logger: mockLogger() },
				true
			);
			await handler({ params: { caseId: realProjectId }, query: {}, headers: {} }, mockRes);
			return String(mockRes.send.mock.calls[0].arguments[0]);
		};
		try {
			// a newer sibling makes the opened file an earlier one
			const older = await svgFor([boundaryFile(siblingProjectRow()), boundaryFile(realProjectRow())]);
			assert.match(older, new RegExp(BOUNDARY_MAP_STYLES.earlier[0].colour, 'i'));
			assert.doesNotMatch(older, new RegExp(BOUNDARY_MAP_STYLES.mostRecent.colour, 'i'));

			// the newest file, or one missing from the list, is red
			assert.match(
				await svgFor([boundaryFile(realProjectRow())]),
				new RegExp(BOUNDARY_MAP_STYLES.mostRecent.colour, 'i')
			);
			assert.match(await svgFor([]), new RegExp(BOUNDARY_MAP_STYLES.mostRecent.colour, 'i'));
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it('should 404 for a malformed or unknown case', async () => {
		const mockRes = { status: mock.fn(() => mockRes), type: mock.fn(() => mockRes), send: mock.fn() };
		const handler = buildBoundaryStaticMap({ db: { $queryRaw: mock.fn() } });
		await handler({ params: {}, query: {}, headers: {} }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
		await handler({ params: { caseId: 'not-a-uuid' }, query: {}, headers: {} }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[1].arguments[0], 404);
	});
});
