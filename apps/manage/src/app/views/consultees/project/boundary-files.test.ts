import assert from 'node:assert';
import { describe, it } from 'node:test';
import { boundaryFileOptions } from './boundary-files.ts';

function file(id: string, fileName: string | null = null, receivedDate: Date | null = null) {
	return { id, fileName, receivedDate };
}

describe('boundaryFileOptions', () => {
	it('should map the stored files to options with the current one checked', () => {
		const received = new Date('2026-09-19T00:00:00Z');
		const files = [file('a', 'first.geojson', received), file('b', 'second.geojson')];
		assert.deepStrictEqual(boundaryFileOptions(files, 'b'), [
			{ id: 'a', label: 'first.geojson', receivedDate: received, checked: false },
			{ id: 'b', label: 'second.geojson', receivedDate: null, checked: true }
		]);
	});

	it('should check the first file when the current id is not among them', () => {
		const options = boundaryFileOptions([file('a'), file('b')], 'zzz');
		assert.strictEqual(options[0].checked, true);
	});

	it('should list only the stored file when a case has one', () => {
		assert.deepStrictEqual(
			boundaryFileOptions([file('a', 'real.geojson')], 'a').map((option) => option.id),
			['a']
		);
	});

	it('should return no options when there are no files', () => {
		assert.deepStrictEqual(boundaryFileOptions([], 'a'), []);
	});

	it('should fall back to a name when a file has none', () => {
		const options = boundaryFileOptions([file('a', null), file('b')], 'a');
		assert.strictEqual(options[0].label, 'Unnamed file');
	});
});
