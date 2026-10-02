import { copyFile, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

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
	'map-key-plugin/css': path.join(defraInteractiveMapRoot, 'plugins', 'map-key', 'dist', 'css')
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
