import { mockLogger } from '@planning-inspectorate/core/testing';
import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';
import { configureNunjucks } from '../../nunjucks.ts';
import { CbosFunctionError, type CbosGisFileDetail, type CbosGisFileListing } from './cbos-files.ts';
import { buildCbosFilePage, buildCbosFilesPage, MAX_ROWS } from './controller.ts';
import { gisFile } from './testing.ts';

const GUID = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('admin CBOS files', () => {
	const nunjucks = configureNunjucks();
	const newRes = () => {
		const res = {
			statusCode: 200,
			status: mock.fn((code: number) => {
				res.statusCode = code;
				return res;
			}),
			render: mock.fn((view: string, data: object) => nunjucks.render(view, data))
		};
		return res;
	};
	const service = () =>
		({
			logger: mockLogger(),
			pythonFunctionUrl: 'http://localhost:7071/api/consultee-areas',
			pythonFunctionApiKey: 'key'
		}) as never;
	const html = (res: ReturnType<typeof newRes>) => res.render.mock.calls[0].result as string;
	const viewModel = (res: ReturnType<typeof newRes>) => res.render.mock.calls[0].arguments[1] as Record<string, any>;

	const listing: CbosGisFileListing = {
		casesWithReference: 3,
		casesWithGisFolder: 2,
		files: [
			gisFile({ version: 1, latestVersion: 2 }),
			gisFile({ version: 2, latestVersion: 2, mime: 'application/geo+json', originalFileName: null }),
			gisFile({
				documentGuid: 'b',
				caseReference: 'EN010002',
				caseTitle: 'Example Wind Farm',
				publishedStatus: 'invalid',
				blobPath: null
			}),
			gisFile({
				documentGuid: 'c',
				caseReference: null,
				caseTitle: null,
				folder: 'Application documents',
				mime: 'application/geo+json',
				originalFileName: null,
				fileName: null,
				latestVersion: null,
				publishedStatus: null,
				createdAt: null,
				blobContainer: null
			}),
			gisFile({ documentGuid: 'd', mime: null })
		]
	};
	const listPage = (query: Record<string, string>, list = async () => listing) => {
		const res = newRes();
		const page = buildCbosFilesPage(service(), { listFiles: list, readFile: async () => ({}) as never });
		return page({ query } as never, res as never).then(() => res);
	};

	test('summarises the cases, and lists every file with where it is and whether the import reads it', async () => {
		const res = await listPage({});
		assert.equal(res.render.mock.calls[0].arguments[0], 'admin/cbos-files/view.njk');
		assert.equal(viewModel(res).summary.casesTheImportReads, 1);
		assert.equal(viewModel(res).showing, 'Showing 5 of 5 files.');
		assert.deepEqual(
			viewModel(res).rows.map((row: Record<string, unknown>) => [
				row.fileName,
				row.version,
				row.type,
				row.blobPath,
				row.readByImport
			]),
			[
				['site.zip', '1 of 2', 'ZIP', '/application/EN010001/doc/v1', false],
				['site', '2 of 2', 'GeoJSON', '/application/EN010001/doc/v1', true],
				['site.zip', '1 of 1', 'ZIP', '', false],
				['c', '1', 'GeoJSON', '/application/EN010001/doc/v1', false],
				['site.zip', '1 of 1', '', '/application/EN010001/doc/v1', false]
			]
		);
		assert.equal(viewModel(res).rows[3].otherFolder, 'Application documents');
		assert.match(html(res), new RegExp(`href="/admin/cbos-files/${GUID}/2">site</a>`));
		assert.match(html(res), /In Application documents/);
		assert.match(html(res), /<code>invalid<\/code>/);
		assert.match(html(res), />\s*Read\s*</);
	});

	test('filters by case reference or title, and by whether the import reads a file', async () => {
		const byTitle = await listPage({ case: ' wind ' });
		assert.deepEqual(
			viewModel(byTitle).rows.map((row: Record<string, unknown>) => row.caseReference),
			['EN010002']
		);
		assert.equal(viewModel(byTitle).search, 'wind');

		const read = await listPage({ case: 'en010001', show: 'read' });
		assert.deepEqual(
			viewModel(read).rows.map((row: Record<string, unknown>) => row.version),
			['2 of 2']
		);

		const notRead = await listPage({ show: 'not-read' });
		assert.equal(viewModel(notRead).rows.length, 4);
		assert.equal(viewModel(notRead).show, 'not-read');

		assert.equal(viewModel(await listPage({ show: 'something' })).show, 'all');
	});

	test('shows only the first files of a long list, saying so', async () => {
		const many = {
			...listing,
			files: Array.from({ length: MAX_ROWS + 1 }, (_, i) => gisFile({ documentGuid: `${i}` }))
		};
		const res = await listPage({}, async () => many);
		assert.equal(viewModel(res).rows.length, MAX_ROWS);
		assert.equal(
			viewModel(res).showing,
			`Showing the first ${MAX_ROWS} of ${MAX_ROWS + 1} files - filter by case to see the rest.`
		);
	});

	test("says why the files couldn't be listed", async () => {
		const failed = await listPage({}, async () => {
			throw new CbosFunctionError('the Python function responded with status 500: Failed to list CBOS GIS files', 500);
		});
		assert.equal(
			viewModel(failed).error,
			"Could not list CBOS's files: the Python function responded with status 500: Failed to list CBOS GIS files."
		);
		assert.equal(viewModel(failed).rows, undefined);
		assert.match(html(failed), /Could not list CBOS&#39;s files/);

		const unreachable = await listPage({}, async () => {
			throw new TypeError('fetch failed');
		});
		assert.equal(
			viewModel(unreachable).error,
			"Could not list CBOS's files: the Python function could not be reached."
		);
	});

	const filePage = (params: Record<string, string>, read: () => Promise<CbosGisFileDetail>) => {
		const res = newRes();
		const page = buildCbosFilePage(service(), { listFiles: async () => listing, readFile: read });
		return page({ params } as never, res as never).then(() => res);
	};
	const zipVersion = gisFile({ version: 1, latestVersion: 2 });
	const geojsonVersion = gisFile({
		version: 2,
		latestVersion: 2,
		mime: 'application/geo+json',
		originalFileName: null
	});

	test("shows a ZIP's details, its document's versions and its files, warning of missing parts", async () => {
		const res = await filePage({ guid: GUID, version: '1' }, async () => ({
			file: zipVersion,
			versions: [zipVersion, geojsonVersion],
			content: {
				bytes: 4096,
				kind: 'zip',
				entries: [
					{ name: 'site.shp', size: 3000 },
					{ name: 'site.dbf', size: 96 }
				]
			}
		}));
		const model = viewModel(res);
		assert.equal(res.render.mock.calls[0].arguments[0], 'admin/cbos-files/file.njk');
		assert.equal(model.pageHeading, 'site.zip');
		assert.equal(model.backLinkUrl, '/admin/cbos-files?case=EN010001');
		assert.equal(model.readByImport, false);
		assert.deepEqual(
			model.versions.map((version: Record<string, unknown>) => [
				version.version,
				version.current,
				version.readByImport
			]),
			[
				['1 of 2', true, false],
				['2 of 2', false, true]
			]
		);
		assert.deepEqual(model.content.missingParts, ['.shx', '.prj']);
		assert.deepEqual(model.content.entries, [
			{ name: 'site.shp', size: '2.9 KB' },
			{ name: 'site.dbf', size: '96 bytes' }
		]);
		assert.match(html(res), /It has no .shx, .prj file/);
		assert.match(html(res), new RegExp(`href="/admin/cbos-files/${GUID}/2">2 of 2</a>`));
		assert.match(html(res), /The import doesn&#39;t read this version/);
	});

	test('summarises a GeoJSON file, telling longitude and latitude from grid metres', async () => {
		const detail = (firstPosition: number[] | null, crs?: unknown) => async () => ({
			file: geojsonVersion,
			versions: [geojsonVersion],
			content: {
				bytes: 500,
				kind: 'geojson' as const,
				type: 'FeatureCollection',
				crs,
				featureCount: 2,
				geometryTypes: ['Polygon'],
				firstPosition,
				firstFeatureProperties: { caseReference: 'EN010001' },
				preview: '{"type": "FeatureCollection"}'
			}
		});
		const lonLat = await filePage({ guid: GUID, version: '2' }, detail([-1.5, 52.1]));
		assert.equal(viewModel(lonLat).readByImport, true);
		assert.deepEqual(viewModel(lonLat).content.geojson, [
			{ key: 'Features', value: '2' },
			{ key: 'Geometry types', value: 'Polygon' },
			{ key: 'CRS', value: 'None given (GeoJSON means WGS84)' },
			{ key: 'First position', value: '-1.5, 52.1 - longitude and latitude' }
		]);
		assert.match(html(lonLat), /The import reads this version/);
		assert.match(html(lonLat), /&quot;caseReference&quot;: &quot;EN010001&quot;/);
		// one version, so no versions table
		assert.doesNotMatch(html(lonLat), /Versions of this document/);

		const metres = await filePage(
			{ guid: GUID, version: '2' },
			detail([450000, 210000], { type: 'name', properties: { name: 'EPSG:27700' } })
		);
		assert.match(viewModel(metres).content.geojson[2].value, /EPSG:27700/);
		assert.match(viewModel(metres).content.geojson[3].value, /not longitude and latitude/);

		const noPosition = await filePage({ guid: GUID, version: '2' }, detail(null));
		assert.equal(viewModel(noPosition).content.geojson[3].value, 'None');

		const noTypes = await filePage({ guid: GUID, version: '2' }, async () => {
			const result = await detail(null)();
			return { ...result, content: { ...result.content, geometryTypes: undefined } };
		});
		assert.equal(viewModel(noTypes).content.geojson[1].value, '');
	});

	test('shows other content as it came, and says why a blob could not be read', async () => {
		const text = await filePage({ guid: GUID, version: '1' }, async () => ({
			file: zipVersion,
			versions: [zipVersion],
			content: { bytes: 5, kind: 'text', preview: 'hello', problem: "isn't valid JSON" }
		}));
		assert.equal(viewModel(text).content.entries, undefined);
		assert.equal(viewModel(text).content.missingParts, undefined);
		assert.equal(viewModel(text).content.geojson, undefined);
		assert.equal(viewModel(text).content.firstFeatureProperties, undefined);
		assert.match(html(text), /It isn&#39;t valid JSON/);

		const unread = gisFile({
			caseReference: null,
			caseTitle: null,
			fileName: null,
			originalFileName: null,
			mime: null,
			size: null,
			publishedStatus: null,
			createdAt: null,
			blobContainer: null,
			blobPath: null
		});
		const missing = await filePage({ guid: GUID, version: '1' }, async () => ({
			file: unread,
			versions: [unread],
			problem: 'CBOS has no blob path for this version'
		}));
		assert.equal(viewModel(missing).content, undefined);
		assert.equal(viewModel(missing).backLinkUrl, '/admin/cbos-files');
		assert.equal(viewModel(missing).pageHeading, GUID);
		assert.match(html(missing), /Couldn&#39;t read the file: CBOS has no blob path for this version./);
		assert.ok(
			viewModel(missing).details.some(
				(detail: { key: string; value: string }) => detail.key === 'Size' && detail.value === ''
			)
		);
	});

	test("is not found for a file CBOS doesn't have, or a path that can't be one", async () => {
		const unknown = await filePage({ guid: GUID, version: '9' }, async () => {
			throw new CbosFunctionError('the Python function responded with status 404', 404);
		});
		assert.equal(unknown.statusCode, 404);

		for (const params of [{ guid: 'not-a-guid', version: '1' }, { guid: GUID, version: 'x' }, {}]) {
			const read = mock.fn(async () => ({}) as CbosGisFileDetail);
			const res = await filePage(params as Record<string, string>, read);
			assert.equal(res.statusCode, 404);
			assert.equal(read.mock.callCount(), 0);
		}
	});

	test("says why a file couldn't be read", async () => {
		const res = await filePage({ guid: GUID, version: '1' }, async () => {
			throw new CbosFunctionError('the Python function responded with status 500: Failed to read the GIS file', 500);
		});
		assert.equal(res.statusCode, 200);
		assert.equal(
			viewModel(res).error,
			'Could not read the file: the Python function responded with status 500: Failed to read the GIS file.'
		);
		assert.equal(viewModel(res).details, undefined);
	});
});
