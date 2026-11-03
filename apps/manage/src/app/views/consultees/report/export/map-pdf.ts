import PDFDocument from 'pdfkit';
import { LOCAL_FILL_OPACITY } from '../../../../maps/case-geojson.ts';
import { formatDate } from './workbook.ts';

/**
 * One category's map as a PDF, for the report download: an A4 landscape page with the category's
 * static map, a scale bar and a key, then the category's consultees in the report, with why each is in it.
 */

/** A consultee as the map PDF lists it. */
export interface MapPdfConsultee {
	name: string;
	identified: string[];
	/** False for one added by hand that the map doesn't draw - see ReportConsultee.mapped. */
	mapped: boolean;
	/** The colour it alone is drawn in - a Nearby NSIP, each project its own (see nsipColours). */
	colour?: string;
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
	/** How many metres a pixel of `image` covers, at its centre - for the scale bar. */
	metresPerPixel: number;
	/** The colours the map draws the category's consultees and the site in, for the key. */
	colours: { consultee: string; site: string; siteFillOpacity: number };
	/** The ruleset's buffers the map draws around the site - `2 km`, `10 km` - for the key. */
	buffers: string[];
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

// as the map draws a buffer (static-map.ts): a dark dashed line
const BUFFER_KEY_COLOUR = '#0b0c0c';

/** A dashed line, as the map draws a buffer's outline. */
function dashedSwatch(doc: PDFKit.PDFDocument, x: number, y: number): void {
	doc
		.save()
		.strokeColor(BUFFER_KEY_COLOUR)
		.lineWidth(1.5)
		.dash(3, { space: 2 })
		.moveTo(x, y + SWATCH / 2)
		.lineTo(x + SWATCH * 2, y + SWATCH / 2)
		.stroke()
		.restore();
}

/** A PNG's width and height in pixels, from its header. */
function pngSize(png: Buffer): { width: number; height: number } {
	return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

// the longest the scale bar is drawn, in points, and how far in from the map's corner
const SCALE_BAR_MAX_LENGTH = 150;
const SCALE_BAR_INSET = 8;

/**
 * The scale bar for a map with `metresPerPoint`: the longest round distance - 1, 2 or 5 times a
 * power of ten metres - that fits in `maxLength` points, its length in points, and its label.
 */
export function scaleBar(metresPerPoint: number, maxLength: number): { length: number; label: string } {
	const longest = metresPerPoint * maxLength;
	const power = 10 ** Math.floor(Math.log10(longest));
	const metres = [5, 2, 1].map((step) => step * power).find((distance) => distance <= longest)!;
	return { length: metres / metresPerPoint, label: metres < 1000 ? `${metres} m` : `${metres / 1000} km` };
}

/**
 * A scale bar in the bottom left corner of the map, on a white panel so it reads over any
 * basemap: a bar, its first half filled as a printed map's, and the distance it covers.
 */
function drawScaleBar(doc: PDFKit.PDFDocument, left: number, bottom: number, metresPerPoint: number): void {
	const { length, label } = scaleBar(metresPerPoint, SCALE_BAR_MAX_LENGTH);
	doc.font('Helvetica').fontSize(9);
	const [padding, barHeight, panelHeight] = [6, 5, 18];
	const x = left + SCALE_BAR_INSET;
	const y = bottom - SCALE_BAR_INSET - panelHeight;
	const panelWidth = padding + length + padding + doc.widthOfString(label) + padding;
	doc.save().fillColor('#ffffff').fillOpacity(0.85).rect(x, y, panelWidth, panelHeight).fill().restore();
	const barTop = y + (panelHeight - barHeight) / 2;
	doc
		.save()
		.fillColor(TEXT_COLOUR)
		.rect(x + padding, barTop, length / 2, barHeight)
		.fill()
		.restore();
	doc
		.save()
		.strokeColor(TEXT_COLOUR)
		.lineWidth(0.75)
		.rect(x + padding, barTop, length, barHeight)
		.stroke()
		.restore();
	doc.fillColor(TEXT_COLOUR).text(label, x + padding + length + padding, y + 5, { lineBreak: false });
}

// how many of the projects' colours the key shows, side by side, for "a colour per project"
const KEY_PROJECT_COLOURS = 4;

function drawKey(
	doc: PDFKit.PDFDocument,
	y: number,
	colours: MapPdfInput['colours'],
	buffers: string[],
	projectColours: string[]
): void {
	const shown = projectColours.slice(0, KEY_PROJECT_COLOURS);
	const entries: [(x: number) => void, number, string][] = [
		shown.length > 0
			? [
					(x) => shown.forEach((colour, index) => swatch(doc, x + index * (SWATCH + 2), y, colour, LOCAL_FILL_OPACITY)),
					shown.length * (SWATCH + 2) - 2,
					'In the report, a colour per project (listed on the next page)'
				]
			: [(x) => swatch(doc, x, y, colours.consultee, LOCAL_FILL_OPACITY), SWATCH, 'In the report'],
		[(x) => swatch(doc, x, y, colours.site, colours.siteFillOpacity), SWATCH, 'The site']
	];
	if (buffers.length > 0) {
		entries.push([
			(x) => dashedSwatch(doc, x, y),
			SWATCH * 2,
			`Ruleset ${buffers.length === 1 ? 'buffer' : 'buffers'} (${buffers.join(', ')})`
		]);
	}
	let x = MARGIN;
	doc.font('Helvetica').fontSize(9).fillColor(TEXT_COLOUR);
	for (const [draw, swatchWidth, label] of entries) {
		draw(x);
		doc.fillColor(TEXT_COLOUR).text(label, x + swatchWidth + 6, y + 1, { lineBreak: false });
		x += swatchWidth + 6 + doc.widthOfString(label) + 24;
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
	// where the image lands: fitted to the map's box, centred across it
	const image = pngSize(input.image);
	const pointsPerPixel = Math.min(width / image.width, MAP_HEIGHT / image.height);
	drawScaleBar(
		doc,
		MARGIN + (width - image.width * pointsPerPixel) / 2,
		mapTop + image.height * pointsPerPixel,
		input.metresPerPixel / pointsPerPixel
	);
	const projectColours = input.consultees.flatMap((consultee) => (consultee.colour ? [consultee.colour] : []));
	drawKey(doc, mapTop + MAP_HEIGHT + 10, input.colours, input.buffers, projectColours);
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
		// a project drawn in its own colour has its swatch beside its name, as the map's key
		const indent = consultee.colour ? SWATCH + 6 : 0;
		if (consultee.colour) {
			swatch(doc, MARGIN, doc.y + 1, consultee.colour, LOCAL_FILL_OPACITY);
		}
		doc
			.font('Helvetica-Bold')
			.fontSize(10)
			.fillColor(TEXT_COLOUR)
			.text(pdfText(consultee.name), MARGIN + indent, doc.y, { width: width - indent });
		doc.font('Helvetica').fontSize(9).fillColor(SECONDARY_TEXT_COLOUR);
		for (const line of consultee.identified) {
			doc.text(pdfText(line), { width: width - indent });
		}
		if (!consultee.mapped) {
			doc.font('Helvetica-Oblique').text('Manually added - not on the map', { width: width - indent });
		}
		doc.moveDown(0.4);
		doc.x = MARGIN;
	}

	doc.end();
	return done;
}
