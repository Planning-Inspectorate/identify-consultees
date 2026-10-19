import { createReadStream } from 'node:fs';

/**
 * Read a GeoJSON FeatureCollection one feature at a time, rather than parsing the whole file at
 * once. A full reference data export is hundreds of megabytes - parsed whole, it holds gigabytes
 * of coordinate arrays, more than the App Service plan's memory - so the import reads it in
 * chunks, yielding each element of the top-level `features` array as it's complete, with its
 * length in characters (a measure of how much loading it costs).
 *
 * Only the `features` array's elements are parsed: the rest of the document (type, name, crs) is
 * scanned past. A file that ends before the document closes, or with no `features` array, throws.
 */
export async function* streamFeatures<T = unknown>(filePath: string): AsyncGenerator<{ feature: T; length: number }> {
	let depth = 0;
	let inString = false;
	let escaped = false;
	// the last string closed in the top-level object, and the key the current value is under
	let topLevelString = '';
	let collectingTopLevelString = false;
	let key = '';
	let inFeatures = false;
	let sawFeatures = false;
	// the feature being read: whole chunks' text already passed, and where it starts in this one
	let pending = '';
	let start = -1;

	for await (const chunk of createReadStream(filePath, { encoding: 'utf8', highWaterMark: 1 << 20 })) {
		const text = chunk as string;
		start = start === -1 ? -1 : 0;
		for (let i = 0; i < text.length; i++) {
			const char = text[i];
			if (inString) {
				if (escaped) {
					escaped = false;
				} else if (char === '\\') {
					escaped = true;
				} else if (char === '"') {
					inString = false;
					collectingTopLevelString = false;
				} else if (collectingTopLevelString) {
					topLevelString += char;
				}
				continue;
			}
			switch (char) {
				case '"':
					inString = true;
					if (depth === 1) {
						collectingTopLevelString = true;
						topLevelString = '';
					}
					break;
				case ':':
					if (depth === 1) {
						key = topLevelString;
					}
					break;
				case '{':
				case '[':
					if (inFeatures && depth === 2) {
						start = i;
						pending = '';
					}
					if (depth === 1 && char === '[' && key === 'features') {
						inFeatures = true;
						sawFeatures = true;
					}
					depth++;
					break;
				case '}':
				case ']':
					depth--;
					if (inFeatures && depth === 2 && start !== -1) {
						const featureText = pending + text.slice(start, i + 1);
						pending = '';
						start = -1;
						yield { feature: JSON.parse(featureText) as T, length: featureText.length };
					} else if (inFeatures && depth === 1) {
						inFeatures = false;
					}
					break;
			}
		}
		if (start !== -1) {
			pending += text.slice(start);
		}
	}

	if (depth !== 0 || inString) {
		throw new Error(`${filePath} ended before its GeoJSON was complete`);
	}
	if (!sawFeatures) {
		throw new Error(`${filePath} has no features array - it isn't a GeoJSON FeatureCollection`);
	}
}
