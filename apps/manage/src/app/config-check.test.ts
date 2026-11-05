import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { checkConfig, CONFIG_CHECKS } from './config-check.ts';

describe('config check', () => {
	test('finds nothing wrong with the shipped config/ files, checking each', async () => {
		const results = await checkConfig();
		assert.deepEqual(
			results.map(({ file }) => file),
			CONFIG_CHECKS.map(({ file }) => file)
		);
		assert.deepEqual(
			results.filter(({ problems }) => problems.length > 0),
			[]
		);
	});

	test("reports a file's problems, an invalid file's error once, and a non-Error throw", async () => {
		const results = await checkConfig([
			{ file: 'report.yaml', check: async () => ['Hospital has no summary label'] },
			{
				file: 'reference-data.yaml',
				check: async () => {
					throw new Error('reference-data.yaml: groups must map each group to its categories');
				}
			},
			// one that reads the file above fails with its error
			{
				file: 'rulesets/',
				check: async () => {
					throw new Error('reference-data.yaml: groups must map each group to its categories');
				}
			},
			{
				file: 'screening.yaml',
				check: async () => {
					throw 'unreadable';
				}
			}
		]);
		assert.deepEqual(results, [
			{ file: 'report.yaml', problems: ['Hospital has no summary label'] },
			{ file: 'reference-data.yaml', problems: ['reference-data.yaml: groups must map each group to its categories'] },
			{ file: 'rulesets/', problems: ["can't be checked until the file above is put right"] },
			{ file: 'screening.yaml', problems: ['unreadable'] }
		]);
	});
});
