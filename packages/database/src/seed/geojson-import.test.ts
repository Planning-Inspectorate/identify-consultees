import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, mock, test } from 'node:test';
import type { PrismaClient } from '../client/client.ts';
import {
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
	test("maps an export feature: its dataset's category, its broad group and its metadata as given", () => {
		const feature = toConsulteeArea({
			geometry: { type: 'Point', coordinates: [0, 0] },
			properties: {
				id: 'health_AMB_EW_00001',
				consultee: 'East of England Ambulance Service',
				consultee_category: 'Health',
				region: 'East of England',
				geometry_type: 'MultiPolygon',
				metadata: { CODE: 'EE_AMB_SERV', NAME: 'East of England Ambulance Service' }
			}
		});

		assert.deepEqual(feature.properties, {
			sourceId: 'health_AMB_EW_00001',
			consulteeCategory: 'Ambulance Trust',
			consulteeGroup: 'Health',
			consulteeSubcategory: null,
			consulteeSubcategoryDescription: null,
			consultee: 'East of England Ambulance Service',
			region: 'East of England',
			metadata: { CODE: 'EE_AMB_SERV', NAME: 'East of England Ambulance Service' }
		});
		// derived from the export's id, so a re-import keeps each row's id
		assert.equal(feature.id, deterministicId('consultee-area:health_AMB_EW_00001'));
	});

	test("maps the camelCase sample, whose ids name no dataset, by the file's own category", () => {
		const feature = toConsulteeArea({
			geometry: { type: 'Point', coordinates: [0, 0] },
			properties: {
				id: 'E23000001',
				consultee: 'Example Trust',
				consulteeCategory: 'Ambulance Trust',
				caseId: 'EN010001',
				currentVersion: 2,
				metadata: { layer: 'ambulance' }
			}
		});

		assert.deepEqual(feature.properties, {
			sourceId: 'E23000001',
			consulteeCategory: 'Ambulance Trust',
			consulteeGroup: null,
			consulteeSubcategory: null,
			consulteeSubcategoryDescription: null,
			consultee: 'Example Trust',
			region: null,
			metadata: { layer: 'ambulance' }
		});
	});

	test("takes the export's subcategory and its description, a blank one as none", () => {
		const feature = toConsulteeArea({
			geometry: { type: 'Point', coordinates: [0, 0] },
			properties: {
				id: 'transport_DKH_WE_00001',
				consultee_category: 'Transport',
				consultee_subcategory: ' Municipal ',
				consultee_subcategory_description: 'Port or harbour run by a local authority'
			}
		});
		assert.equal(feature.properties.consulteeSubcategory, 'Municipal');
		assert.equal(feature.properties.consulteeSubcategoryDescription, 'Port or harbour run by a local authority');

		const blank = toConsulteeArea({
			geometry: { type: 'Point', coordinates: [0, 0] },
			properties: { id: 'src-1', consulteeSubcategory: '  ', consulteeSubcategoryDescription: 'Sample' }
		});
		assert.equal(blank.properties.consulteeSubcategory, null);
		assert.equal(blank.properties.consulteeSubcategoryDescription, 'Sample');
	});

	test('keeps metadata that is not a JSON object whole, as rawMetadata', () => {
		const feature = toConsulteeArea({
			geometry: { type: 'Point', coordinates: [1, 2] },
			properties: { id: 42, consultee_category: 'Railway', metadata: "{'source': 'python-dict-repr'}" }
		});

		assert.equal(feature.properties.sourceId, '42');
		assert.equal(feature.properties.consulteeCategory, 'Railway');
		assert.deepEqual(feature.properties.metadata, { rawMetadata: "{'source': 'python-dict-repr'}" });
	});

	test('maps a feature with no id, category or metadata to nulls', () => {
		const feature = toConsulteeArea({ geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} });

		assert.deepEqual(feature.properties, {
			sourceId: null,
			consulteeCategory: null,
			consulteeGroup: null,
			consulteeSubcategory: null,
			consulteeSubcategoryDescription: null,
			consultee: null,
			region: null,
			metadata: {}
		});
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

describe('importConsulteeAreas', () => {
	// the loaders write with $executeRaw MERGE batches, so a stand-in client whose $executeRaw
	// resolves exercises the whole read-file -> map -> clear -> load path without a real database
	function loadingClient() {
		const $executeRaw = mock.fn(async () => 1);
		return { client: { $executeRaw } as unknown as PrismaClient, $executeRaw };
	}
	const sql = (call: { arguments: unknown[] }) => (call.arguments[0] as TemplateStringsArray).join('?');
	const point = (properties: Record<string, unknown>) => ({
		geometry: { type: 'Point', coordinates: [0, 0] },
		properties
	});

	test('replaces the whole table with the file, clearing it once the file has been read', async () => {
		const { client, $executeRaw } = loadingClient();
		const file = {
			type: 'FeatureCollection',
			features: [point({ id: 'health_AMB_EW_00001', consultee_category: 'Health' })]
		};
		await withFile(JSON.stringify(file), async (filePath) => {
			assert.equal(await importConsulteeAreas(client, filePath), 1);
		});
		// one batch delete of every row that comes back short, then one MERGE batch
		assert.equal($executeRaw.mock.callCount(), 2);
		assert.match(sql($executeRaw.mock.calls[0]), /^DELETE TOP \(\?\) FROM consultee_area$/);
		assert.match(sql($executeRaw.mock.calls[1]), /MERGE INTO consultee_area/);
	});

	test('refuses to clear the table for a file with no features', async () => {
		const { client, $executeRaw } = deletingClient([]);
		await withFile(JSON.stringify({ type: 'FeatureCollection', features: [] }), async (filePath) => {
			await assert.rejects(
				() => importConsulteeAreas(client, filePath),
				/Refusing to replace consultee-areas with a file holding no features/
			);
		});
		assert.equal($executeRaw.mock.callCount(), 0);
	});

	test('does not clear anything when the file does not parse', async () => {
		const { client, $executeRaw } = deletingClient([]);
		await withFile('{ not json', async (filePath) => {
			await assert.rejects(() => importConsulteeAreas(client, filePath));
		});
		assert.equal($executeRaw.mock.callCount(), 0);
	});

	test("changes nothing for a file holding a dataset the config doesn't list", async () => {
		const { client, $executeRaw } = loadingClient();
		const file = {
			type: 'FeatureCollection',
			features: [point({ id: 'other_HOS_EW_00001', consultee_category: 'Other' })]
		};
		await withFile(JSON.stringify(file), async (filePath) => {
			await assert.rejects(() => importConsulteeAreas(client, filePath), /dataset HOS_EW/);
		});
		assert.equal($executeRaw.mock.callCount(), 0);
	});

	test('loads a chunk of the file at a time, reporting progress across them', async () => {
		const { client, $executeRaw } = loadingClient();
		const features = ['a', 'b', 'c'].map((id) => point({ id, consultee: id, consulteeCategory: 'Ambulance Trust' }));
		const progress: [number, number][] = [];
		await withFile(JSON.stringify({ type: 'FeatureCollection', features }), async (filePath) => {
			const imported = await importConsulteeAreas(client, filePath, {
				// two features' worth: a, b, then c
				chunkCharacters: JSON.stringify(features[0]).length * 2 + 2,
				onProgress: (loaded, total) => progress.push([loaded, total])
			});
			assert.equal(imported, 3);
		});
		// the delete, then one MERGE per chunk
		assert.equal($executeRaw.mock.callCount(), 3);
		assert.deepEqual(progress, [
			[2, 3],
			[3, 3]
		]);
	});

	test('loads a feature larger than a chunk on its own', async () => {
		const { client, $executeRaw } = loadingClient();
		const features = ['a', 'b'].map((id) => point({ id, consulteeCategory: 'Ambulance Trust' }));
		await withFile(JSON.stringify({ type: 'FeatureCollection', features }), async (filePath) => {
			assert.equal(await importConsulteeAreas(client, filePath, { chunkCharacters: 1 }), 2);
		});
		assert.equal($executeRaw.mock.callCount(), 3);
	});
});

describe('importCaseBoundaries', () => {
	function loadingClient() {
		const $executeRaw = mock.fn(async () => 1);
		return { client: { $executeRaw } as unknown as PrismaClient, $executeRaw };
	}
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

	test('merges the file rows into case_boundary', async () => {
		const { client, $executeRaw } = loadingClient();
		await withFile(JSON.stringify(file), async (filePath) => {
			assert.equal(await importCaseBoundaries(client, filePath), 1);
		});
		assert.equal($executeRaw.mock.callCount(), 1);
	});

	test('replaces case_boundary with the file when asked to', async () => {
		const { client, $executeRaw } = loadingClient();
		await withFile(JSON.stringify(file), async (filePath) => {
			assert.equal(await importCaseBoundaries(client, filePath, { replace: true }), 1);
		});
		assert.equal($executeRaw.mock.callCount(), 2);
		assert.match(($executeRaw.mock.calls[0].arguments[0] as TemplateStringsArray).join('?'), /FROM case_boundary/);
	});
});
