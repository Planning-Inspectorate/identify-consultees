import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
	BOUNDARY_MAP_STYLES,
	parseBoundaryMapStyles,
	recencyRanks,
	styleForRank,
	toDatasetStyle
} from './boundary-map-styles.ts';

const VALID = `
version: 1
mostRecent: { colour: '#C44E52', fillOpacity: 0.45, strokeWidth: 3, description: red }
earlier:
  - { colour: '#1d70b8', fillOpacity: 0.15, strokeWidth: 2, strokeDash: [4, 2], description: blue dashed }
  - { colour: '#f47738', fillOpacity: 0.15, strokeWidth: 2, description: orange }
`;

describe('boundary map styles', () => {
	it('loads the shipped config/map-styles/boundary-map.yaml, with the most recent file red', () => {
		assert.strictEqual(BOUNDARY_MAP_STYLES.mostRecent.colour, '#C44E52');
		assert.ok(BOUNDARY_MAP_STYLES.earlier.length > 0);
		const colours = [BOUNDARY_MAP_STYLES.mostRecent, ...BOUNDARY_MAP_STYLES.earlier].map((style) => style.colour);
		assert.strictEqual(new Set(colours).size, colours.length, 'every file style should be a different colour');
	});

	it('parses each style, keeping a dash pattern only where one is given', () => {
		const styles = parseBoundaryMapStyles(VALID);
		assert.deepStrictEqual(styles.mostRecent, {
			colour: '#C44E52',
			fillOpacity: 0.45,
			strokeWidth: 3,
			description: 'red'
		});
		assert.deepStrictEqual(styles.earlier[0].strokeDash, [4, 2]);
		assert.strictEqual(styles.earlier[1].strokeDash, undefined);
	});

	const invalid: [string, string, RegExp][] = [
		['an empty file', '', /version 1 document/],
		['not a document', 'just text', /version 1 document/],
		['the wrong version', VALID.replace('version: 1', 'version: 2'), /version 1 document/],
		['no earlier styles', VALID.replace(/earlier:[\s\S]*/, 'earlier: []'), /at least one style/],
		['a style that is not an object', VALID.replace(/mostRecent: .*/, 'mostRecent: red'), /mostRecent must be a style/],
		['a named colour', VALID.replace("'#C44E52'", 'red'), /mostRecent\.colour/],
		['an opacity above 1', VALID.replace('fillOpacity: 0.45', 'fillOpacity: 45'), /mostRecent\.fillOpacity/],
		['a zero stroke width', VALID.replace('strokeWidth: 3', 'strokeWidth: 0'), /mostRecent\.strokeWidth/],
		['a three-part dash', VALID.replace('[4, 2]', '[4, 2, 1]'), /earlier\[0\]\.strokeDash/],
		['a negative dash', VALID.replace('[4, 2]', '[4, -2]'), /earlier\[0\]\.strokeDash/],
		['a missing description', VALID.replace(', description: orange', ''), /earlier\[1\]\.description/]
	];
	for (const [name, text, error] of invalid) {
		it(`rejects ${name}`, () => {
			assert.throws(() => parseBoundaryMapStyles(text), error);
		});
	}

	it('ranks files newest first, with undated files oldest and ties in order', () => {
		const dates = [
			new Date('2026-01-01'),
			null,
			new Date('2026-05-01'),
			new Date('2026-01-01'),
			new Date('2025-06-01')
		];
		assert.deepStrictEqual(recencyRanks(dates), [1, 4, 0, 2, 3]);
		assert.deepStrictEqual(recencyRanks([]), []);
	});

	it('gives the most recent file its style and repeats the earlier list as needed', () => {
		const styles = parseBoundaryMapStyles(VALID);
		assert.strictEqual(styleForRank(0, styles).colour, '#C44E52');
		assert.strictEqual(styleForRank(1, styles).colour, '#1d70b8');
		assert.strictEqual(styleForRank(2, styles).colour, '#f47738');
		assert.strictEqual(styleForRank(3, styles).colour, '#1d70b8');
		assert.strictEqual(styleForRank(0).colour, BOUNDARY_MAP_STYLES.mostRecent.colour);
	});

	it('turns a style into the map plugin style, with the opacity in the fill colour', () => {
		const [dashed, solid] = parseBoundaryMapStyles(VALID).earlier;
		assert.deepStrictEqual(toDatasetStyle(dashed), {
			stroke: '#1d70b8',
			strokeWidth: 2,
			strokeDashArray: [4, 2],
			fill: 'rgba(29, 112, 184, 0.15)',
			symbolDescription: 'blue dashed'
		});
		assert.strictEqual(toDatasetStyle(solid).strokeDashArray, undefined);
	});
});
