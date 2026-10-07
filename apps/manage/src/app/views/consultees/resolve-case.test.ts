import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';
import { resolveCase, resolveCaseSummary } from './resolve-case.ts';

const validId = '44444444-4444-4444-4444-444444444444';

describe('resolveCase', () => {
	test('rejects non-UUID case ids without querying the database', async () => {
		const db = { $queryRaw: mock.fn(async () => []) };
		const result = await resolveCase(db, 'geo-1');
		assert.equal(result, undefined);
		assert.equal(db.$queryRaw.mock.callCount(), 0);
	});

	test('rejects SQL-injection-shaped ids without querying the database', async () => {
		const db = { $queryRaw: mock.fn(async () => []) };
		const result = await resolveCase(db, "'; DROP TABLE case_boundary; --");
		assert.equal(result, undefined);
		assert.equal(db.$queryRaw.mock.callCount(), 0);
	});

	test('returns the feature when a well-formed id matches a row', async () => {
		const db = {
			$queryRaw: mock.fn(async () => [
				{
					id: validId,
					geometryType: 'Point',
					caseReference: 'EN010099',
					caseName: 'Example',
					fileName: null,
					receivedDate: null,
					acceptance: null,
					metadata: '{}',
					geometryWkt: 'POINT(0 0)'
				}
			])
		};
		const result = await resolveCase(db, validId);
		assert.ok(result);
		assert.equal(result.id, validId);
		assert.equal(result.properties.caseReference, 'EN010099');
		assert.equal(db.$queryRaw.mock.callCount(), 1);
	});

	test('returns undefined when a well-formed id matches no row', async () => {
		const db = { $queryRaw: mock.fn(async () => []) };
		const result = await resolveCase(db, validId);
		assert.equal(result, undefined);
		assert.equal(db.$queryRaw.mock.callCount(), 1);
	});
});

describe('resolveCaseSummary', () => {
	test('rejects non-UUID case ids without querying the database', async () => {
		const db = { $queryRaw: mock.fn(async () => []) };
		const result = await resolveCaseSummary(db, '../etc/passwd');
		assert.equal(result, undefined);
		assert.equal(db.$queryRaw.mock.callCount(), 0);
	});

	test('returns a geometry-free summary for a matching id', async () => {
		const db = {
			$queryRaw: mock.fn(async () => [
				{
					id: validId,
					caseReference: 'EN010099',
					caseName: 'Example',
					receivedDate: null,
					acceptance: null
				}
			])
		};
		const result = await resolveCaseSummary(db, validId);
		assert.deepEqual(result, {
			id: validId,
			reference: 'EN010099',
			caseName: 'Example',
			receivedDate: null,
			acceptance: null
		});
		assert.equal(db.$queryRaw.mock.callCount(), 1);
	});

	test('returns undefined when a well-formed id matches no row', async () => {
		const db = { $queryRaw: mock.fn(async () => []) };
		const result = await resolveCaseSummary(db, validId);
		assert.equal(result, undefined);
		assert.equal(db.$queryRaw.mock.callCount(), 1);
	});
});
