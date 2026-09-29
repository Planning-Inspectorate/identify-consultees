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

export async function seedDev(dbClient: PrismaClient) {
	const consulteeAreaCount = await importConsulteeAreas(dbClient, path.join(sampleDataDir, 'reference_data.geojson'));
	console.log(`Loaded ${consulteeAreaCount} consultee areas`);

	const caseBoundaryCount = await importCaseBoundaries(
		dbClient,
		path.join(sampleDataDir, 'sample_application_boundaries.geojson')
	);
	console.log(`Loaded ${caseBoundaryCount} case boundaries`);

	console.log('dev seed complete');
}
