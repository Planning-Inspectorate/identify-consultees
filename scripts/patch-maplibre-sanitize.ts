/**
 * Patch Defra Interactive Map's bundled MapLibre `DOM.removeAttributes` so it
 * matches the CVE-2026-85061 / GHSA-jrc7-96c5-q579 fix (iterate a static copy
 * of attributes, not the live NamedNodeMap).
 *
 * `@defra/interactive-map` vendors MapLibre inside
 * `providers/maplibre/dist/umd/im-maplibre-framework.js`. An npm `overrides`
 * entry upgrades the lockfile copy for Dependabot, but the browser loads this
 * prebuilt UMD — so the bundle must be patched after install.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Vulnerable minified loop from MapLibre ≤ 6.4.0 (live `NamedNodeMap`). */
export const VULNERABLE_REMOVE_ATTRIBUTES =
	'static removeAttributes(t){for(const{name:e,value:i}of t.attributes)d.isPossiblyDangerous(e,i)&&t.removeAttribute(e)}';

/** Same loop with `Array.from(...)`, matching maplibre-gl ≥ 6.4.1. */
export const PATCHED_REMOVE_ATTRIBUTES =
	'static removeAttributes(t){for(const{name:e,value:i}of Array.from(t.attributes))d.isPossiblyDangerous(e,i)&&t.removeAttribute(e)}';

/**
 * Apply the sanitize fix to a JS source string.
 *
 * @param source - Bundle or fixture source
 * @returns Patched source and whether a change was made
 */
export function applyMaplibreSanitizePatch(source: string): {
	source: string;
	changed: boolean;
	alreadyPatched: boolean;
} {
	if (source.includes(PATCHED_REMOVE_ATTRIBUTES)) {
		return { source, changed: false, alreadyPatched: true };
	}
	if (!source.includes(VULNERABLE_REMOVE_ATTRIBUTES)) {
		throw new Error(
			'MapLibre sanitize patch: expected vulnerable removeAttributes pattern was not found (Defra UMD may have changed).'
		);
	}
	return {
		source: source.replace(VULNERABLE_REMOVE_ATTRIBUTES, PATCHED_REMOVE_ATTRIBUTES),
		changed: true,
		alreadyPatched: false
	};
}

/**
 * Absolute path to Defra's MapLibre framework UMD inside node_modules.
 *
 * @param packageRoot - Repo root (defaults to this package)
 * @returns Absolute path to `im-maplibre-framework.js`
 */
export function defraMaplibreFrameworkPath(packageRoot = process.cwd()): string {
	return path.join(
		packageRoot,
		'node_modules',
		'@defra',
		'interactive-map',
		'providers',
		'maplibre',
		'dist',
		'umd',
		'im-maplibre-framework.js'
	);
}

/**
 * Patch the on-disk Defra MapLibre framework UMD if needed.
 *
 * @param filePath - Path to `im-maplibre-framework.js`
 * @param options - Optional behaviour flags
 * @param options.log - When `true`, print patch status to stdout (CLI use)
 * @returns Whether the file was rewritten
 */
export function patchDefraMaplibreFrameworkFile(filePath: string, options: { log?: boolean } = {}): boolean {
	const log = options.log === true;
	const original = fs.readFileSync(filePath, 'utf8');
	const { source, changed, alreadyPatched } = applyMaplibreSanitizePatch(original);
	if (alreadyPatched) {
		if (log) {
			console.log(`MapLibre sanitize already patched: ${filePath}`);
		}
		return false;
	}
	if (changed) {
		fs.writeFileSync(filePath, source);
		if (log) {
			console.log(`Patched MapLibre sanitize (CVE-2026-85061): ${filePath}`);
		}
	}
	return changed;
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
	const target = defraMaplibreFrameworkPath();
	if (!fs.existsSync(target)) {
		console.error(`MapLibre sanitize patch: missing ${target} (run npm ci first).`);
		process.exit(1);
	}
	patchDefraMaplibreFrameworkFile(target, { log: true });
}
