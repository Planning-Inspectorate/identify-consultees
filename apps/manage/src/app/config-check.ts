/**
 * `npm run check-config`: every file in config/ loaded as the app loads it, then checked against the
 * others as the tests check them - what's wrong, in words, in a second or two rather than the
 * minutes `npm test` takes. See config/README.md.
 */

export interface ConfigCheck {
	/** The file or folder in config/ checked. */
	file: string;
	/** Loads it - throwing if it's invalid - and returns anything wrong between it and the others. */
	check: () => Promise<string[]>;
}

export interface ConfigCheckResult {
	file: string;
	problems: string[];
}

const loads = (load: () => Promise<unknown>) => async () => {
	await load();
	return [];
};

export const CONFIG_CHECKS: ConfigCheck[] = [
	{
		file: 'reference-data.yaml',
		check: loads(() => import('@pins/identify-consultees-database/src/seed/reference-data.ts'))
	},
	{
		file: 'rulesets/',
		check: async () =>
			(await import('@pins/identify-consultees-database/src/geospatial/rulesets.ts')).rulesetCategoryProblems()
	},
	{
		file: 'report.yaml',
		check: async () => (await import('./report-config.ts')).summaryLabelProblems()
	},
	{
		file: 'nearby-consultees.yaml',
		check: loads(async () => (await import('./nearby-consultees.ts')).loadNearbyConsultees())
	},
	{
		file: 'screening.yaml',
		check: loads(async () => (await import('./screening-config.ts')).loadScreeningConfig())
	},
	{ file: 'map-view.yaml', check: loads(() => import('./maps/map-view.ts')) },
	{ file: 'map-styles/boundary-map.yaml', check: loads(() => import('./maps/boundary-map-styles.ts')) }
];

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Each check's file and what's wrong with it - nothing, normally. A file that reads another (the
 * report reads the reference data's groups) fails with that file's error; it's reported once, at
 * the file it's about, and the files after say they can't be checked until it's fixed.
 */
export async function checkConfig(checks: ConfigCheck[] = CONFIG_CHECKS): Promise<ConfigCheckResult[]> {
	const reported = new Set<string>();
	const results: ConfigCheckResult[] = [];
	for (const { file, check } of checks) {
		try {
			results.push({ file, problems: await check() });
		} catch (error) {
			const message = describe(error);
			results.push({
				file,
				problems: [reported.has(message) ? "can't be checked until the file above is put right" : message]
			});
			reported.add(message);
		}
	}
	return results;
}
