import { deterministicId } from '@pins/identify-consultees-database/src/seed/geojson-import.ts';
import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import type { CbosBoundaryFile, CbosFeatureCollection } from './cbos-boundaries.ts';
import {
	combineGeometries,
	distinctFileNames,
	fetchCbosBoundaryGeoJson,
	importCaseBoundariesFromCbos,
	listCbosBoundaryFiles,
	toCaseBoundaryFromCbos
} from './cbos-boundaries.ts';

const OPTIONS = { pythonFunctionUrl: 'http://localhost:7071/api/consultee-areas', apiKey: 'test-key' };
const FILE: CbosBoundaryFile = {
	documentGuid: '0f8fad5b-d9cb-469f-a165-70867728950e',
	version: 2,
	caseReference: 'EN010001',
	caseTitle: 'Example Solar Farm',
	fileName: 'site.geojson',
	createdAt: '2026-05-01T09:30:00+00:00'
};
const SQUARE = {
	type: 'Polygon' as const,
	coordinates: [
		[
			[0, 0],
			[1, 0],
			[1, 1],
			[0, 0]
		] as [number, number][]
	]
};
const collection = (...features: CbosFeatureCollection['features']): CbosFeatureCollection => ({
	type: 'FeatureCollection',
	features
});
const respondWith = (status: number, body: unknown) => async () =>
	({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

describe('CBOS boundaries', () => {
	describe('listCbosBoundaryFiles', () => {
		it('lists the files from the function, sending the API key', async (t) => {
			const fetchMock = t.mock.method(globalThis, 'fetch', respondWith(200, { files: [FILE] }));

			assert.deepStrictEqual(await listCbosBoundaryFiles(OPTIONS), [FILE]);
			assert.strictEqual(fetchMock.mock.calls[0].arguments[0], 'http://localhost:7071/api/cbos/boundary-files');
			assert.strictEqual(fetchMock.mock.calls[0].arguments[1]?.headers?.['x-api-key' as keyof HeadersInit], 'test-key');
		});

		it('sends no key header when none is configured', async (t) => {
			const fetchMock = t.mock.method(globalThis, 'fetch', respondWith(200, { files: [] }));

			await listCbosBoundaryFiles({ ...OPTIONS, apiKey: undefined });
			assert.strictEqual(fetchMock.mock.calls[0].arguments[1]?.headers, undefined);
		});

		it('rejects an unexpected body, a failed response or a missing URL', async (t) => {
			t.mock.method(globalThis, 'fetch', respondWith(200, {}));
			await assert.rejects(listCbosBoundaryFiles(OPTIONS), /unexpected boundary file list/);

			t.mock.method(globalThis, 'fetch', respondWith(500, { error: 'Failed' }));
			await assert.rejects(listCbosBoundaryFiles(OPTIONS), /status 500/);

			await assert.rejects(listCbosBoundaryFiles({ ...OPTIONS, pythonFunctionUrl: undefined }), /not configured/);
		});
	});

	describe('fetchCbosBoundaryGeoJson', () => {
		it('fetches one file by document and version', async (t) => {
			const body = collection({ geometry: SQUARE });
			const fetchMock = t.mock.method(globalThis, 'fetch', respondWith(200, body));

			assert.deepStrictEqual(await fetchCbosBoundaryGeoJson(OPTIONS, FILE), body);
			assert.strictEqual(
				fetchMock.mock.calls[0].arguments[0],
				'http://localhost:7071/api/cbos/boundary-files/0f8fad5b-d9cb-469f-a165-70867728950e/2'
			);
		});

		it('rejects anything but a FeatureCollection', async (t) => {
			t.mock.method(globalThis, 'fetch', respondWith(200, { type: 'Feature' }));
			await assert.rejects(fetchCbosBoundaryGeoJson(OPTIONS, FILE), /GeoJSON FeatureCollection/);
		});
	});

	describe('combineGeometries', () => {
		it('keeps a single geometry as it is', () => {
			assert.deepStrictEqual(combineGeometries([SQUARE]), SQUARE);
		});

		it('merges polygons and multipolygons into one MultiPolygon', () => {
			const multi = { type: 'MultiPolygon' as const, coordinates: [SQUARE.coordinates, SQUARE.coordinates] };
			assert.deepStrictEqual(combineGeometries([SQUARE, multi]), {
				type: 'MultiPolygon',
				coordinates: [SQUARE.coordinates, SQUARE.coordinates, SQUARE.coordinates]
			});
		});

		it('falls back to a GeometryCollection for anything else', () => {
			const line = {
				type: 'LineString' as const,
				coordinates: [
					[0, 0],
					[1, 1]
				] as [number, number][]
			};
			assert.deepStrictEqual(combineGeometries([SQUARE, line]), {
				type: 'GeometryCollection',
				geometries: [SQUARE, line]
			});
		});
	});

	describe('toCaseBoundaryFromCbos', () => {
		it("uses the file import's id, CBOS's current title and the stamped received date", () => {
			const boundary = toCaseBoundaryFromCbos(
				FILE,
				collection(
					{
						geometry: SQUARE,
						properties: { projectName: 'Old name', fileName: 'site.geojson', receivedDate: '2026-04-30T12:00:00.000Z' }
					},
					{ geometry: SQUARE, properties: {} },
					{ geometry: null }
				)
			);

			assert.strictEqual(boundary.id, deterministicId('case-boundary:EN010001:site.geojson'));
			assert.strictEqual(boundary.geometry.type, 'MultiPolygon');
			assert.deepStrictEqual(boundary.properties, {
				caseReference: 'EN010001',
				caseName: 'Example Solar Farm',
				fileName: 'site.geojson',
				receivedDate: new Date('2026-04-30T12:00:00.000Z'),
				metadata: { source: 'cbos', cbosDocumentGuid: FILE.documentGuid, cbosVersion: 2 }
			});
		});

		it('falls back to the stamped properties, then the reference, guid and CBOS date', () => {
			const stamped = toCaseBoundaryFromCbos(
				{ ...FILE, caseTitle: null, fileName: null },
				collection({ geometry: SQUARE, properties: { projectName: 'Stamped', fileName: 'stamped.geojson' } })
			);
			assert.strictEqual(stamped.properties.caseName, 'Stamped');
			assert.strictEqual(stamped.properties.fileName, 'stamped.geojson');
			assert.deepStrictEqual(stamped.properties.receivedDate, new Date('2026-05-01T09:30:00+00:00'));

			const bare = toCaseBoundaryFromCbos(
				{ ...FILE, caseTitle: null, fileName: null },
				collection({ geometry: SQUARE })
			);
			assert.strictEqual(bare.properties.caseName, 'EN010001');
			assert.strictEqual(bare.properties.fileName, `${FILE.documentGuid}.geojson`);
		});

		it('rejects coordinates that are not longitude and latitude, in any geometry type', () => {
			const bng = {
				type: 'Polygon' as const,
				coordinates: [
					[
						[530000, 180000],
						[530100, 180000],
						[530000, 180100],
						[530000, 180000]
					]
				] as [number, number][][]
			};
			assert.throws(() => toCaseBoundaryFromCbos(FILE, collection({ geometry: bng })), /no \.prj file/);

			const lonLat: [number, number] = [-1.5, 52.5];
			const valid = [
				{ type: 'Point' as const, coordinates: lonLat },
				{ type: 'MultiPoint' as const, coordinates: [lonLat] },
				{ type: 'LineString' as const, coordinates: [lonLat, lonLat] },
				{ type: 'MultiLineString' as const, coordinates: [[lonLat, lonLat]] },
				{ type: 'MultiPolygon' as const, coordinates: [SQUARE.coordinates] },
				{ type: 'GeometryCollection' as const, geometries: [SQUARE] }
			];
			for (const geometry of valid) {
				assert.doesNotThrow(() => toCaseBoundaryFromCbos(FILE, collection({ geometry })));
			}
			assert.throws(
				() => toCaseBoundaryFromCbos(FILE, collection({ geometry: { type: 'Point', coordinates: [181, 0] } })),
				/longitude and latitude/
			);
		});

		it('rejects a file with no geometry', () => {
			assert.throws(() => toCaseBoundaryFromCbos(FILE, collection({ geometry: null })), /no geometry/);
			assert.throws(() => toCaseBoundaryFromCbos(FILE, collection()), /no geometry/);
		});
	});

	describe('importCaseBoundariesFromCbos', () => {
		const db = {} as Parameters<typeof importCaseBoundariesFromCbos>[0];

		it('saves every file it can read and reports the rest', async () => {
			const files = [
				FILE,
				{ ...FILE, documentGuid: 'bad', fileName: 'broken.geojson' },
				{ ...FILE, documentGuid: 'empty', fileName: 'empty.geojson' }
			];
			const load = mock.fn(async (_db: unknown, features: { features: unknown[] }) => features.features.length);
			const result = await importCaseBoundariesFromCbos(db, OPTIONS, {
				listFiles: async () => files,
				fetchGeoJson: async (_options, file) => {
					if (file.documentGuid === 'bad') throw new Error('status 500');
					return file.documentGuid === 'empty' ? collection() : collection({ geometry: SQUARE });
				},
				load: load as never
			});

			assert.strictEqual(load.mock.callCount(), 1);
			assert.deepStrictEqual(result, {
				filesFound: 3,
				imported: 1,
				casesImported: 1,
				failures: [
					{ caseReference: 'EN010001', fileName: 'broken.geojson', reason: 'status 500' },
					{ caseReference: 'EN010001', fileName: 'empty.geojson', reason: 'the GeoJSON has no geometry' }
				]
			});
		});

		it("keeps every version of a case's boundaries, telling apart ones of the same name", async () => {
			const load = mock.fn(async (_db: unknown, features: { features: { properties: object }[] }) => {
				saved.push(...features.features.map((feature) => feature.properties));
				return features.features.length;
			});
			const saved: object[] = [];
			const result = await importCaseBoundariesFromCbos(db, OPTIONS, {
				listFiles: async () => [
					{ ...FILE, version: 2, createdAt: '2026-01-01T09:00:00+00:00' },
					{ ...FILE, version: 4, createdAt: '2026-05-01T09:00:00+00:00' },
					{ ...FILE, caseReference: 'TR010001', documentGuid: 'other' }
				],
				fetchGeoJson: async () => collection({ geometry: SQUARE }),
				load: load as never
			});

			assert.strictEqual(result.casesImported, 2);
			assert.deepStrictEqual(
				saved.map((properties) => (properties as { fileName: string }).fileName),
				['site.geojson (version 2)', 'site.geojson', 'site.geojson']
			);
		});

		it('saves nothing when no file could be read, and describes non-Error failures', async () => {
			const load = mock.fn(async () => 0);
			const result = await importCaseBoundariesFromCbos(db, OPTIONS, {
				listFiles: async () => [FILE],
				fetchGeoJson: async () => {
					throw 'unreachable';
				},
				load: load as never
			});

			assert.strictEqual(load.mock.callCount(), 0);
			assert.deepStrictEqual(result.failures, [
				{ caseReference: 'EN010001', fileName: 'site.geojson', reason: 'unreachable' }
			]);
			assert.strictEqual(result.imported, 0);
		});

		it('rejects when the files cannot be listed', async () => {
			await assert.rejects(
				importCaseBoundariesFromCbos(db, OPTIONS, {
					listFiles: async () => {
						throw new Error('status 500');
					},
					fetchGeoJson: async () => collection(),
					load: (async () => 0) as never
				}),
				/status 500/
			);
		});
	});

	describe('distinctFileNames', () => {
		it('leaves the newest of a name as it is, and names older ones for their version', () => {
			const newest = { ...FILE, version: 4, createdAt: '2026-05-01T09:00:00+00:00' };
			const older = { ...FILE, version: 2, createdAt: '2026-01-01T09:00:00+00:00' };
			assert.deepStrictEqual(
				distinctFileNames([older, newest]).map((file) => file.fileName),
				['site.geojson (version 2)', 'site.geojson']
			);
			// the newest file keeps its own object - nothing about it changes
			assert.strictEqual(distinctFileNames([older, newest])[1], newest);
		});

		it('tells apart two older versions of one number, and orders undated files last', () => {
			const files = [
				{ ...FILE, documentGuid: 'aaaaaaaa-1111', version: 2, createdAt: null },
				{ ...FILE, documentGuid: 'bbbbbbbb-2222', version: 2, createdAt: null },
				{ ...FILE, documentGuid: 'cccccccc-3333', version: 3, createdAt: '2026-05-01T09:00:00+00:00' }
			];
			assert.deepStrictEqual(
				distinctFileNames(files).map((file) => file.fileName),
				['site.geojson (version 2)', 'site.geojson (version 2, bbbbbbbb)', 'site.geojson']
			);
		});

		it("leaves files without a name, and other cases' files, as they are", () => {
			const unnamed = { ...FILE, fileName: null };
			const otherCase = { ...FILE, caseReference: 'TR010001' };
			assert.deepStrictEqual(distinctFileNames([unnamed, unnamed, FILE, otherCase]), [
				unnamed,
				unnamed,
				FILE,
				otherCase
			]);
		});
	});
});
