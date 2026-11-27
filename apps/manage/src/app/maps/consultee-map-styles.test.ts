import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
	assignCategoryColours,
	colourFor,
	CONSULTEE_MAP_STYLES,
	parseConsulteeMapStyles
} from './consultee-map-styles.ts';

const VALID = {
	version: 1,
	projectSite: { colour: '#ff0000', description: 'red' },
	consulteeCategoryStyles: [
		{ colour: '#1d70b8', description: 'blue' },
		{ colour: '#f47738', description: 'orange' }
	],
	manuallyAddedCategoryStyles: [
		{ colour: '#003078', description: 'dark blue' },
		{ colour: '#552A14', description: 'dark orange' }
	],
	authorityRoles: {
		host: { colour: '#007a7a', description: 'teal' },
		bordering: { colour: '#f47738', description: 'orange' }
	}
};

describe('consultee map styles', () => {
	it('loads the shipped config/map-styles/consultee-map.yaml, authorityStyles host and its neighbours in different colours', () => {
		assert.strictEqual(CONSULTEE_MAP_STYLES.authorityStyles.host.colour, '#007a7a');
		assert.notStrictEqual(
			CONSULTEE_MAP_STYLES.authorityStyles.bordering.colour,
			CONSULTEE_MAP_STYLES.authorityStyles.host.colour
		);
	});

	for (const [problem, text, message] of [
		[
			'consulteeCategoryStyles that is not an array',
			{ ...VALID, consulteeCategoryStyles: 'red' },
			/at least one style/
		],
		[
			'manuallyAddedCategoryStyles that is not an array',
			{ ...VALID, manuallyAddedCategoryStyles: 'red' },
			/at least one style/
		],
		[
			'manuallyAddedCategoryStyles that is not a style',
			{ ...VALID, manuallyAddedCategoryStyles: ['red'] },
			/must be a style/
		],
		[
			"manuallyAddedCategoryStyles that doesn't contain host or bordering",
			{ ...VALID, authorityRoles: {} },
			/must be an Object with keys 'host' and 'bordering'/
		],
		['consulteeCategoryStyles that is not a style', { ...VALID, consulteeCategoryStyles: ['red'] }, /must be a style/],
		[
			'manuallyAddedCategoryStyles that is not a style',
			{ ...VALID, manuallyAddedCategoryStyles: ['red'] },
			/must be a style/
		],
		[
			'incorrect style hex',
			{ ...VALID, manuallyAddedCategoryStyles: [{ colour: 'broken' }] },
			/must be a 6-digit hex colour string/
		],
		[
			'incorrect style hex',
			{ ...VALID, manuallyAddedCategoryStyles: [{ colour: '#123456', description: 1 }] },
			/must describe the style in words/
		],
		['incorrect style type', { ...VALID, manuallyAddedCategoryStyles: { colour: 2 } }, /must list at least one style/],
		['a misspelt top-level setting', { ...VALID, latest: {} }, /the document has "latest"/],
		['a misspelt top-level setting', { ...VALID, latest: {} }, /the document has "latest"/],
		[
			'the same colour twice',
			{
				...VALID,
				authorityRoles: {
					host: { colour: '#007a7a', description: 'teal' },
					bordering: { colour: '#007a7a', description: 'orange' }
				}
			},
			/must contain a host and border with different colours/
		]
	] as const) {
		it(`refuses ${problem}`, () => {
			assert.throws(() => parseConsulteeMapStyles(text, 'test/file.yaml'), message);
		});
	}
});

describe('assignCategoryColours', () => {
	it('colours priority categories first, then the rest, each once and in order', () => {
		const colours = assignCategoryColours(
			[
				'Police and crime commissioners',
				'Hospitals operated by NHS trusts and NHS foundation trusts (England)',
				'Police and crime commissioners'
			],
			['Ambulance trusts', 'Hospitals operated by NHS trusts and NHS foundation trusts (England)']
		);
		assert.deepStrictEqual(
			[...colours],
			[
				[
					'Hospitals operated by NHS trusts and NHS foundation trusts (England)',
					{
						addedByHand: CONSULTEE_MAP_STYLES.manuallyAddedCategoryStyles[0].colour,
						base: CONSULTEE_MAP_STYLES.consulteeCategoryStyles[0].colour
					}
				],
				[
					'Police and crime commissioners',
					{
						addedByHand: CONSULTEE_MAP_STYLES.manuallyAddedCategoryStyles[1].colour,
						base: CONSULTEE_MAP_STYLES.consulteeCategoryStyles[1].colour
					}
				],
				[
					'Ambulance trusts',
					{
						addedByHand: CONSULTEE_MAP_STYLES.manuallyAddedCategoryStyles[0].colour,
						base: CONSULTEE_MAP_STYLES.consulteeCategoryStyles[0].colour
					}
				]
			]
		);
	});

	it('cycles past the end of the palette', () => {
		const categories = Array.from(
			{ length: CONSULTEE_MAP_STYLES.consulteeCategoryStyles.length + 1 },
			(_, i) => `Category ${String(i).padStart(2, '0')}`
		);
		const colours = assignCategoryColours(categories);
		assert.deepStrictEqual(colours.get(categories.at(-1) ?? ''), {
			addedByHand: CONSULTEE_MAP_STYLES.manuallyAddedCategoryStyles[0].colour,
			base: CONSULTEE_MAP_STYLES.consulteeCategoryStyles[0].colour
		});
	});

	it('falls back to the first colour for a category it was not given', () => {
		assert.strictEqual(
			colourFor(
				assignCategoryColours([
					'Police and crime commissioners',
					'Hospitals operated by NHS trusts and NHS foundation trusts (England)'
				]),
				'Police and crime commissioners',
				undefined,
				false
			),
			CONSULTEE_MAP_STYLES.consulteeCategoryStyles[1].colour
		);
		assert.strictEqual(
			colourFor(new Map(), 'Police and crime commissioners', undefined, false),
			CONSULTEE_MAP_STYLES.consulteeCategoryStyles[0].colour
		);
	});

	it('uses authority role colours if provided', () => {
		assert.strictEqual(
			colourFor(
				assignCategoryColours(['Police and crime commissioners']),
				'Police and crime commissioners',
				'host',
				false
			),
			CONSULTEE_MAP_STYLES.authorityStyles.host.colour
		);

		assert.strictEqual(
			colourFor(
				assignCategoryColours(['Police and crime commissioners']),
				'Police and crime commissioners',
				'bordering',
				false
			),
			CONSULTEE_MAP_STYLES.authorityStyles.bordering.colour
		);
	});
});
