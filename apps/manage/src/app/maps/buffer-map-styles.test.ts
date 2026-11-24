import assert from 'node:assert';
import { describe, it } from 'node:test';
import { parseConsulteeMapStyles, toBufferDatasetStyle } from './buffer-map-styles.ts';

const VALID = {
	version: 1,
	bufferStyles: [
		{ colour: '#C44E52', strokeWidth: 2, strokeDash: [], description: 'red solid' },
		{ colour: '#1d70b8', strokeWidth: 1.5, strokeDash: [4, 2], description: 'blue dashed' }
	]
};

describe('consultee map styles', () => {
	it('parses each buffer style with its dash pattern', () => {
		const styles = parseConsulteeMapStyles(VALID, 'test/file/path.yaml');
		assert.deepStrictEqual(styles.buffers, [
			{
				colour: '#C44E52',
				strokeWidth: 2,
				strokeDash: [],
				description: 'red solid'
			},
			{
				colour: '#1d70b8',
				strokeWidth: 1.5,
				strokeDash: [4, 2],
				description: 'blue dashed'
			}
		]);
	});

	const invalid: [string, Record<string, unknown>, RegExp][] = [
		['no buffer styles', { ...VALID, bufferStyles: [] }, /at least one style/],
		['bufferStyles that is not an array', { ...VALID, bufferStyles: 'red' }, /at least one style/],
		['a style that is not an object', { ...VALID, bufferStyles: ['red'] }, /bufferStyles must be a style/],
		[
			'a named colour',
			{ ...VALID, bufferStyles: [{ ...VALID.bufferStyles[0], colour: 'red' }] },
			/bufferStyles\.colour/
		],
		[
			'a negative stroke width',
			{ ...VALID, bufferStyles: [{ ...VALID.bufferStyles[0], strokeWidth: -1 }] },
			/bufferStyles\.strokeWidth/
		],
		[
			'a stroke width above 2',
			{ ...VALID, bufferStyles: [{ ...VALID.bufferStyles[0], strokeWidth: 2.5 }] },
			/bufferStyles\.strokeWidth/
		],
		[
			'a non-array stroke dash',
			{ ...VALID, bufferStyles: [{ ...VALID.bufferStyles[0], strokeDash: '4, 2' }] },
			/bufferStyles\.strokeDash/
		],
		[
			'a non-numeric stroke dash',
			{ ...VALID, bufferStyles: [{ ...VALID.bufferStyles[0], strokeDash: [4, '2'] }] },
			/bufferStyles\.strokeDash/
		],
		[
			'a missing description',
			{ ...VALID, bufferStyles: [{ colour: '#C44E52', strokeWidth: 2, strokeDash: [] }] },
			/bufferStyles\.description/
		],
		[
			'a blank description',
			{ ...VALID, bufferStyles: [{ ...VALID.bufferStyles[0], description: '   ' }] },
			/bufferStyles\.description/
		],
		[
			'a misspelt style setting',
			{ ...VALID, bufferStyles: [{ ...VALID.bufferStyles[0], strokedash: [1, 1] }] },
			/bufferStyles has "strokedash" - it can only have colour, strokeWidth, strokeDash, description/
		],
		[
			'a misspelt top-level setting',
			{ ...VALID, latest: {} },
			/the document has "latest" - it can only have version, bufferStyles/
		]
	];
	for (const [name, document, error] of invalid) {
		it(`rejects ${name}`, () => {
			assert.throws(() => {
				parseConsulteeMapStyles(document, 'test.yaml');
			}, error);
		});
	}

	it('turns a buffer style into the map plugin style', () => {
		const [solid, dashed] = parseConsulteeMapStyles(VALID, 'test/file/path.yaml').buffers;
		assert.deepStrictEqual(toBufferDatasetStyle(dashed), {
			stroke: '#1d70b8',
			strokeWidth: 1.5,
			strokeDashArray: [4, 2],
			symbolDescription: 'blue dashed'
		});
		assert.deepStrictEqual(toBufferDatasetStyle(solid), {
			stroke: '#C44E52',
			strokeWidth: 2,
			strokeDashArray: [],
			symbolDescription: 'red solid'
		});
	});
});
