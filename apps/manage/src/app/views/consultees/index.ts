import type { ManageService } from '#service';
import { asyncHandler } from '@planning-inspectorate/core/util';
import type { IRouter } from 'express';
import { Router as createRouter } from 'express';
import { buildConsulteesResultsPage, buildSectionStaticMap } from './results/controller.ts';

function firstQueryValue(value: unknown): string {
	if (Array.isArray(value)) {
		return typeof value[0] === 'string' ? value[0] : '';
	}
	return typeof value === 'string' ? value : '';
}

export function createRoutes(service: ManageService): IRouter {
	const router = createRouter({ mergeParams: true });
	const resultsPage = buildConsulteesResultsPage(service);
	const staticMap = buildSectionStaticMap(service);

	router.get('/', (req, res) => {
		const geometryId = firstQueryValue(req.query.geometryId);
		if (!geometryId) {
			res.redirect('/');
			return;
		}

		const ruleset = firstQueryValue(req.query.ruleset);
		const query = new URLSearchParams();
		if (ruleset) {
			query.set('ruleset', ruleset);
		}
		const suffix = query.toString() ? `?${query.toString()}` : '';
		res.redirect(`/consultees/${encodeURIComponent(geometryId)}${suffix}`);
	});

	router.get('/:geometryId/sections/:sectionId/static-map.svg', asyncHandler(staticMap));
	router.get('/:geometryId', asyncHandler(resultsPage));

	return router;
}
