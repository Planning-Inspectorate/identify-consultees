import { loadConfig } from '../configuration/config.ts';
import { newDatabaseClient, withExtendedTimeout } from '../index.ts';
import { seedDev } from './data-dev.ts';

// 2 minutes - the small batch size in data-dev.ts already keeps most round trips fast, but a
// single large/complex real geometry can still exceed the driver's default ~15s request timeout
// (confirmed against the real Dev database)
const SEED_REQUEST_TIMEOUT_MS = 120_000;

async function run() {
	const config = loadConfig();

	const dbClient = newDatabaseClient(withExtendedTimeout(config.db, SEED_REQUEST_TIMEOUT_MS));

	try {
		await seedDev(dbClient);
	} catch (error) {
		console.error(error);
		throw error;
	} finally {
		await dbClient.$disconnect();
	}
}

run();
