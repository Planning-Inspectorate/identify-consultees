import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, mock, test } from 'node:test';
import type { PrismaClient } from '../client/client.ts';
import {
	clearCategories,
	clearExistingRows,
	deterministicId,
	importCaseBoundaries,
	importConsulteeAreas,
	toCaseBoundary,
	toConsulteeArea
} from './geojson-import.ts';

describe('deterministicId', () => {
	test('returns a stable UNIQUEIDENTIFIER-shaped id for the same seed', () => {
		const first = deterministicId('consultee-area:abc');
		const second = deterministicId('consultee-area:abc');
		assert.equal(first, second);
		assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
	});

	test('returns different ids for different seeds', () => {
		assert.notEqual(deterministicId('a'), deterministicId('b'));
	});
});

describe('toConsulteeArea', () => {
	test('maps camelCase ArcGIS-style properties', () => {
		const feature = toConsulteeArea({
			geometry: { type: 'Point', coordinates: [0, 0] },
			properties: {
				id: 'src-1',
				consultee: 'Example Trust',
				region: 'South',
				consulteeCategory: 'Ambulance Trust',
				caseId: 'EN010001',
				documentId: 'doc-1',
				consulteeId: 'c-1',
				organisationId: 'o-1',
				currentVersion: 2,
				metadata: { layer: 'ambulance' },
				last_updated: '2024-01-01'
			}
		});

		assert.equal(feature.properties.consultee, 'Example Trust');
		assert.equal(feature.properties.consulteeCategory, 'Ambulance Trust');
		assert.equal(feature.properties.caseReference, 'EN010001');
		assert.equal(feature.properties.currentVersion, 2);
		assert.equal(feature.properties.metadata.sourceId, 'src-1');
		assert.equal(feature.properties.metadata.layer, 'ambulance');
		assert.equal(feature.id, deterministicId('consultee-area:src-1'));
	});

	test('maps snake_case combined-export properties and preserves string metadata', () => {
		const feature = toConsulteeArea({
			geometry: { type: 'Point', coordinates: [1, 2] },
			properties: {
				id: 42,
				consultee_category: 'Railway',
				metadata: "{'source': 'python-dict-repr'}"
			}
		});

		assert.equal(feature.properties.consulteeCategory, 'Railway');
		assert.deepEqual(feature.properties.metadata, {
			rawMetadata: "{'source': 'python-dict-repr'}",
			sourceId: 42,
			sourceLastUpdated: undefined
		});
		assert.equal(feature.properties.currentVersion, 1);
	});

	test('maps a feature with no metadata to just the source fields', () => {
		const feature = toConsulteeArea({
			geometry: { type: 'Point', coordinates: [0, 0] },
			properties: { id: 'src-2' }
		});

		assert.equal(feature.properties.consultee, null);
		assert.equal(feature.properties.consulteeCategory, null);
		assert.deepEqual(feature.properties.metadata, { sourceId: 'src-2', sourceLastUpdated: undefined });
	});
});

describe('toConsulteeArea with a dataset code in the id', () => {
	test("takes the dataset's category, keeping the file's broad group as sourceCategory", () => {
		const feature = toConsulteeArea({
			geometry: { type: 'Point', coordinates: [0, 0] },
			properties: {
				id: 'health_AMB_EW_00001',
				consultee: 'East of England Ambulance Service',
				consultee_category: 'Health',
				region: 'East of England',
				metadata: { CODE: 'EE_AMB_SERV' }
			}
		});

		assert.equal(feature.properties.consulteeCategory, 'Ambulance Trust');
		assert.equal(feature.properties.region, 'East of England');
		assert.deepEqual(feature.properties.metadata, {
			CODE: 'EE_AMB_SERV',
			sourceId: 'health_AMB_EW_00001',
			sourceLastUpdated: undefined,
			sourceCategory: 'Health'
		});
		// the same id as an earlier export's, so a re-import updates the same row
		assert.equal(feature.id, deterministicId('consultee-area:health_AMB_EW_00001'));
	});

	test("keeps the file's category for a feature with no id at all", () => {
		const feature = toConsulteeArea({
			geometry: { type: 'Point', coordinates: [0, 0] },
			properties: { consultee_category: 'Railway' }
		});
		assert.equal(feature.properties.consulteeCategory, 'Railway');
	});

	test("records no sourceCategory when the file's category is already the dataset's", () => {
		const feature = toConsulteeArea({
			geometry: { type: 'Point', coordinates: [0, 0] },
			properties: { id: 'health_AMB_EW_00001', consultee_category: 'Ambulance Trust' }
		});
		assert.equal(feature.properties.consulteeCategory, 'Ambulance Trust');
		assert.equal('sourceCategory' in feature.properties.metadata, false);
	});
});

describe('toCaseBoundary', () => {
	test('derives id from caseReference and fileName so revisions are not collapsed', () => {
		const first = toCaseBoundary({
			geometry: { type: 'Point', coordinates: [0, 0] },
			properties: {
				caseReference: 'EN010099',
				projectName: 'Example',
				fileName: 'v1.zip',
				receivedDate: '2024-06-01T00:00:00.000Z'
			}
		});
		const second = toCaseBoundary({
			geometry: { type: 'Point', coordinates: [0, 0] },
			properties: {
				caseReference: 'EN010099',
				projectName: 'Example',
				fileName: 'v2.zip',
				receivedDate: '2024-07-01T00:00:00.000Z'
			}
		});

		assert.notEqual(first.id, second.id);
		assert.equal(first.properties.caseReference, 'EN010099');
		assert.equal(first.properties.caseName, 'Example');
		assert.equal(first.properties.fileName, 'v1.zip');
		assert.ok(first.properties.receivedDate instanceof Date);
	});

	test('maps absent optional fields to null', () => {
		const feature = toCaseBoundary({
			geometry: { type: 'Point', coordinates: [0, 0] },
			properties: { caseReference: 'EN010099', projectName: 'Example' }
		});

		assert.equal(feature.properties.fileName, null);
		assert.equal(feature.properties.receivedDate, null);
	});
});

/** A stand-in client whose deletes report `batches` in turn, recording the SQL it was sent. */
function deletingClient(batches: number[]) {
	const statements: string[] = [];
	const $executeRaw = mock.fn(async (sql: TemplateStringsArray) => {
		statements.push(sql.join('?'));
		return batches.shift() ?? 0;
	});
	return { client: { $executeRaw } as unknown as PrismaClient, statements, $executeRaw };
}

describe('clearExistingRows', () => {
	test('deletes a batch at a time until a batch comes back short', async () => {
		const { client, statements } = deletingClient([500, 500, 120]);
		assert.equal(await clearExistingRows(client, 'consultee-areas'), 1_120);
		assert.equal(statements.length, 3);
		assert.ok(statements.every((sql) => sql.includes('FROM consultee_area')));
	});

	test('clears case boundaries from their own table', async () => {
		const { client, statements } = deletingClient([0]);
		assert.equal(await clearExistingRows(client, 'case-boundaries'), 0);
		assert.match(statements[0], /FROM case_boundary/);
	});
});

async function withFile(contents: string, fn: (filePath: string) => Promise<void>) {
	const dir = await mkdtemp(path.join(tmpdir(), 'geojson-import-test-'));
	try {
		const filePath = path.join(dir, 'data.geojson');
		await writeFile(filePath, contents);
		await fn(filePath);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

describe('clearCategories', () => {
	test("deletes only the named categories' rows, a batch at a time", async () => {
		const { client, statements, $executeRaw } = deletingClient([500, 7]);
		assert.equal(await clearCategories(client, ['Ambulance Trust', 'Police']), 507);
		assert.equal(statements.length, 2);
		assert.match(statements[0], /DELETE TOP \(\?\) FROM consultee_area WHERE consulteeCategory IN \(\?\)/);
		assert.match(JSON.stringify($executeRaw.mock.calls[0].arguments), /Ambulance Trust.*Police/);
	});
});

describe('importConsulteeAreas with replace', () => {
	test('refuses to clear the table for a file with no features', async () => {
		const { client, $executeRaw } = deletingClient([]);
		await withFile(JSON.stringify({ type: 'FeatureCollection', features: [] }), async (filePath) => {
			await assert.rejects(
				() => importConsulteeAreas(client, filePath, { replace: true }),
				/Refusing to replace consultee-areas with a file holding no features/
			);
		});
		assert.equal($executeRaw.mock.callCount(), 0);
	});

	test('does not clear anything when the file does not parse', async () => {
		const { client, $executeRaw } = deletingClient([]);
		await withFile('{ not json', async (filePath) => {
			await assert.rejects(() => importConsulteeAreas(client, filePath, { replace: true }));
		});
		assert.equal($executeRaw.mock.callCount(), 0);
	});
});

describe('imports without replace', () => {
	// the loaders write with $executeRaw MERGE batches, so a stand-in client whose $executeRaw
	// resolves exercises the whole read-file -> map -> load path without a real database
	function loadingClient() {
		const $executeRaw = mock.fn(async () => 1);
		return { client: { $executeRaw } as unknown as PrismaClient, $executeRaw };
	}

	test('importConsulteeAreas loads the file rows without clearing anything', async () => {
		const { client, $executeRaw } = loadingClient();
		const file = {
			type: 'FeatureCollection',
			features: [
				{
					geometry: { type: 'Point', coordinates: [0, 0] },
					properties: { id: 'src-1', consultee: 'Example Trust', consulteeCategory: 'Ambulance Trust' }
				}
			]
		};
		await withFile(JSON.stringify(file), async (filePath) => {
			assert.equal(await importConsulteeAreas(client, filePath), 1);
		});
		assert.equal($executeRaw.mock.callCount(), 1);
	});

	test('importCaseBoundaries loads the file rows into case_boundary', async () => {
		const { client, $executeRaw } = loadingClient();
		const file = {
			type: 'FeatureCollection',
			features: [
				{
					geometry: { type: 'Point', coordinates: [0, 0] },
					properties: {
						caseReference: 'EN010099',
						projectName: 'Example',
						fileName: 'v1.zip',
						receivedDate: '2024-06-01T00:00:00.000Z'
					}
				}
			]
		};
		await withFile(JSON.stringify(file), async (filePath) => {
			assert.equal(await importCaseBoundaries(client, filePath), 1);
		});
		assert.equal($executeRaw.mock.callCount(), 1);
	});

	test('importConsulteeAreas loads a chunk of the file at a time, reporting progress across them', async () => {
		const { client, $executeRaw } = loadingClient();
		const features = ['a', 'b', 'c'].map((id) => ({
			geometry: { type: 'Point', coordinates: [0, 0] },
			properties: { id, consultee: id, consulteeCategory: 'Ambulance Trust' }
		}));
		const progress: [number, number][] = [];
		await withFile(JSON.stringify({ type: 'FeatureCollection', features }), async (filePath) => {
			const imported = await importConsulteeAreas(client, filePath, {
				// two features' worth: a, b, then c
				chunkCharacters: JSON.stringify(features[0]).length * 2 + 2,
				onProgress: (loaded, total) => progress.push([loaded, total])
			});
			assert.equal(imported, 3);
		});
		// one MERGE per chunk
		assert.equal($executeRaw.mock.callCount(), 2);
		assert.deepEqual(progress, [
			[2, 3],
			[3, 3]
		]);
	});

	test('a feature larger than a chunk loads on its own', async () => {
		const { client, $executeRaw } = loadingClient();
		const features = ['a', 'b'].map((id) => ({
			geometry: { type: 'Point', coordinates: [0, 0] },
			properties: { id, consulteeCategory: 'Ambulance Trust' }
		}));
		await withFile(JSON.stringify({ type: 'FeatureCollection', features }), async (filePath) => {
			assert.equal(await importConsulteeAreas(client, filePath, { chunkCharacters: 1 }), 2);
		});
		assert.equal($executeRaw.mock.callCount(), 2);
	});

	test("importConsulteeAreas replacing categories clears only the file's, then loads", async () => {
		const { client, $executeRaw } = loadingClient();
		const file = {
			type: 'FeatureCollection',
			features: [
				{
					geometry: { type: 'Point', coordinates: [0, 0] },
					properties: { id: 'health_AMB_EW_00001', consultee_category: 'Health' }
				},
				{
					geometry: { type: 'Point', coordinates: [0, 0] },
					properties: { id: 'health_AMB_EW_00002', consultee_category: 'Health' }
				},
				{
					geometry: { type: 'Point', coordinates: [0, 0] },
					properties: { id: 'other_ELG_EW_00001', consultee_category: 'Other' }
				},
				// no category: nothing of it to clear
				{ geometry: { type: 'Point', coordinates: [0, 0] }, properties: { id: 'src-1' } }
			]
		};
		await withFile(JSON.stringify(file), async (filePath) => {
			assert.equal(await importConsulteeAreas(client, filePath, { replace: 'categories' }), 4);
		});
		// one category delete that comes back short, then one MERGE batch
		assert.equal($executeRaw.mock.callCount(), 2);
		assert.match($executeRaw.mock.calls[0].arguments[0].join('?'), /WHERE consulteeCategory IN/);
		assert.match(
			JSON.stringify($executeRaw.mock.calls[0].arguments.slice(1)),
			/Ambulance Trust.*Electricity Generator/
		);
	});

	test('importConsulteeAreas replacing categories clears nothing for a file with none', async () => {
		const { client, $executeRaw } = loadingClient();
		const file = {
			type: 'FeatureCollection',
			features: [{ geometry: { type: 'Point', coordinates: [0, 0] }, properties: { id: 'src-1' } }]
		};
		await withFile(JSON.stringify(file), async (filePath) => {
			assert.equal(await importConsulteeAreas(client, filePath, { replace: 'categories' }), 1);
		});
		// just the MERGE batch
		assert.equal($executeRaw.mock.callCount(), 1);
		assert.match($executeRaw.mock.calls[0].arguments[0].join('?'), /MERGE/);
	});

	test("importConsulteeAreas changes nothing for a file holding a dataset the config doesn't list", async () => {
		const { client, $executeRaw } = loadingClient();
		const file = {
			type: 'FeatureCollection',
			features: [
				{
					geometry: { type: 'Point', coordinates: [0, 0] },
					properties: { id: 'other_HOS_EW_00001', consultee_category: 'Other' }
				}
			]
		};
		await withFile(JSON.stringify(file), async (filePath) => {
			await assert.rejects(() => importConsulteeAreas(client, filePath, { replace: 'categories' }), /dataset HOS_EW/);
		});
		assert.equal($executeRaw.mock.callCount(), 0);
	});

	test('importCaseBoundaries replacing categories replaces every case boundary - they have none', async () => {
		const { client, $executeRaw } = loadingClient();
		const file = {
			type: 'FeatureCollection',
			features: [
				{
					geometry: { type: 'Point', coordinates: [0, 0] },
					properties: { caseReference: 'EN010099', projectName: 'Example' }
				}
			]
		};
		await withFile(JSON.stringify(file), async (filePath) => {
			assert.equal(await importCaseBoundaries(client, filePath, { replace: 'categories' }), 1);
		});
		assert.match($executeRaw.mock.calls[0].arguments[0].join('?'), /FROM case_boundary/);
	});

	test('importConsulteeAreas with replace clears the table once the file has parsed', async () => {
		const { client, $executeRaw } = loadingClient();
		const file = {
			type: 'FeatureCollection',
			features: [
				{
					geometry: { type: 'Point', coordinates: [0, 0] },
					properties: { id: 'src-1', consultee: 'Example Trust' }
				}
			]
		};
		await withFile(JSON.stringify(file), async (filePath) => {
			assert.equal(await importConsulteeAreas(client, filePath, { replace: true }), 1);
		});
		// one batch delete that comes back short, then one MERGE batch
		assert.equal($executeRaw.mock.callCount(), 2);
		assert.match($executeRaw.mock.calls[0].arguments[0].join('?'), /FROM consultee_area/);
	});
});
