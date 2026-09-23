import type { IRouter } from 'express';
import express, { Router as createRouter } from 'express';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
// resolve() points at dist/umd/index.js — walk up to the package root
const defraInteractiveMapRoot = path.resolve(path.dirname(require.resolve('@defra/interactive-map')), '../..');

const DEFRA_VENDOR_ROOTS: Readonly<Record<string, string>> = {
	'interactive-map/js': path.join(defraInteractiveMapRoot, 'dist', 'umd'),
	'interactive-map/css': path.join(defraInteractiveMapRoot, 'dist', 'css'),
	'maplibre-provider/js': path.join(defraInteractiveMapRoot, 'providers', 'maplibre', 'dist', 'umd'),
	'datasets-plugin/js': path.join(defraInteractiveMapRoot, 'plugins', 'datasets', 'dist', 'umd'),
	'datasets-plugin/css': path.join(defraInteractiveMapRoot, 'plugins', 'datasets', 'dist', 'css'),
	'map-key-plugin/js': path.join(defraInteractiveMapRoot, 'plugins', 'map-key', 'dist', 'umd'),
	'map-key-plugin/css': path.join(defraInteractiveMapRoot, 'plugins', 'map-key', 'dist', 'css')
};

/**
 * Serve Defra Interactive Map UMD/CSS assets from node_modules
 * (same pattern as PINS-data-spike vendor mounts).
 */
export function createDefraVendorRouter(): IRouter {
	const router = createRouter();

	for (const [prefix, root] of Object.entries(DEFRA_VENDOR_ROOTS)) {
		router.use(`/vendor/${prefix}`, express.static(root, { index: false, fallthrough: false }));
	}

	return router;
}
