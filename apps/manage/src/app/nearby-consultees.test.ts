import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
	DEFAULT_NSIP_RADIUS_KM,
	loadNearbyConsultees,
	parseNearbyConsultees,
	searchRadiusMetres
} from './nearby-consultees.ts';

describe('nearby consultees', () => {
	it('loads the shipped config/nearby-consultees.yaml', () => {
		const nearby = loadNearbyConsultees();
		assert.ok(nearby.defaultRadiusMetres > 0);
		assert.ok(Object.keys(nearby.radiusMetresByCategory).includes('Parish Council'));
		assert.ok(nearby.nsipRadiusMetres > 0);
	});

	it('reads the default and each category in km, as metres', () => {
		assert.deepStrictEqual(
			parseNearbyConsultees('version: 1\ndefaultRadiusKm: 20\ncategories:\n  Parish Council: 5\n  Hospital: 0'),
			{
				defaultRadiusMetres: 20_000,
				radiusMetresByCategory: { 'Parish Council': 5_000, Hospital: 0 },
				nsipRadiusMetres: 10_000
			}
		);
		// categories are optional, and the Nearby NSIPs distance defaults
		assert.deepStrictEqual(parseNearbyConsultees('version: 1\ndefaultRadiusKm: 1.5'), {
			defaultRadiusMetres: 1_500,
			radiusMetresByCategory: {},
			nsipRadiusMetres: DEFAULT_NSIP_RADIUS_KM * 1000
		});
	});

	it('reads the Nearby NSIPs distance in km, as metres - 0 looks for none', () => {
		assert.equal(parseNearbyConsultees('version: 1\ndefaultRadiusKm: 20\nnsipRadiusKm: 2.5').nsipRadiusMetres, 2_500);
		assert.equal(parseNearbyConsultees('version: 1\ndefaultRadiusKm: 20\nnsipRadiusKm: 0').nsipRadiusMetres, 0);
	});

	const invalid: [string, string, RegExp][] = [
		['an empty file', '', /version 1 document/],
		['not a document', 'just text', /version 1 document/],
		['the wrong version', 'version: 2\ndefaultRadiusKm: 20', /version 1 document/],
		['no default', 'version: 1', /defaultRadiusKm must be a number of km above 0/],
		['a zero default', 'version: 1\ndefaultRadiusKm: 0', /defaultRadiusKm must be a number of km above 0/],
		['categories as a list', 'version: 1\ndefaultRadiusKm: 20\ncategories: [Parish Council]', /categories must map/],
		['a negative category', 'version: 1\ndefaultRadiusKm: 20\ncategories:\n  Hospital: -1', /categories\.Hospital/],
		['a distance in words', 'version: 1\ndefaultRadiusKm: 20\ncategories:\n  Hospital: ten', /categories\.Hospital/],
		['a distance over 500km', 'version: 1\ndefaultRadiusKm: 501', /to 500/],
		['a negative Nearby NSIPs distance', 'version: 1\ndefaultRadiusKm: 20\nnsipRadiusKm: -1', /nsipRadiusKm/],
		['a Nearby NSIPs distance in words', 'version: 1\ndefaultRadiusKm: 20\nnsipRadiusKm: ten', /nsipRadiusKm/]
	];
	for (const [name, text, error] of invalid) {
		it(`rejects ${name}`, () => {
			assert.throws(() => parseNearbyConsultees(text), error);
		});
	}

	it('searches out to the largest distance configured', () => {
		const nearby = { defaultRadiusMetres: 20_000, radiusMetresByCategory: {}, nsipRadiusMetres: 10_000 };
		assert.equal(searchRadiusMetres(nearby), 20_000);
		assert.equal(searchRadiusMetres({ ...nearby, radiusMetresByCategory: { Hospital: 35_000, Parish: 0 } }), 35_000);
		// far enough to draw every Nearby NSIP too
		assert.equal(searchRadiusMetres({ ...nearby, nsipRadiusMetres: 40_000 }), 40_000);
	});
});
