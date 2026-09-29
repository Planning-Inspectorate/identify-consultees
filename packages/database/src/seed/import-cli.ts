/**
 * Load a real GeoJSON file (reference/consultee area data, or project/case boundary data) into
 * the database - same source shape as the local dev sample data, just potentially many more/
 * larger features. See geojson-import.ts for the shared mapping/loading logic this wraps.
 *
 * Usage:
 *   npm run db-import -- --type=consultee-areas --file=/path/to/reference_data.geojson
 *   npm run db-import -- --type=case-boundaries --file=/path/to/application_boundaries.geojson
 *
 * Optional: --batch-size=<n> to override the default rows-per-round-trip (tune down for
 * unusually large/complex geometries, up for small simple ones).
 */
import { loadConfig } from '../configuration/config.ts';
import { newDatabaseClient } from '../index.ts';
import { importCaseBoundaries, importConsulteeAreas } from './geojson-import.ts';

interface ParsedArgs {
	type: 'consultee-areas' | 'case-boundaries';
	file: string;
	batchSize?: number;
}

function parseArgs(argv: string[]): ParsedArgs {
	const values: Record<string, string> = {};
	for (const arg of argv) {
		const match = /^--([^=]+)=(.*)$/.exec(arg);
		if (match) {
			values[match[1]] = match[2];
		}
	}

	const type = values.type;
	if (type !== 'consultee-areas' && type !== 'case-boundaries') {
		throw new Error(`--type must be "consultee-areas" or "case-boundaries" (got: ${type ?? '(missing)'})`);
	}
	if (!values.file) {
		throw new Error('--file is required (path to the GeoJSON file to import)');
	}

	const batchSize = values['batch-size'] ? Number.parseInt(values['batch-size'], 10) : undefined;
	if (batchSize !== undefined && (!Number.isInteger(batchSize) || batchSize < 1)) {
		throw new Error(`--batch-size must be a positive integer (got: ${values['batch-size']})`);
	}

	return { type, file: values.file, batchSize };
}

function logProgress(startedAt: number) {
	return (loaded: number, total: number) => {
		const elapsedSeconds = (Date.now() - startedAt) / 1000;
		const rate = loaded / elapsedSeconds;
		const remaining = total - loaded;
		const etaSeconds = rate > 0 ? Math.round(remaining / rate) : 0;
		console.log(`  ${loaded}/${total} (${rate.toFixed(0)} rows/s, ~${etaSeconds}s remaining)`);
	};
}

async function run() {
	const args = parseArgs(process.argv.slice(2));
	const config = loadConfig();
	const dbClient = newDatabaseClient(config.db);

	console.log(`Importing ${args.type} from ${args.file}...`);
	const startedAt = Date.now();

	try {
		const options = { batchSize: args.batchSize, onProgress: logProgress(startedAt) };
		const count =
			args.type === 'consultee-areas'
				? await importConsulteeAreas(dbClient, args.file, options)
				: await importCaseBoundaries(dbClient, args.file, options);

		const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
		console.log(`Imported ${count} rows in ${elapsedSeconds}s`);
	} catch (error) {
		console.error(error);
		throw error;
	} finally {
		await dbClient.$disconnect();
	}
}

run();
