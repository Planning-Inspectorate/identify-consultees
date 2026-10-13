import PDFDocument from 'pdfkit';
import { LOCAL_FILL_OPACITY, NEARBY_LOCAL_FILL_OPACITY } from '../../../../maps/case-geojson.ts';
import { formatDate } from './workbook.ts';

/**
 * One category's map as a PDF, for the report download: an A4 landscape page with the category's
 * static map and a key, then the category's consultees in the report, with why each is in it.
 */

/** A consultee as the map PDF lists it. */
export interface MapPdfConsultee {
	name: string;
	identified: string[];
	/** False for one added by hand by name - it has no area, so it isn't on the map. */
	mapped: boolean;
}

export interface MapPdfInput {
	caseName: string;
	caseReference: string;
	rulesetName: string;
	boundaryFileName: string | null;
	generatedAt: Date;
	category: string;
	/** The static map as a PNG. */
	image: Buffer;
	/** The colours the map draws the category's consultees and the site in, for the key. */
	colours: { consultee: string; site: string; siteFillOpacity: number };
	/** Said under the map when it couldn't draw the category's consultee areas. */
	mapNote?: string;
	consultees: MapPdfConsultee[];
}

const MARGIN = 36;
const MAP_HEIGHT = 400;
const SWATCH = 10;
const TEXT_COLOUR = '#0b0c0c';
const SECONDARY_TEXT_COLOUR = '#505a5f';

// characters the standard PDF fonts can draw (WinAnsi) besides Latin-1
const WIN_ANSI_EXTRAS = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

/**
 * `value` drawable in the standard PDF fonts, which only cover WinAnsi: anything else (a Welsh ŵ or
 * ŷ, say) loses its accent, and anything still outside becomes "?", rather than drawing as garbage.
 */
export function pdfText(value: string): string {
	return [...value]
		.map((char) => {
			if (char.charCodeAt(0) <= 0xff || WIN_ANSI_EXTRAS.has(char)) {
				return char;
			}
			const base = char.normalize('NFD').replace(/[̀-ͯ]/g, '');
			return base.length > 0 && [...base].every((part) => part.charCodeAt(0) <= 0xff) ? base : '?';
		})
		.join('');
}

function swatch(doc: PDFKit.PDFDocument, x: number, y: number, colour: string, fillOpacity: number): void {
	doc.save().fillColor(colour).fillOpacity(fillOpacity).rect(x, y, SWATCH, SWATCH).fill().restore();
	doc.save().strokeColor(colour).lineWidth(1).rect(x, y, SWATCH, SWATCH).stroke().restore();
}

function drawKey(doc: PDFKit.PDFDocument, y: number, colours: MapPdfInput['colours']): void {
	const entries: [string, number, string][] = [
		[colours.consultee, LOCAL_FILL_OPACITY, 'In the report'],
		[colours.consultee, NEARBY_LOCAL_FILL_OPACITY, 'Nearby, not in the report'],
		[colours.site, colours.siteFillOpacity, 'The site']
	];
	let x = MARGIN;
	doc.font('Helvetica').fontSize(9).fillColor(TEXT_COLOUR);
	for (const [colour, opacity, label] of entries) {
		swatch(doc, x, y, colour, opacity);
		doc.fillColor(TEXT_COLOUR).text(label, x + SWATCH + 6, y + 1, { lineBreak: false });
		x += SWATCH + 6 + doc.widthOfString(label) + 24;
	}
}

/** The PDF for one category's map. */
export function buildMapPdf(input: MapPdfInput): Promise<Buffer> {
	const doc = new PDFDocument({
		size: 'A4',
		layout: 'landscape',
		margin: MARGIN,
		info: {
			Title: pdfText(`${input.category} - ${input.caseName} (${input.caseReference})`),
			Author: 'Planning Inspectorate',
			CreationDate: input.generatedAt
		}
	});
	const chunks: Buffer[] = [];
	doc.on('data', (chunk: Buffer) => chunks.push(chunk));
	const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
	const width = doc.page.width - MARGIN * 2;

	doc.font('Helvetica-Bold').fontSize(18).fillColor(TEXT_COLOUR).text(pdfText(input.category));
	doc
		.font('Helvetica')
		.fontSize(10)
		.fillColor(SECONDARY_TEXT_COLOUR)
		.text(pdfText(`${input.caseName} (${input.caseReference})`))
		.text(
			pdfText(
				[
					`Ruleset: ${input.rulesetName}`,
					...(input.boundaryFileName ? [`Boundary file: ${input.boundaryFileName}`] : []),
					`Generated ${formatDate(input.generatedAt)}`
				].join('   |   ')
			)
		);
	doc.moveDown(0.5);

	const mapTop = doc.y;
	doc.image(input.image, MARGIN, mapTop, { fit: [width, MAP_HEIGHT], align: 'center' });
	drawKey(doc, mapTop + MAP_HEIGHT + 10, input.colours);
	if (input.mapNote) {
		doc
			.font('Helvetica-Bold')
			.fontSize(10)
			.fillColor(TEXT_COLOUR)
			.text(pdfText(input.mapNote), MARGIN, mapTop + MAP_HEIGHT + 30, { width });
	}

	doc.addPage();
	doc
		.font('Helvetica-Bold')
		.fontSize(14)
		.fillColor(TEXT_COLOUR)
		.text(pdfText(`${input.category}: ${input.consultees.length} in the report`), MARGIN, MARGIN);
	doc.moveDown(0.5);
	for (const consultee of input.consultees) {
		doc.font('Helvetica-Bold').fontSize(10).fillColor(TEXT_COLOUR).text(pdfText(consultee.name), { width });
		doc.font('Helvetica').fontSize(9).fillColor(SECONDARY_TEXT_COLOUR);
		for (const line of consultee.identified) {
			doc.text(pdfText(line), { width });
		}
		if (!consultee.mapped) {
			doc.font('Helvetica-Oblique').text('Added by name - not on the map', { width });
		}
		doc.moveDown(0.4);
	}

	doc.end();
	return done;
}
