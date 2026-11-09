import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { adminNavigation, adminPages } from './navigation.ts';

const currentOf = (path: string) =>
	adminNavigation(path, adminPages(true))
		.filter((item) => item.current)
		.map((item) => item.text);

describe('admin navigation', () => {
	test('lists every admin page, Overview first', () => {
		assert.deepEqual(
			adminNavigation('/admin', adminPages(true)).map((item) => item.text),
			['Overview', 'Database', 'Reference data files', 'Load into database']
		);
	});

	test('has no files page, and only Reference data, where the reference data cannot be changed', () => {
		assert.deepEqual(
			adminNavigation('/admin/import-reference-data', adminPages(false)).map((item) => [item.text, item.current]),
			[
				['Overview', false],
				['Database', false],
				['Reference data', true]
			]
		);
	});

	test('marks the page a path is for, or one beneath it', () => {
		assert.deepEqual(currentOf('/admin'), ['Overview']);
		assert.deepEqual(currentOf('/admin/'), ['Overview']);
		assert.deepEqual(currentOf('/admin/database'), ['Database']);
		assert.deepEqual(currentOf('/admin/database/consultee-areas/abc'), ['Database']);
		assert.deepEqual(currentOf('/admin/upload-to-blob/run'), ['Reference data files']);
		// a page whose name starts like another's isn't it
		assert.deepEqual(currentOf('/admin/databases'), []);
		assert.deepEqual(currentOf('/'), []);
	});
});
