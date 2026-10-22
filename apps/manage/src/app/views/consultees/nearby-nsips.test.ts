import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { nsipType, splitNsipName } from './nearby-nsips.ts';

describe('a Nearby NSIP', () => {
	it("has its project type and sub-type from its case reference's sector and sub-sector", () => {
		assert.deepEqual(nsipType('TR010031'), { type: 'Transport', subType: 'Highways' });
		assert.deepEqual(nsipType('en020027'), { type: 'Energy', subType: 'Electric Lines' });
		assert.deepEqual(nsipType(' WW010001 '), { type: 'Waste Water', subType: 'Waste Water Treatment Plants' });
		// a sector whose sub-sectors aren't known, a reference that says neither, and none
		assert.deepEqual(nsipType('BC080001'), { type: 'Business and Commercial', subType: null });
		assert.deepEqual(nsipType('XX010001'), { type: null, subType: null });
		assert.deepEqual(nsipType(undefined), { type: null, subType: null });
	});

	it('has its project name and case reference from the name it is listed under', () => {
		assert.deepEqual(splitNsipName('A1 Birtley to Coal House (TR010031)'), {
			projectName: 'A1 Birtley to Coal House',
			caseReference: 'TR010031'
		});
		assert.deepEqual(splitNsipName(' Wind Farm (Phase 2) (EN010200) '), {
			projectName: 'Wind Farm (Phase 2)',
			caseReference: 'EN010200'
		});
		assert.deepEqual(splitNsipName('Typed Project'), { projectName: 'Typed Project' });
	});
});
