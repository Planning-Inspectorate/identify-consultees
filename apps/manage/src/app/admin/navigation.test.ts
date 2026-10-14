import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ADMIN_PAGES, adminNavigation } from './navigation.ts';

const currentOf = (path: string) =>
	adminNavigation(path)
		.filter((item) => item.current)
		.map((item) => item.text);

describe('admin navigation', () => {
	test('lists every admin page, Overview first', () => {
		assert.deepEqual(
			adminNavigation('/admin').map((item) => item.href),
			ADMIN_PAGES.map((page) => page.href)
		);
		assert.equal(ADMIN_PAGES[0].text, 'Overview');
	});

	test('marks the page a path is for, or one beneath it', () => {
		assert.deepEqual(currentOf('/admin'), ['Overview']);
		assert.deepEqual(currentOf('/admin/'), ['Overview']);
		assert.deepEqual(currentOf('/admin/database'), ['Database']);
		assert.deepEqual(currentOf('/admin/database/consultee-areas/abc'), ['Database']);
		assert.deepEqual(currentOf('/admin/upload-to-blob/run'), ['Upload to blob storage']);
		// a page whose name starts like another's isn't it
		assert.deepEqual(currentOf('/admin/databases'), []);
		assert.deepEqual(currentOf('/'), []);
	});
});
