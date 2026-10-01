import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	PATCHED_REMOVE_ATTRIBUTES,
	VULNERABLE_REMOVE_ATTRIBUTES,
	applyMaplibreSanitizePatch,
	defraMaplibreFrameworkPath
} from './patch-maplibre-sanitize.ts';

describe('applyMaplibreSanitizePatch', () => {
	test('rewrites the vulnerable live NamedNodeMap loop to Array.from', () => {
		const source = `prefix;${VULNERABLE_REMOVE_ATTRIBUTES};suffix`;
		const result = applyMaplibreSanitizePatch(source);
		assert.equal(result.changed, true);
		assert.equal(result.alreadyPatched, false);
		assert.equal(result.source, `prefix;${PATCHED_REMOVE_ATTRIBUTES};suffix`);
		assert.equal(result.source.includes(VULNERABLE_REMOVE_ATTRIBUTES), false);
	});

	test('is a no-op when the bundle is already patched', () => {
		const source = `prefix;${PATCHED_REMOVE_ATTRIBUTES};suffix`;
		const result = applyMaplibreSanitizePatch(source);
		assert.equal(result.changed, false);
		assert.equal(result.alreadyPatched, true);
		assert.equal(result.source, source);
	});

	test('throws when neither vulnerable nor patched pattern is present', () => {
		assert.throws(
			() => applyMaplibreSanitizePatch('static removeAttributes(t){/* unexpected shape */}'),
			/expected vulnerable removeAttributes pattern was not found/
		);
	});
});

describe('defraMaplibreFrameworkPath', () => {
	test('resolves the Defra UMD under a given package root', () => {
		assert.match(
			defraMaplibreFrameworkPath('/repo'),
			/\/repo\/node_modules\/@defra\/interactive-map\/providers\/maplibre\/dist\/umd\/im-maplibre-framework\.js$/
		);
	});
});
