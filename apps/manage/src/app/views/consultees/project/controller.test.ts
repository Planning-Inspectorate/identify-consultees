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

		// a single-file case lists just that file, and no radio is pre-selected
		assert.strictEqual(viewModel.files.length, 1);
		assert.strictEqual(viewModel.files[0].value, realProjectId);
		assert.strictEqual(viewModel.files[0].text, 'EN010099.geojson');
		assert.strictEqual('checked' in viewModel.files[0], false);
		assert.match(viewModel.files[0].hint.text, /Uploaded: /);

		const mapConfig = JSON.parse(viewModel.mapConfigJson);
		assert.strictEqual(mapConfig.shapefileGroupLabel, 'GIS shapefiles');
		assert.strictEqual(mapConfig.shapefileDatasets.length, 1);
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
		// receivedDate DESC puts the newer sibling first; no radio is pre-selected
		assert.strictEqual(viewModel.files[0].value, siblingProjectId);
		assert.strictEqual(viewModel.files[1].value, realProjectId);
		assert.ok(viewModel.files.every((file) => !('checked' in file)));

		const mapConfig = JSON.parse(viewModel.mapConfigJson);
		// both drawn, every file visible - no layer is singled out
		assert.ok(mapConfig.shapefileDatasets.every((dataset: object) => !('checked' in dataset)));
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

	it('should show an error banner with a retry link when the map cannot be loaded', async () => {
		const nunjucks = configureNunjucks();
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn((view, data) => nunjucks.render(view, data))
		};
		// the sibling is listed as a file, but fetching its geometry fails
		let call = 0;
		const db = {
			$queryRaw: mock.fn(async () => {
				call += 1;
				if (call === 1) return [realProjectRow()];
				if (call === 2) return [boundaryFile(siblingProjectRow()), boundaryFile(realProjectRow())];
				throw new Error('geometry store down');
			})
		};
		await pageHandlerFor(db)({ params: { caseId: realProjectId }, query: {} }, mockRes);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.mapFailed, true);
		assert.strictEqual(viewModel.retryUrl, `/consultees/${realProjectId}`);
		// the radios still render - the page works without the map
		assert.strictEqual(viewModel.files.length, 2);

		const html = mockRes.render.mock.calls[0].result;
		assert.match(html, /problem loading the map/);
		assert.match(html, /try again later/);
		assert.match(html, />Try again</);
		assert.doesNotMatch(html, /app-consultee-map/);
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

	it('should re-render with a validation error when the submitted file is missing or not one of this project', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn(), redirect: mock.fn() };
		// each unanswered submit resolves the case then lists its files (the single-file map needs
		// no further lookups), so supply those rows for all three calls
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
		assert.strictEqual(mockRes.redirect.mock.callCount(), 0);
		assert.strictEqual(mockRes.render.mock.callCount(), 3);
		for (const call of mockRes.render.mock.calls) {
			assert.strictEqual(call.arguments[0], 'views/consultees/project/view.njk');
			assert.deepStrictEqual(call.arguments[1].errorSummary, [{ text: 'Select a shapefile', href: '#shapefile' }]);
			assert.deepStrictEqual(call.arguments[1].shapefileError, { text: 'Select a shapefile' });
		}
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

	it('should draw every file the case holds, each in its own style, the most recent on top', async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () => new Response(null, { status: 503 });
		// the case's own row, the file list, then each other file's geometry
		const svgFor = async (calls: unknown[][]) => {
			const mockRes = {
				status: mock.fn(() => mockRes),
				type: mock.fn(() => mockRes),
				set: mock.fn(() => mockRes),
				send: mock.fn(),
				end: mock.fn()
			};
			const handler = buildBoundaryStaticMap({ db: dbReturning(calls), logger: mockLogger() }, true);
			await handler({ params: { caseId: realProjectId }, query: {}, headers: {} }, mockRes);
			return String(mockRes.send.mock.calls[0].arguments[0]);
		};
		const earlier = new RegExp(BOUNDARY_MAP_STYLES.earlier[0].colour, 'i');
		const mostRecent = new RegExp(BOUNDARY_MAP_STYLES.mostRecent.colour, 'i');
		try {
			// a newer sibling: both drawn, the opened (earlier) file first, the newest over it
			const both = await svgFor([
				[realProjectRow()],
				[boundaryFile(siblingProjectRow()), boundaryFile(realProjectRow())],
				[siblingProjectRow()]
			]);
			assert.ok(both.search(earlier) >= 0 && both.search(mostRecent) > both.search(earlier));

			// a sibling gone by the time its geometry is fetched isn't drawn
			const gone = await svgFor([
				[realProjectRow()],
				[boundaryFile(siblingProjectRow()), boundaryFile(realProjectRow())],
				[]
			]);
			assert.match(gone, earlier);
			assert.doesNotMatch(gone, mostRecent);

			// the opened file alone is the newest - red - even when it's missing from the list
			assert.match(await svgFor([[realProjectRow()], [boundaryFile(realProjectRow())]]), mostRecent);
			assert.match(await svgFor([[realProjectRow()], []]), mostRecent);
			assert.match(await svgFor([[realProjectRow({ receivedDate: null })], []]), mostRecent);
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
