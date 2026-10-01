import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { deterministicId, toCaseBoundary, toConsulteeArea } from './geojson-import.ts';

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
