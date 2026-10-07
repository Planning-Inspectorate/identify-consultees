import { eslintConfig } from '@planning-inspectorate/coding-standards';
import { defineConfig } from 'eslint/config';
import globals from 'globals';

export default defineConfig([
	{
		// Python app, not JS/TS - its local .venv (present after local setup, see its README)
		// contains vendored JS files that ESLint would otherwise try to lint.
		// vendor/ holds vendored third-party code (see vendor/README.md) - not our style rules
		ignores: ['apps/function-python/**', 'vendor/**']
	},
	eslintConfig,
	{
		files: ['apps/manage/src/public/javascripts/**/*.{js,mjs}'],
		languageOptions: {
			globals: {
				...globals.browser
			}
		}
	}
]);
