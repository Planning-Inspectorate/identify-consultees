import assert from 'node:assert';
import { describe, it } from 'node:test';
import { assignCategoryColours, colourFor, CONSULTEE_CATEGORY_COLOURS } from './category-colours.ts';

describe('assignCategoryColours', () => {
	it('colours priority categories first, then the rest, each once and in order', () => {
		const colours = assignCategoryColours(['Police', 'Hospital', 'Police'], ['Ambulance Trust', 'Hospital']);
		assert.deepStrictEqual(
			[...colours],
			[
				['Hospital', CONSULTEE_CATEGORY_COLOURS[0]],
				['Police', CONSULTEE_CATEGORY_COLOURS[1]],
				['Ambulance Trust', CONSULTEE_CATEGORY_COLOURS[2]]
			]
		);
	});

	it('cycles past the end of the palette', () => {
		const categories = Array.from(
			{ length: CONSULTEE_CATEGORY_COLOURS.length + 1 },
			(_, i) => `Category ${String(i).padStart(2, '0')}`
		);
		const colours = assignCategoryColours(categories);
		assert.strictEqual(colours.get(categories.at(-1) ?? ''), CONSULTEE_CATEGORY_COLOURS[0]);
	});

	it('falls back to the first colour for a category it was not given', () => {
		assert.strictEqual(
			colourFor(assignCategoryColours(['Police', 'Hospital']), 'Police'),
			CONSULTEE_CATEGORY_COLOURS[1]
		);
		assert.strictEqual(colourFor(new Map(), 'Police'), CONSULTEE_CATEGORY_COLOURS[0]);
	});
});
