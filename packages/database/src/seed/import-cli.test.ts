import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { PrismaClient } from '../client/client.ts';
import { loadConfig } from '../configuration/config.ts';
import { acquireDbTestLock, releaseDbTestLock } from '../db-test-lock.ts';
import { newDatabaseClient } from '../index.ts';
import { deterministicId } from './geojson-import.ts';
import { parseArgs } from './import-cli.ts';

describe('parseArgs', () => {
	test('parses a valid consultee-areas import', () => {
		assert.deepEqual(parseArgs(['--type=consultee-areas', '--file=/data/ref.geojson']), {
			type: 'consultee-areas',
			file: '/data/ref.geojson',
			batchSize: undefined
		});
	});

	test('parses an optional positive batch size', () => {
		assert.deepEqual(parseArgs(['--type=case-boundaries', '--file=./a.geojson', '--batch-size=25']), {
			type: 'case-boundaries',
			file: './a.geojson',
			batchSize: 25
		});
	});

	test('ignores arguments that are not --key=value', () => {
		assert.deepEqual(parseArgs(['stray', '--type=consultee-areas', '--file=./a.geojson']), {
			type: 'consultee-areas',
			file: './a.geojson',
			batchSize: undefined
		});
	});

	test('rejects an unknown or missing type', () => {
		assert.throws(() => parseArgs(['--file=./a.geojson']), /--type must be/);
		assert.throws(() => parseArgs(['--type=widgets', '--file=./a.geojson']), /--type must be/);
	});

	test('rejects a missing file path', () => {
		assert.throws(() => parseArgs(['--type=consultee-areas']), /--file is required/);
	});

	test('rejects a non-positive batch size', () => {
		assert.throws(
			() => parseArgs(['--type=consultee-areas', '--file=./a.geojson', '--batch-size=0']),
			/--batch-size must be a positive integer/
		);
		assert.throws(
			() => parseArgs(['--type=consultee-areas', '--file=./a.geojson', '--batch-size=nope']),
			/--batch-size must be a positive integer/
		);
	});
});

// the rest of the module only runs as a script (the isMain block), so these tests spawn the real
// CLI in a child process - child coverage still counts towards this file's numbers
const cliPath = fileURLToPath(new URL('./import-cli.ts', import.meta.url));
const databaseDir = fileURLToPath(new URL('../..', import.meta.url));

const cliAreaId = deterministicId('consultee-area:import-cli-test-1');
const cliBoundaryId = deterministicId('case-boundary:ZZIMPORTCLI:cli.geojson');

let dbClient: PrismaClient;
let dbAvailable = false;
let connectionString: string | undefined;

before(async () => {
	try {
		connectionString = loadConfig().db;
		dbClient = newDatabaseClient(connectionString);
		await dbClient.$queryRaw`SELECT 1 AS probe`;
		dbAvailable = true;
		// the CLI replaces the whole tables it imports, so the files that write the real
		// database take turns rather than run at the same time
		await acquireDbTestLock();
	} catch {
		dbAvailable = false;
	}
});

after(async () => {
	releaseDbTestLock();
	await dbClient?.$disconnect();
});

function runCli(args: string[], env: Record<string, string> = {}): string {
	return execFileSync(process.execPath, ['--experimental-strip-types', cliPath, ...args], {
		cwd: databaseDir,
		env: { ...process.env, ...env },
		encoding: 'utf8'
	});
}

function withGeoJson(contents: object, fn: (filePath: string) => void) {
	const dir = mkdtempSync(path.join(tmpdir(), 'import-cli-test-'));
	try {
		const filePath = path.join(dir, 'data.geojson');
		writeFileSync(filePath, JSON.stringify(contents));
		fn(filePath);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

describe('running as a script (requires a local SQL Server - see docker-compose.yml)', () => {
	test('imports a consultee-areas GeoJSON file', async (t) => {
		if (!dbAvailable) return t.skip('SQL Server database not available');
		// a consultee-areas import replaces the whole table - so only against CI's throwaway
		// database, never a developer's loaded reference data
		if (!process.env.CI && !process.env.TF_BUILD) {
			return t.skip('replaces every consultee area - runs in CI only');
		}

		await dbClient.$executeRaw`DELETE FROM consultee_area WHERE id = ${cliAreaId}`;
		try {
			const file = {
				type: 'FeatureCollection',
				features: [
					{
						geometry: { type: 'Point', coordinates: [0, 0] },
						properties: { id: 'import-cli-test-1', consultee: 'CLI Trust', consulteeCategory: 'Ambulance Trust' }
					}
				]
			};
			withGeoJson(file, (filePath) => {
				const stdout = runCli(['--type=consultee-areas', `--file=${filePath}`], {
					SQL_CONNECTION_STRING: connectionString!
				});
				assert.match(stdout, /Importing consultee-areas/);
				assert.match(stdout, /1\/1 \(/);
				assert.match(stdout, /Imported 1 rows/);
			});

			const [row] = await dbClient.$queryRaw<{ found: number }[]>`
				SELECT 1 AS found FROM consultee_area WHERE id = ${cliAreaId}
			`;
			assert.equal(row.found, 1);
		} finally {
			await dbClient.$executeRaw`DELETE FROM consultee_area WHERE id = ${cliAreaId}`;
		}
	});

	test('imports a case-boundaries GeoJSON file', async (t) => {
		if (!dbAvailable) return t.skip('SQL Server database not available');

		await dbClient.$executeRaw`DELETE FROM case_boundary WHERE id = ${cliBoundaryId}`;
		try {
			const file = {
				type: 'FeatureCollection',
				features: [
					{
						geometry: { type: 'Point', coordinates: [0, 0] },
						properties: {
							caseReference: 'ZZIMPORTCLI',
							projectName: 'CLI boundary import',
							fileName: 'cli.geojson',
							receivedDate: '2026-01-01T00:00:00.000Z'
						}
					}
				]
			};
			withGeoJson(file, (filePath) => {
				const stdout = runCli(['--type=case-boundaries', `--file=${filePath}`], {
					SQL_CONNECTION_STRING: connectionString!
				});
				assert.match(stdout, /Importing case-boundaries/);
				assert.match(stdout, /Imported 1 rows/);
			});

			const [row] = await dbClient.$queryRaw<{ found: number }[]>`
				SELECT 1 AS found FROM case_boundary WHERE id = ${cliBoundaryId}
			`;
			assert.equal(row.found, 1);
		} finally {
			await dbClient.$executeRaw`DELETE FROM case_boundary WHERE id = ${cliBoundaryId}`;
		}
	});
});

describe('running as a script (no database needed)', () => {
	test('a failing import logs the error and exits non-zero', () => {
		// a well-formed but unreachable connection string - the file read fails before the client
		// ever connects, so this needs no real database
		const dummyConnectionString = 'sqlserver://localhost:1;database=x;user=u;password=p';
		try {
			runCli(['--type=consultee-areas', '--file=/definitely/not/here.geojson'], {
				SQL_CONNECTION_STRING: dummyConnectionString
			});
			assert.fail('expected the CLI to exit non-zero');
		} catch (error) {
			const failure = error as { status: number; stdout: string; stderr: string };
			assert.equal(failure.status, 1);
			assert.match(failure.stdout, /Importing consultee-areas/);
			assert.match(failure.stderr, /ENOENT/);
		}
	});

	test('does nothing when imported rather than run as a script', () => {
		// an eval-mode import has no argv[1] at all, so the isMain guard stays false
		const stdout = execFileSync(
			process.execPath,
			['--input-type=module', '--eval', `await import(${JSON.stringify(pathToFileURL(cliPath).href)})`],
			{ cwd: databaseDir, encoding: 'utf8' }
		);
		assert.equal(stdout, '');
	});
});
