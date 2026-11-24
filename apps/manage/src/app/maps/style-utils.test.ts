import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { isRecord, loadVersionedMapStylesFile, onlyKeys } from './style-utils.ts'; // Adjust path to your module

describe('isRecord', () => {
	it('returns true for plain objects', () => {
		assert.equal(isRecord({}), true);
		assert.equal(isRecord({ stroke: '#000000', strokeWidth: 2 }), true);
	});

	it('returns false for null and undefined', () => {
		assert.equal(isRecord(null), false);
		assert.equal(isRecord(undefined), false);
	});

	it('returns false for arrays', () => {
		assert.equal(isRecord([]), false);
		assert.equal(isRecord([1, 2, 3]), false);
	});

	it('returns false for primitive values', () => {
		assert.equal(isRecord('string'), false);
		assert.equal(isRecord(42), false);
		assert.equal(isRecord(true), false);
		assert.equal(isRecord(false), false);
		assert.equal(isRecord(Symbol('sym')), false);
		assert.equal(isRecord(10n), false);
	});
});

describe('onlyKeys', () => {
	const allowed = ['stroke', 'strokeWidth', 'strokeDashArray', 'fill', 'symbolDescription'];

	it('does not throw when all keys are allowed', () => {
		assert.doesNotThrow(() => {
			onlyKeys({ stroke: '#ff0000', strokeWidth: 1, fill: '#00ff00' }, allowed, 'styles.yaml', 'layers.water');
		});
	});

	it('does not throw for an empty object', () => {
		assert.doesNotThrow(() => {
			onlyKeys({}, allowed, 'styles.yaml', 'layers.water');
		});
	});

	it('throws a descriptive error for a single unknown key', () => {
		assert.throws(
			() => {
				onlyKeys({ stroke: '#ff0000', strokeDash: [2, 2] }, allowed, 'styles.yaml', 'layers.water');
			},
			{
				name: 'Error',
				message:
					'styles.yaml: layers.water has "strokeDash" - it can only have stroke, strokeWidth, strokeDashArray, fill, symbolDescription'
			}
		);
	});

	it('throws a descriptive error listing all unknown keys', () => {
		assert.throws(
			() => {
				onlyKeys({ colour: '#fff', opacity: 0.5 }, allowed, 'styles.yaml', 'layers.roads');
			},
			{
				name: 'Error',
				message:
					'styles.yaml: layers.roads has "colour", "opacity" - it can only have stroke, strokeWidth, strokeDashArray, fill, symbolDescription'
			}
		);
	});
});

describe('loadVersionedMapStylesFile', () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(path.join(tmpdir(), 'map-styles-test-'));
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	const writeTempYaml = (name: string, content: string): string => {
		const filePath = path.join(tempDir, name);
		writeFileSync(filePath, content, 'utf8');
		return filePath;
	};

	it('loads and returns a valid versioned YAML document', () => {
		const filePath = writeTempYaml(
			'valid.yaml',
			['version: 1', 'styles:', '  default:', '    stroke: "#112233"', '    strokeWidth: 2'].join('\n')
		);

		const result = loadVersionedMapStylesFile(filePath, 1);

		assert.deepEqual(result, {
			version: 1,
			styles: {
				default: {
					stroke: '#112233',
					strokeWidth: 2
				}
			}
		});
	});

	it('throws when the file is empty or whitespace-only', () => {
		const emptyPath = writeTempYaml('empty.yaml', '');
		const whitespacePath = writeTempYaml('whitespace.yaml', '   \n\t  \n');

		assert.throws(
			() => loadVersionedMapStylesFile(emptyPath, 1),
			new Error(`${emptyPath} must be a version 1 document`)
		);
		assert.throws(
			() => loadVersionedMapStylesFile(whitespacePath, 1),
			new Error(`${whitespacePath} must be a version 1 document`)
		);
	});

	it('throws when the YAML root is not a record', () => {
		const listPath = writeTempYaml('list.yaml', '- item1\n- item2\n');
		const scalarPath = writeTempYaml('scalar.yaml', 'just a string\n');

		assert.throws(() => loadVersionedMapStylesFile(listPath, 1), new Error(`${listPath} must be a version 1 document`));
		assert.throws(
			() => loadVersionedMapStylesFile(scalarPath, 1),
			new Error(`${scalarPath} must be a version 1 document`)
		);
	});

	it('throws when the version property is missing or does not match', () => {
		const missingVersionPath = writeTempYaml('no-version.yaml', 'styles: {}\n');
		const wrongVersionPath = writeTempYaml('wrong-version.yaml', 'version: 2\n');
		const stringVersionPath = writeTempYaml('string-version.yaml', 'version: "1"\n');

		assert.throws(
			() => loadVersionedMapStylesFile(missingVersionPath, 1),
			new Error(`${missingVersionPath} must be a version 1 document`)
		);
		assert.throws(
			() => loadVersionedMapStylesFile(wrongVersionPath, 1),
			new Error(`${wrongVersionPath} must be a version 1 document`)
		);
		assert.throws(
			() => loadVersionedMapStylesFile(stringVersionPath, 1),
			new Error(`${stringVersionPath} must be a version 1 document`)
		);
	});

	it('throws when the file does not exist', () => {
		const missingPath = path.join(tempDir, 'does-not-exist.yaml');

		assert.throws(() => loadVersionedMapStylesFile(missingPath, 1), {
			code: 'ENOENT'
		});
	});

	it('throws a YAMLException when the YAML syntax is malformed', () => {
		const badYamlPath = writeTempYaml('malformed.yaml', 'version: 1\nstyles: [unclosed\n');

		assert.throws(() => loadVersionedMapStylesFile(badYamlPath, 1), {
			name: 'YAMLException'
		});
	});
});
