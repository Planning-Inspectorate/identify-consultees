/**
 * Run manage unit tests with a hard 100% line-coverage gate for frontend source.
 *
 * Excludes process entrypoints and the asset build script (exercised via `npm run build`
 * in CI). All other manage application code under `src/` must be covered.
 *
 * This is the only place manage unit tests run in CI: the root `node --test` pass in
 * `test`/`test-coverage` deliberately lists apps/function, packages and scripts rather
 * than discovering the whole tree, so these 35 files don't run twice.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const manageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = [
	'--test',
	'--experimental-test-coverage',
	'--test-coverage-lines=100',
	'--test-coverage-functions=100',
	'--test-coverage-branches=100',
	`--test-coverage-include=${path.join(manageRoot, 'src/**')}`,
	`--test-coverage-exclude=${path.join(manageRoot, '**/*.test.*')}`,
	`--test-coverage-exclude=${path.join(manageRoot, '**/server.ts')}`,
	`--test-coverage-exclude=${path.join(manageRoot, '**/util/build.ts')}`,
	`--test-coverage-exclude=${path.join(manageRoot, '**/e2e/**')}`
];

const result = spawnSync(process.execPath, args, {
	cwd: manageRoot,
	stdio: 'inherit',
	env: process.env
});

process.exit(result.status ?? 1);
