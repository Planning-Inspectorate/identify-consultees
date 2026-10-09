import assert from 'node:assert';
import { describe, it } from 'node:test';
import { boundaryFileOptions, scaledGeometry } from './boundary-files.ts';

function file(id: string, fileName: string | null = null, receivedDate: Date | null = null) {
	return { id, fileName, receivedDate };
}

describe('boundaryFileOptions', () => {
	it('should map the stored files to options with the current one checked', () => {
		const files = [file('a', 'first.geojson'), file('b', 'second.geojson')];
		const options = boundaryFileOptions(files, 'b', 'Test Project');
		assert.deepStrictEqual(
			options.map(({ id, label, targetId, checked, mock }) => ({ id, label, targetId, checked, mock })),
			[
				{ id: 'a', label: 'first.geojson', targetId: 'a', checked: false, mock: false },
				{ id: 'b', label: 'second.geojson', targetId: 'b', checked: true, mock: false }
			]
		);
	});

	it('should check the first file when the current id is not among them', () => {
		const options = boundaryFileOptions([file('a'), file('b')], 'zzz', 'Test Project');
		assert.strictEqual(options[0].checked, true);
	});

	it('should add an unchecked stand-in file when a case has only one, pointed at the real boundary', () => {
		const options = boundaryFileOptions(
			[file('a', 'real.geojson', new Date('2026-09-19T00:00:00Z'))],
			'a',
			'Longfield Solar Farm'
		);
		assert.strictEqual(options.length, 2);
		const standIn = options[1];
		assert.strictEqual(standIn.mock, true);
		assert.strictEqual(standIn.checked, false);
		// submit resolves the stand-in back to the real boundary's id
		assert.strictEqual(standIn.targetId, 'a');
		assert.strictEqual(standIn.id, 'a:placeholder');
		assert.strictEqual(standIn.label, 'Longfield-solar-farm-shapefile.geojson');
		// its upload hint sits a few weeks before the real file's, like an earlier submission
		assert.ok(standIn.receivedDate);
		assert.ok(standIn.receivedDate.getTime() < new Date('2026-09-19T00:00:00Z').getTime());
	});

	it('should leave the stand-in without a date when the real file has none', () => {
		const options = boundaryFileOptions([file('a', 'real.geojson')], 'a', 'Test Project');
		assert.strictEqual(options[1].receivedDate, null);
	});

	it('should not add a stand-in when the case already has two files', () => {
		const options = boundaryFileOptions([file('a'), file('b')], 'a', 'Test Project');
		assert.strictEqual(options.length, 2);
		assert.ok(options.every((option) => !option.mock));
	});

	it('should fall back to a name when a file has none', () => {
		const options = boundaryFileOptions([file('a', null), file('b')], 'a', 'Test Project');
		assert.strictEqual(options[0].label, 'Unnamed file');
	});
});

describe('scaledGeometry', () => {
	it('should shrink positions toward their mean centre', () => {
		// a square centred on (0, 0) shrinks to a smaller square on the same centre
		const square = {
			type: 'Polygon' as const,
			coordinates: [
				[
					[-1, -1],
					[1, -1],
					[1, 1],
					[-1, 1],
					[-1, -1]
				]
			]
		};
		const scaled = scaledGeometry(square, 0.5);
		assert.deepStrictEqual(scaled, {
			type: 'Polygon',
			coordinates: [
				[
					[-0.5, -0.5],
					[0.5, -0.5],
					[0.5, 0.5],
					[-0.5, 0.5],
					[-0.5, -0.5]
				]
			]
		});
	});

	it('should scale every member of a multi geometry', () => {
		const scaled = scaledGeometry(
			{
				type: 'MultiPoint' as const,
				coordinates: [
					[0, 0],
					[2, 0]
				]
			},
			0.5
		);
		assert.deepStrictEqual(scaled, {
			type: 'MultiPoint',
			coordinates: [
				[0.5, 0],
				[1.5, 0]
			]
		});
	});

	it('should scale each member of a geometry collection, leaving nested collections alone', () => {
		const scaled = scaledGeometry(
			{
				type: 'GeometryCollection' as const,
				geometries: [
					{ type: 'Point' as const, coordinates: [0, 0] },
					{ type: 'Point' as const, coordinates: [2, 0] },
					{ type: 'GeometryCollection' as const, geometries: [] }
				]
			},
			0.5
		);
		assert.deepStrictEqual(scaled, {
			type: 'GeometryCollection',
			geometries: [
				{ type: 'Point', coordinates: [0.5, 0] },
				{ type: 'Point', coordinates: [1.5, 0] },
				{ type: 'GeometryCollection', geometries: [] }
			]
		});
	});

	it('should ignore stray numbers inside coordinate arrays', () => {
		// a truncated coordinate ([5] is not a position) is left as-is rather than scaled
		const scaled = scaledGeometry(
			{
				type: 'MultiPoint' as const,
				coordinates: [[0, 0], [2, 0], [5]]
			},
			0.5
		);
		assert.deepStrictEqual(scaled, {
			type: 'MultiPoint',
			coordinates: [[0.5, 0], [1.5, 0], [5]]
		});
	});

	it('should return the geometry unchanged when it has no positions', () => {
		const empty = { type: 'GeometryCollection' as const, geometries: [] };
		assert.strictEqual(scaledGeometry(empty), empty);
	});
});
