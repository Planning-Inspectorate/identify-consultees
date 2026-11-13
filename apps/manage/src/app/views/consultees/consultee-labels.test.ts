import type { ConsulteeAreaDetail } from '@pins/identify-consultees-database/src/geospatial/consultee-areas.ts';
import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
	distinguishedLabels,
	distinguishingDetail,
	kilometresFromSite,
	labelVariants,
	nameBeforeLabel
} from './consultee-labels.ts';

const detail = (overrides: Partial<ConsulteeAreaDetail> = {}): ConsulteeAreaDetail => ({
	region: null,
	subcategory: null,
	metadata: '{}',
	authority: null,
	...overrides
});

describe('consultee labels', () => {
	it('gives a distance to a tenth of a kilometre, and an approximate one as "about", to the kilometre from 10km', () => {
		assert.strictEqual(kilometresFromSite(3_249), '3.2 km from the site');
		assert.strictEqual(kilometresFromSite(3_249, true), 'about 3.2 km from the site');
		assert.strictEqual(kilometresFromSite(40_400, true), 'about 40 km from the site');
		assert.strictEqual(kilometresFromSite(40_400), '40.4 km from the site');
	});

	it('offers an approximate distance back as the label gave it', () => {
		assert.deepStrictEqual(
			labelVariants({ id: 'a', name: 'Middleton', distanceMetres: 40_400, approximate: true }, 'North Yorkshire'),
			[
				'Middleton (North Yorkshire)',
				'Middleton (North Yorkshire, about 40 km from the site)',
				'Middleton (about 40 km from the site)'
			]
		);
	});

	it("tells a consultee apart by its category's detail: council area, operator and technology, else region", () => {
		assert.strictEqual(
			distinguishingDetail(
				'Parish, town and community councils',
				detail({ authority: 'Lancaster', region: 'North West' })
			),
			'Lancaster'
		);
		assert.strictEqual(
			distinguishingDetail(
				'Electricity generators with compulsory purchase order powers',
				detail({ metadata: JSON.stringify({ COMPANY_NAME: ' Intergen ', PRIMARY_TYPE: 'Wind' }), region: 'Scotland' })
			),
			'Intergen, Wind'
		);
		// a generator with neither, or metadata that isn't an object or isn't JSON - its region
		for (const metadata of ['{}', '"text"', 'not json']) {
			assert.strictEqual(
				distinguishingDetail(
					'Electricity generators with compulsory purchase order powers',
					detail({ metadata, region: 'Wales' })
				),
				'Wales'
			);
		}
		assert.strictEqual(
			distinguishingDetail(
				'Electricity distributors with compulsory purchase order powers',
				detail({ region: 'London', subcategory: 'Electricity distributors with compulsory purchase order powers' })
			),
			'London'
		);
		assert.strictEqual(distinguishingDetail('Railways', detail({ region: ' ', subcategory: 'Active' })), 'Active');
		assert.strictEqual(distinguishingDetail('Railways', detail()), undefined);
		assert.strictEqual(distinguishingDetail('Railways', undefined), undefined);
	});

	it('labels only names that repeat - in the list, or among those already listed - adding the distance where still needed', () => {
		const details = new Map([
			['a', detail({ authority: 'Lancaster' })],
			['b', detail({ authority: 'North Yorkshire' })],
			['c', detail({ authority: 'North Yorkshire' })],
			['e', detail({ authority: 'Bedford' })]
		]);
		const labels = distinguishedLabels(
			[
				{ id: 'a', name: 'Middleton', distanceMetres: 22_300 },
				{ id: 'b', name: 'Middleton', distanceMetres: 61_100 },
				{ id: 'C', name: 'middleton', distanceMetres: 66_400 },
				{ id: 'd', name: 'Christleton', distanceMetres: 7_300 },
				{ id: 'e', name: 'Barton', distanceMetres: 4_000 }
			],
			'Parish, town and community councils',
			details,
			['barton']
		);
		assert.deepStrictEqual(Object.fromEntries(labels), {
			a: 'Middleton (Lancaster)',
			b: 'Middleton (North Yorkshire, 61.1 km from the site)',
			C: 'middleton (North Yorkshire, 66.4 km from the site)',
			d: 'Christleton',
			// one already listed has its name
			e: 'Barton (Bedford)'
		});

		// with nothing to tell them apart, the distance; with no distance either, the name
		const bare = distinguishedLabels(
			[
				{ id: 'x', name: 'Rail', distanceMetres: 1_000 },
				{ id: 'y', name: 'Rail' }
			],
			'Railways',
			new Map()
		);
		assert.deepStrictEqual(Object.fromEntries(bare), { x: 'Rail (1.0 km from the site)', y: 'Rail' });
	});

	it('reads a label back in each way the page gives it, and finds the name before its bracket', () => {
		assert.deepStrictEqual(labelVariants({ id: 'a', name: 'Middleton', distanceMetres: 61_100 }, 'North Yorkshire'), [
			'Middleton (North Yorkshire)',
			'Middleton (North Yorkshire, 61.1 km from the site)',
			'Middleton (61.1 km from the site)'
		]);
		assert.deepStrictEqual(labelVariants({ id: 'a', name: 'Middleton' }, undefined), []);
		assert.strictEqual(nameBeforeLabel('Middleton (Lancaster)'), 'Middleton');
		// a name with a bracket of its own keeps it
		assert.strictEqual(nameBeforeLabel('Aikengall II (Scotland) (Intergen, Wind)'), 'Aikengall II (Scotland)');
		assert.strictEqual(nameBeforeLabel('Middleton'), undefined);
	});
});
