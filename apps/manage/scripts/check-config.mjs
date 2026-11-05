/**
 * `npm run check-config`: checks every file in config/ as the app will load it, and says what's
 * wrong - see src/app/config-check.ts. Exits 1 if anything is.
 */
import { checkConfig } from '../src/app/config-check.ts';

const results = await checkConfig();
for (const { file, problems } of results) {
	console.log(`${problems.length === 0 ? '✔' : '✖'} config/${file}`);
	for (const problem of problems) {
		console.log(`    ${problem}`);
	}
}
const failed = results.filter(({ problems }) => problems.length > 0).length;
console.log(failed === 0 ? '\nThe config is valid.' : `\n${failed} of ${results.length} need putting right.`);
process.exitCode = failed === 0 ? 0 : 1;
