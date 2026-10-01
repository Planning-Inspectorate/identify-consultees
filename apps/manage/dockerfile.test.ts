import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const dockerfilePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'Dockerfile');
const dockerfile = readFileSync(dockerfilePath, 'utf8');

describe('manage Dockerfile hardening', () => {
	it('applies the MapLibre sanitize patch after npm ci - the image must not ship the vulnerable UMD', () => {
		// npm ci runs with --ignore-scripts (skipping the root postinstall), so the CVE-2026-85061
		// patch in scripts/patch-maplibre-sanitize.ts would never be applied unless the Dockerfile
		// runs it explicitly - and the app serves that bundle from node_modules at runtime.
		const ciIndex = dockerfile.indexOf('RUN npm ci');
		const patchIndex = dockerfile.indexOf('RUN npm run deps:patch-maplibre');
		assert.ok(ciIndex > -1, 'Dockerfile should install dependencies with npm ci');
		assert.ok(
			patchIndex > ciIndex,
			'Dockerfile must run deps:patch-maplibre after npm ci (npm ci --ignore-scripts skips the postinstall hook)'
		);
		assert.match(
			dockerfile,
			/^COPY scripts \.\/scripts/m,
			'Dockerfile must COPY scripts/ - the patch script lives there and is otherwise absent from the image'
		);
	});

	it('runs the app as the non-root node user', () => {
		assert.match(dockerfile, /^USER node$/m);
	});

	it('uses an exec-form entrypoint so node is PID 1 and receives SIGTERM', () => {
		assert.match(dockerfile, /^ENTRYPOINT \[.*node/m);
		assert.doesNotMatch(dockerfile, /^ENTRYPOINT (?!\[)/m);
	});
});
