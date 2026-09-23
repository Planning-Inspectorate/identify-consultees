import type { ManageService } from '#service';
import { addLocalsConfiguration } from '#util/config-middleware.ts';
import { createBaseApp } from '@planning-inspectorate/core/app';
import type { Express } from 'express';
import { configureNunjucks } from './nunjucks.ts';
import { buildRouter } from './router.ts';

const OPENFREEMAP_ORIGIN = 'https://tiles.openfreemap.org';

/**
 * CSP defaults extended for Defra Interactive Map + OpenFreeMap
 * (same widenings as PINS-data-spike map pages).
 */
const mapAwareCspDirectives = {
	scriptSrc: ["'self'", (req: unknown, res: { locals?: { cspNonce?: string } }) => `'nonce-${res.locals?.cspNonce}'`],
	defaultSrc: ["'self'"],
	connectSrc: ["'self'", OPENFREEMAP_ORIGIN],
	fontSrc: ["'self'", OPENFREEMAP_ORIGIN],
	imgSrc: ["'self'", 'data:', OPENFREEMAP_ORIGIN],
	styleSrc: ["'self'", "'unsafe-inline'"],
	workerSrc: ["'self'", 'blob:']
};

export function createApp(service: ManageService): Express {
	const router = buildRouter(service);
	return createBaseApp({
		service,
		configureNunjucks,
		router,
		middlewares: [addLocalsConfiguration()],
		cspDirectives: mapAwareCspDirectives
	});
}
