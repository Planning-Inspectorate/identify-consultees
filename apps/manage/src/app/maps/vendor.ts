import { DEFRA_VENDOR_ROOTS } from '#util/vendor-assets.ts';
import type { IRouter } from 'express';
import express, { Router as createRouter } from 'express';

export type DefraVendorRouterOptions = {
	/**
	 * Cache lifetime for the un-fingerprinted files under each mount (webpack
	 * lazy chunks, LICENSE files). Entry points (index.js / index.css) are
	 * fingerprinted copies in the static dir and are served by the static-assets
	 * middleware with an immutable lifetime instead — these URLs must stay
	 * un-immutable because their names do not change between releases.
	 */
	maxAge?: string | number;
};

/**
 * Serve Defra Interactive Map UMD/CSS assets from node_modules
 * (same pattern as PINS-data-spike vendor mounts).
 */
export function createDefraVendorRouter(options: DefraVendorRouterOptions = {}): IRouter {
	const router = createRouter();

	for (const [prefix, root] of Object.entries(DEFRA_VENDOR_ROOTS)) {
		router.use(`/vendor/${prefix}`, express.static(root, { index: false, fallthrough: false, maxAge: options.maxAge }));
	}

	return router;
}
