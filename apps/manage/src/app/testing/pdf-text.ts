import { inflateSync } from 'node:zlib';

/** A 1x1 PNG - stands in for map images and basemap tiles. */
export const ONE_PIXEL_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64'
);

/**
 * The text a PDF made with pdfkit draws, one line per text-showing operation: pdfkit writes each
 * as a `[<hex> kerning <hex> ...] TJ` array in a deflated content stream, so this inflates every
 * stream holding one and decodes the hex runs. Enough for tests to check what a page says.
 */
export function pdfTextLines(pdf: Buffer): string[] {
	const streams = [...pdf.toString('latin1').matchAll(/stream\n([^]*?)\nendstream/g)]
		.map((match) => inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1'))
		.filter((content) => content.includes('] TJ'));
	return streams.flatMap((content) =>
		[...content.matchAll(/\[([^\]]*)\] TJ/g)].map((operation) =>
			[...operation[1].matchAll(/<([0-9a-f]*)>/g)].map((hex) => Buffer.from(hex[1], 'hex').toString('latin1')).join('')
		)
	);
}
