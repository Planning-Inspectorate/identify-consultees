import assert from 'node:assert';
import { describe, it } from 'node:test';
import { ONE_PIXEL_PNG, pdfTextLines } from '../../../../testing/pdf-text.ts';
import type { MapPdfInput } from './map-pdf.ts';
import { buildMapPdf, pdfText } from './map-pdf.ts';

function input(overrides: Partial<MapPdfInput> = {}): MapPdfInput {
	return {
		caseName: 'Test Solar Farm',
		caseReference: 'EN010001',
		rulesetName: 'Test ruleset',
		boundaryFileName: 'site.geojson',
		generatedAt: new Date('2026-10-13T14:00:00Z'),
		category: 'Parish Council',
		image: ONE_PIXEL_PNG,
		colours: { consultee: '#4c72b0', site: '#ff0000', siteFillOpacity: 0.2 },
		buffers: ['2 km', '10 km'],
		consultees: [
			{ name: 'Abbey Parish Council', identified: ['"B" host Parish Councils: intersects the site'], mapped: true },
			{ name: 'Added Parish', identified: ['Asked to be consulted'], mapped: false }
		],
		...overrides
	};
}

describe('report map PDF', () => {
	it('draws the map with a key, then lists the consultees with why each is in the report', async () => {
		const pdf = await buildMapPdf(input());

		assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
		// the map page, then the list
		assert.equal(pdf.toString('latin1').match(/\/Type \/Page\b/g)?.length, 2);
		const lines = pdfTextLines(pdf);
		assert.deepStrictEqual(lines.slice(0, 3), [
			'Parish Council',
			'Test Solar Farm (EN010001)',
			'Ruleset: Test ruleset   |   Boundary file: site.geojson   |   Generated 13 October 2026'
		]);
		for (const line of [
			'In the report',
			'The site',
			'Ruleset buffers (2 km, 10 km)',
			'Parish Council: 2 in the report',
			'Abbey Parish Council',
			'"B" host Parish Councils: intersects the site',
			'Asked to be consulted',
			// one typed in by name has no area to draw
			'Manually added - not on the map'
		]) {
			assert.ok(lines.includes(line), `missing "${line}"`);
		}
		assert.equal(lines.filter((line) => line === 'Manually added - not on the map').length, 1);
		// consultees not in the report aren't drawn, so aren't in the key
		assert.ok(!lines.some((line) => line.startsWith('Nearby')));
	});

	it('keys one buffer, and none when the map draws none', async () => {
		assert.ok(pdfTextLines(await buildMapPdf(input({ buffers: ['500 m'] }))).includes('Ruleset buffer (500 m)'));
		assert.ok(!pdfTextLines(await buildMapPdf(input({ buffers: [] }))).some((line) => line.startsWith('Ruleset b')));
	});

	it("leaves out a boundary file it doesn't have, and notes a map that couldn't draw its consultees", async () => {
		const lines = pdfTextLines(
			await buildMapPdf(
				input({ boundaryFileName: null, mapNote: 'The consultee areas could not be drawn on this map.' })
			)
		);
		assert.equal(lines[2], 'Ruleset: Test ruleset   |   Generated 13 October 2026');
		assert.ok(lines.includes('The consultee areas could not be drawn on this map.'));
	});

	it('keeps text the standard PDF fonts can draw, and drops what they cannot', () => {
		// Latin-1 and WinAnsi's extras as they are; Welsh ŵ and ŷ lose their accents; the rest is "?"
		assert.equal(pdfText('Café – “Ynys Môn”'), 'Café – “Ynys Môn”');
		assert.equal(pdfText('Cyngor Tŷ Ŵyr'), 'Cyngor Ty Wyr');
		assert.equal(pdfText('東京'), '??');
	});
});
