import type { ManageService } from '#service';
import { listConsulteeAreas } from '@pins/identify-consultees-database/src/geospatial/consultee-areas.ts';
import type { AsyncRequestHandler } from '@planning-inspectorate/core/util';
import type { ConsulteeAreasDirectViewModel } from './view-model.ts';

const VIEW = 'views/consultee-areas-direct/view.njk';
const PAGE_HEADING = 'Consultee areas (direct database query)';

export function buildConsulteeAreasDirectPage(): AsyncRequestHandler {
	return async (req, res) => {
		const viewModel: ConsulteeAreasDirectViewModel = { pageHeading: PAGE_HEADING };
		return res.render(VIEW, viewModel);
	};
}

export function buildRunConsulteeAreasDirect(service: ManageService): AsyncRequestHandler {
	const { db, logger } = service;
	return async (req, res) => {
		const viewModel: ConsulteeAreasDirectViewModel = { pageHeading: PAGE_HEADING };

		try {
			const { features } = await listConsulteeAreas(db, { limit: 50 });
			viewModel.rows = features;
		} catch (error) {
			logger.error({ error }, 'Failed to query consultee areas directly');
			viewModel.error = 'Could not query the database directly.';
		}

		return res.render(VIEW, viewModel);
	};
}
