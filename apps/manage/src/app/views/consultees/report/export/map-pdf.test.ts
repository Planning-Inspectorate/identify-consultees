import assert from 'node:assert';
import { describe, it } from 'node:test';
import { ONE_PIXEL_PNG, pdfTextLines } from '../../../../testing/pdf-text.ts';
import type { MapPdfInput } from './map-pdf.ts';
import { buildMapPdf, mapLicensing, pdfText, scaleBar } from './map-pdf.ts';

function input(overrides: Partial<MapPdfInput> = {}): MapPdfInput {
	return {
		caseName: 'Test Solar Farm',
		caseReference: 'EN010001',
		rulesetName: 'Test ruleset',
		boundaryFileName: 'site.geojson',
		generatedAt: new Date('2026-10-13T14:00:00Z'),
		category: 'Parish Council',
		image: ONE_PIXEL_PNG,
		// the one pixel is drawn 400pt square - 10 m a point
		metresPerPixel: 4_000,
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
			// the scale bar: the longest round distance that fits
			'1 km',
			// the basemap's credit on the map, and every licence under it
			'© OpenStreetMap contributors',
			...mapLicensing(new Date('2026-10-13T14:00:00Z')),
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

	it('keys a colour per project when each is drawn in its own, with its swatch beside its name', async () => {
		const colours = ['#1d70b8', '#f47738', '#912b88', '#28a197', '#b58840'];
		const pdf = await buildMapPdf(
			input({
				category: 'NSIPs',
				consultees: colours.map((colour, index) => ({
					name: `Project ${index + 1} (EN01000${index + 1})`,
					identified: ['35km buffer'],
					mapped: true,
					colour
				}))
			})
		);
		const lines = pdfTextLines(pdf);
		assert.ok(lines.includes('In the report, a colour per project (listed on the next page)'));
		assert.ok(!lines.includes('In the report'));
		assert.ok(lines.includes('Project 5 (EN010005)'));
		// each project is still listed, each with its own swatch beside its name
		assert.equal(lines.filter((line) => /^Project \d \(EN01000\d\)$/.test(line)).length, 5);
	});

	it('keys one buffer, and none when the map draws none', async () => {
		assert.ok(pdfTextLines(await buildMapPdf(input({ buffers: ['500 m'] }))).includes('Ruleset buffer (500 m)'));
		assert.ok(!pdfTextLines(await buildMapPdf(input({ buffers: [] }))).some((line) => line.startsWith('Ruleset b')));
	});

	it("leaves out a boundary file it doesn't have, and notes a map that couldn't draw its consultees", async () => {
		const pdf = await buildMapPdf(
			input({ boundaryFileName: null, mapNote: 'The consultee areas could not be drawn on this map.' })
		);
		const lines = pdfTextLines(pdf);
		assert.equal(lines[2], 'Ruleset: Test ruleset   |   Generated 13 October 2026');
		assert.ok(lines.includes('The consultee areas could not be drawn on this map.'));
		// the note and the licences both fit on the map's page
		assert.equal(pdf.toString('latin1').match(/\/Type \/Page\b/g)?.length, 2);
	});

	it('scales its bar to the longest round distance that fits - 1, 2 or 5 of a power of ten metres', () => {
		// 100pt at 10 m a point is 1 km exactly
		assert.deepStrictEqual(scaleBar(10, 100), { length: 100, label: '1 km' });
		assert.deepStrictEqual(scaleBar(30, 100), { length: 2000 / 30, label: '2 km' });
		assert.deepStrictEqual(scaleBar(60, 100), { length: 5000 / 60, label: '5 km' });
		// under a kilometre, in metres
		assert.deepStrictEqual(scaleBar(4, 100), { length: 50, label: '200 m' });
		assert.deepStrictEqual(scaleBar(0.9, 100), { length: 50 / 0.9, label: '50 m' });
	});

	it("credits the basemap and the Crown's data, dated the year the report was made", () => {
		assert.deepStrictEqual(mapLicensing(new Date('2027-03-01T09:00:00Z')), [
			'Basemap © OpenStreetMap contributors, available under the Open Database Licence: openstreetmap.org/copyright.',
			'Contains OS data © Crown copyright and database right 2027. Contains public sector information licensed under the Open Government Licence v3.0.'
		]);
	});

	it('keeps text the standard PDF fonts can draw, and drops what they cannot', () => {
		// Latin-1 and WinAnsi's extras as they are; Welsh ŵ and ŷ lose their accents; the rest is "?"
		assert.equal(pdfText('Café – “Ynys Môn”'), 'Café – “Ynys Môn”');
		assert.equal(pdfText('Cyngor Tŷ Ŵyr'), 'Cyngor Ty Wyr');
		assert.equal(pdfText('東京'), '??');
	});
});
