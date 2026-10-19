import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	CbosFunctionError,
	filesTheImportReads,
	isLongitudeLatitude,
	listCbosGisFiles,
	missingShapefileParts,
	readCbosGisFile,
	summarise
} from './cbos-files.ts';
import { gisFile } from './testing.ts';

const OPTIONS = { pythonFunctionUrl: 'http://localhost:7071/api/consultee-areas', apiKey: 'test-key' };

const respondWith = (status: number, body: unknown) => async () =>
	({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

describe('CBOS files client', () => {
	test('lists the files from the route next to the configured one, sending the API key', async (t) => {
		const listing = { casesWithReference: 2, casesWithGisFolder: 1, files: [gisFile()] };
		const fetchMock = t.mock.method(globalThis, 'fetch', respondWith(200, listing));

		assert.deepEqual(await listCbosGisFiles(OPTIONS), listing);
		assert.equal(fetchMock.mock.calls[0].arguments[0], 'http://localhost:7071/api/cbos/gis-files');
		assert.equal(
			(fetchMock.mock.calls[0].arguments[1] as { headers: Record<string, string> }).headers['x-api-key'],
			'test-key'
		);
	});

	test('reads one file with its versions, sending no key when none is configured', async (t) => {
		const detail = { file: gisFile(), versions: [gisFile()] };
		const fetchMock = t.mock.method(globalThis, 'fetch', respondWith(200, detail));

		assert.deepEqual(
			await readCbosGisFile({ ...OPTIONS, apiKey: undefined }, '0f8fad5b-d9cb-469f-a165-70867728950e', 1),
			detail
		);
		assert.equal(
			fetchMock.mock.calls[0].arguments[0],
			'http://localhost:7071/api/cbos/gis-files/0f8fad5b-d9cb-469f-a165-70867728950e/1'
		);
		assert.equal((fetchMock.mock.calls[0].arguments[1] as { headers?: unknown }).headers, undefined);
	});

	test("reports the function's status and error, and a body that isn't JSON", async (t) => {
		t.mock.method(globalThis, 'fetch', respondWith(404, { error: 'GIS file not found' }));
		await assert.rejects(readCbosGisFile(OPTIONS, 'guid', 1), (error: CbosFunctionError) => {
			assert.equal(error.status, 404);
			assert.equal(error.message, 'the Python function responded with status 404: GIS file not found');
			return true;
		});

		t.mock.method(
			globalThis,
			'fetch',
			async () => ({ ok: false, status: 502, json: async () => Promise.reject(new Error('not JSON')) }) as Response
		);
		await assert.rejects(listCbosGisFiles(OPTIONS), /responded with status 502$/);
	});

	test("refuses an unexpected response, and calls nothing when the function isn't configured", async (t) => {
		t.mock.method(globalThis, 'fetch', respondWith(200, { rows: [] }));
		await assert.rejects(listCbosGisFiles(OPTIONS), /unexpected file list/);
		await assert.rejects(readCbosGisFile(OPTIONS, 'guid', 1), /unexpected file/);
		await assert.rejects(listCbosGisFiles({ pythonFunctionUrl: undefined, apiKey: undefined }), /not configured/);
	});
});

describe('which files the import reads', () => {
	test("each document's newest GeoJSON version in a GIS Shapefiles folder, on a case with a reference", () => {
		const files = [
			gisFile({ version: 1, mime: 'application/zip' }),
			gisFile({ version: 2, mime: 'application/geo+json' }),
			// a newer ZIP CBOS couldn't convert leaves the last good GeoJSON read
			gisFile({ version: 3, mime: 'application/x-zip-compressed' }),
			gisFile({ documentGuid: 'b', version: 1, mime: 'application/geo+json' }),
			gisFile({ documentGuid: 'b', version: 3, mime: 'application/geo+json' }),
			gisFile({ documentGuid: 'b', version: 2, mime: 'application/geo+json' }),
			gisFile({ documentGuid: 'elsewhere', mime: 'application/geo+json', folder: 'Application documents' }),
			gisFile({ documentGuid: 'no-reference', mime: 'application/geo+json', caseReference: null })
		];
		assert.deepEqual([...filesTheImportReads(files)], ['0f8fad5b-d9cb-469f-a165-70867728950e/2', 'b/3']);
	});
});

describe('summarise', () => {
	test('counts where the cases drop out, and why the ZIPs were not converted', () => {
		const files = [
			// read
			gisFile({ caseReference: 'EN010001', documentGuid: 'a', mime: 'application/geo+json' }),
			// only an unconverted ZIP, never virus checked
			gisFile({ caseReference: 'EN010002', documentGuid: 'b', publishedStatus: 'awaiting_upload' }),
			// a ZIP CBOS couldn't convert, its latest version the one that counts
			gisFile({ caseReference: 'EN010003', documentGuid: 'c', version: 2, publishedStatus: 'invalid' }),
			gisFile({ caseReference: 'EN010003', documentGuid: 'c', version: 1, publishedStatus: 'not_checked' }),
			gisFile({ caseReference: 'EN010004', documentGuid: 'd', version: 1, publishedStatus: 'not_checked' }),
			gisFile({ caseReference: 'EN010004', documentGuid: 'd', version: 2, publishedStatus: 'invalid' }),
			// a case with an unconverted ZIP and one that's read counts as read
			gisFile({ caseReference: 'EN010001', documentGuid: 'e', publishedStatus: null }),
			// neither a ZIP nor GeoJSON, and no reference
			gisFile({ caseReference: null, documentGuid: 'f', mime: 'application/pdf' }),
			// GeoJSON in another folder
			gisFile({ caseReference: 'EN010005', documentGuid: 'g', mime: 'application/geo+json', folder: 'Other' })
		];
		assert.deepEqual(summarise({ casesWithReference: 10, casesWithGisFolder: 8, files }), {
			casesWithReference: 10,
			casesWithGisFolder: 8,
			casesWithFilesInGisFolder: 5,
			casesTheImportReads: 1,
			casesWithOnlyUnconvertedZips: 3,
			casesWithGeoJsonElsewhere: 1,
			unconvertedZipsByStatus: [
				{ status: 'invalid', documents: 2 },
				{ status: '(none)', documents: 1 },
				{ status: 'awaiting_upload', documents: 1 }
			]
		});
	});
});

describe('file checks', () => {
	test("names the shapefile parts a ZIP's listing is missing, ignoring case and folders", () => {
		assert.deepEqual(missingShapefileParts([{ name: 'site/SITE.SHP' }, { name: 'site.dbf' }]), ['.shx', '.prj']);
		assert.deepEqual(
			missingShapefileParts([{ name: 'a.shp' }, { name: 'a.shx' }, { name: 'a.dbf' }, { name: 'a.prj' }]),
			[]
		);
	});

	test('tells longitude and latitude from British National Grid metres', () => {
		assert.equal(isLongitudeLatitude([-1.5, 52.1]), true);
		assert.equal(isLongitudeLatitude([450000, 210000]), false);
		assert.equal(isLongitudeLatitude([1]), undefined);
		assert.equal(isLongitudeLatitude(null), undefined);
		assert.equal(isLongitudeLatitude(undefined), undefined);
	});
});
