import type { PrismaClient } from '@pins/identify-consultees-database/src/client/client.ts';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importCaseBoundaries, importConsulteeAreas } from './geojson-import.ts';

// real UK infrastructure/consultee boundary exports, used as realistic local dev/demo data - see
// apps/function-python/setup_database/sample_data. Same shape (and likely source) as the real,
// large dataset - see geojson-import.ts / import-cli.ts for loading that.
const sampleDataDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../../../../apps/function-python/setup_database/sample_data'
);

// A smaller batch than loadConsulteeAreas/loadCaseBoundaries' own default (200). reference_data.geojson
// is only 80 features but ~10.5MB (some genuinely large/complex geometries, e.g. national rail
// networks) - a single MERGE statement covering all of them comfortably exceeds Prisma's 15s
// request timeout against a real, network-distant SQL Server (confirmed: it reliably timed out
// seeding the real Dev database, even though the same file loads in seconds against a local
// Docker instance). Seeding isn't performance-sensitive, so trading round trips for headroom here
// is the right call.
const SEED_BATCH_SIZE = 5;

export async function seedDev(dbClient: PrismaClient) {
	const options = { batchSize: SEED_BATCH_SIZE };

	const consulteeAreaCount = await importConsulteeAreas(
		dbClient,
		path.join(sampleDataDir, 'reference_data.geojson'),
		options
	);
	console.log(`Loaded ${consulteeAreaCount} consultee areas`);

	const caseBoundaryCount = await importCaseBoundaries(
		dbClient,
		path.join(sampleDataDir, 'sample_application_boundaries.geojson'),
		options
	);
	console.log(`Loaded ${caseBoundaryCount} case boundaries`);

	console.log('dev seed complete');
}
