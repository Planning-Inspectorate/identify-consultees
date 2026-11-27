import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { compressFileToSidecars, shouldCompress } from './fingerprint-assets.ts';

const require = createRequire(import.meta.url);
// resolve() points at dist/umd/index.js — walk up to the package root
const defraInteractiveMapRoot = path.resolve(path.dirname(require.resolve('@defra/interactive-map')), '../..');

/**
 * node_modules roots for the Defra Interactive Map vendor bundles,
 * keyed by their public path under /vendor.
 * (same pattern as PINS-data-spike vendor mounts)
 */
export const DEFRA_VENDOR_ROOTS: Readonly<Record<string, string>> = {
	'interactive-map/js': path.join(defraInteractiveMapRoot, 'dist', 'umd'),
	'interactive-map/css': path.join(defraInteractiveMapRoot, 'dist', 'css'),
	'maplibre-provider/js': path.join(defraInteractiveMapRoot, 'providers', 'maplibre', 'dist', 'umd'),
	'datasets-plugin/js': path.join(defraInteractiveMapRoot, 'plugins', 'datasets', 'dist', 'umd'),
	'datasets-plugin/css': path.join(defraInteractiveMapRoot, 'plugins', 'datasets', 'dist', 'css'),
	'map-key-plugin/js': path.join(defraInteractiveMapRoot, 'plugins', 'map-key', 'dist', 'umd'),
	'map-key-plugin/css': path.join(defraInteractiveMapRoot, 'plugins', 'map-key', 'dist', 'css'),
	'interact-plugin/js': path.join(defraInteractiveMapRoot, 'plugins', 'interact', 'dist', 'umd'),
	'draw-plugin/js': path.join(defraInteractiveMapRoot, 'plugins', 'draw', 'dist', 'umd'),
	// beta plugin: API may shift between package versions
	'map-styles-plugin/js': path.join(defraInteractiveMapRoot, 'plugins', 'beta', 'map-styles', 'dist', 'umd'),
	'map-styles-plugin/css': path.join(defraInteractiveMapRoot, 'plugins', 'beta', 'map-styles', 'dist', 'css')
};

/**
 * Copy each vendor bundle's entry point (index.js / index.css) into the static
 * dir under its public /vendor path so the fingerprint pipeline renames it and
 * the static-assets middleware serves it with immutable caching.
 *
 * Only the entry files are copied: webpack lazy chunks are referenced by literal
 * filename inside the bundle, so they keep stable names and continue to be served
 * by the vendor express.static mounts under the same /vendor URL space.
 */
export async function copyDefraVendorEntryAssets(staticDir: string): Promise<void> {
	const vendorDir = path.join(staticDir, 'vendor');
	// clear stale fingerprinted entry files from previous builds
	await rm(vendorDir, { recursive: true, force: true });
	for (const [prefix, root] of Object.entries(DEFRA_VENDOR_ROOTS)) {
		const entryFile = prefix.endsWith('/js') ? 'index.js' : 'index.css';
		const destination = path.join(vendorDir, ...prefix.split('/'), entryFile);
		await mkdir(path.dirname(destination), { recursive: true });
		await copyFile(path.join(root, entryFile), destination);
	}
}

/** Files this small compress to little gain — not worth a br/gz variant. */
const MIN_SIDECAR_BYTES = 1024;
/** Bound parallel encodes so the multi-MB chunks don't pile into memory at once. */
const SIDECAR_WRITE_CONCURRENCY = 8;

/**
 * Write `.br`/`.gz` sidecars next to every compressible vendor file in
 * node_modules (the webpack lazy chunks the /vendor mounts serve). Sidecars
 * live beside the file they compress on purpose: a @defra/interactive-map
 * update replaces the package directory wholesale, so a stale sidecar can
 * never outlive its source. `compressFileToSidecars` keeps fresh sidecars,
 * so unchanged packages cost nothing on a rebuild.
 */
export async function writeVendorCompressionSidecars(
	roots: Readonly<Record<string, string>> = DEFRA_VENDOR_ROOTS
): Promise<void> {
	// Lazy-load so runtime importers of DEFRA_VENDOR_ROOTS (maps/vendor) do not
	// pull esbuild into the pruned production image.
	const { minifyVendorChunkInPlace } = await import('./minify-assets.ts');
	for (const root of Object.values(roots)) {
		const compressible = (await readdir(root, { recursive: true, withFileTypes: true }))
			.filter((entry) => entry.isFile() && shouldCompress(entry.name))
			.map((entry) => path.join(entry.parentPath, entry.name));
		for (let index = 0; index < compressible.length; index += SIDECAR_WRITE_CONCURRENCY) {
			await Promise.all(
				compressible.slice(index, index + SIDECAR_WRITE_CONCURRENCY).map(async (filePath) => {
					const base = path.basename(filePath);
					// minify webpack lazy chunks in place only — entry index.* is
					// already minified via the fingerprint pipeline after copy
					if (!/^index\.(js|css)$/i.test(base) && /\.(js|mjs|css)$/i.test(base)) {
						const source = await readFile(filePath, 'utf8');
						const minified = minifyVendorChunkInPlace(source, filePath);
						if (minified) {
							await writeFile(filePath, minified, 'utf8');
						}
					}
					if ((await stat(filePath)).size >= MIN_SIDECAR_BYTES) {
						await compressFileToSidecars(filePath);
					}
				})
			);
		}
	}
}
