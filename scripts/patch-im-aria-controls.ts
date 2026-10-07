/**
 * Patch Defra Interactive Map's viewport `aria-controls` so it resolves to the
 * always-mounted spatial listbox (`#<id>-spatial-list`) instead of the removed
 * `#<id>-features` element.
 *
 * `@defra/interactive-map` ≥ 0.0.44-alpha replaced the `Features` component
 * (`id="<id>-features"`) with `SpatialList` (`id="<id>-spatial-list"`) but left
 * `Viewport`'s `aria-controls` pointing at the old id — axe flags it as a
 * critical `aria-valid-attr-value` violation (WCAG 4.1.2). Still unfixed in
 * 0.0.51-apha; remove this patch once upstream corrects it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Minified viewport attribute from `@defra/interactive-map` 0.0.44+ (dangling idref). */
export const VULNERABLE_ARIA_CONTROLS = /"aria-controls":""\.concat\(([A-Za-z_$][\w$]*),"-features"\)/;

/** Same attribute pointing at the always-mounted SpatialList element. */
export const PATCHED_ARIA_CONTROLS = /"aria-controls":""\.concat\(([A-Za-z_$][\w$]*),"-spatial-list"\)/;

/**
 * Apply the aria-controls fix to a JS source string.
 *
 * @param source - Bundle or fixture source
 * @returns Patched source and whether a change was made
 */
export function applyImAriaControlsPatch(source: string): {
	source: string;
	changed: boolean;
	alreadyPatched: boolean;
} {
	if (PATCHED_ARIA_CONTROLS.test(source)) {
		return { source, changed: false, alreadyPatched: true };
	}
	const match = VULNERABLE_ARIA_CONTROLS.exec(source);
	if (!match) {
		throw new Error(
			'Interactive map aria-controls patch: expected dangling "-features" idref was not found (Defra bundle may have changed or fixed this upstream — review whether this patch is still needed).'
		);
	}
	return {
		source: source.replace(VULNERABLE_ARIA_CONTROLS, `"aria-controls":"".concat(${match[1]},"-spatial-list")`),
		changed: true,
		alreadyPatched: false
	};
}

/**
 * Absolute paths to the Defra core bundles inside node_modules. The UMD build is
 * what browsers load via `/vendor/interactive-map/js`; the ESM build is patched
 * too so any future bundling path gets the same fix.
 *
 * @param packageRoot - Repo root (defaults to this package)
 * @returns Absolute paths to the `im-core.js` bundles
 */
export function defraImCorePaths(packageRoot = process.cwd()): string[] {
	return ['umd', 'esm'].map((format) =>
		path.join(packageRoot, 'node_modules', '@defra', 'interactive-map', 'dist', format, 'im-core.js')
	);
}

/**
 * Patch an on-disk Defra core bundle if needed.
 *
 * @param filePath - Path to an `im-core.js` bundle
 * @param options - Optional behaviour flags
 * @param options.log - When `true`, print patch status to stdout (CLI use)
 * @returns Whether the file was rewritten
 */
export function patchDefraImCoreFile(filePath: string, options: { log?: boolean } = {}): boolean {
	const log = options.log === true;
	const original = fs.readFileSync(filePath, 'utf8');
	const { source, changed, alreadyPatched } = applyImAriaControlsPatch(original);
	if (alreadyPatched) {
		if (log) {
			console.log(`Interactive map aria-controls already patched: ${filePath}`);
		}
		return false;
	}
	if (changed) {
		fs.writeFileSync(filePath, source);
		if (log) {
			console.log(`Patched viewport aria-controls to "#<id>-spatial-list": ${filePath}`);
		}
	}
	return changed;
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
	const targets = defraImCorePaths().filter((target) => fs.existsSync(target));
	if (targets.length === 0) {
		// this postinstall hook runs for every npm ci, including workspace-scoped ones
		// (e.g. `npm ci --workspace=@pins/identify-consultees-database` in the Migrate
		// deploy job) that never install apps/manage's own dependencies - nothing to patch
		console.log('Interactive map aria-controls patch: @defra/interactive-map not installed here, skipping.');
		process.exit(0);
	}
	for (const target of targets) {
		patchDefraImCoreFile(target, { log: true });
	}
}
