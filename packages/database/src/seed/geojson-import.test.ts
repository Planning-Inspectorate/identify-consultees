import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, mock, test } from 'node:test';
import type { PrismaClient } from '../client/client.ts';
import {
	clearExistingRows,
	deterministicId,
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

describe('importConsulteeAreas with replace', () => {
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
