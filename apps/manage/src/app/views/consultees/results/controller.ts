import type { ManageService } from '#service';
import type { AsyncRequestHandler } from '@planning-inspectorate/core/util';
import { findDummyGeometry, findRulesetLabel } from '../../../data/dummy-geometries.ts';
import {
	buildConsulteeAreaGeojson,
	buildProjectSiteGeojson,
	MAP_VIEWPORT,
	mapViewForCollections
} from '../../../maps/sample-geojson.ts';
import { buildStaticMapSvg } from '../../../maps/static-map-svg.ts';
import type { ConsulteeMapSection, ConsulteesResultsViewModel } from './view-model.ts';

type SectionDefinition = {
	id: string;
	heading: string;
	distanceLabel: string;
	consultees: string[];
	areas: { name: string; code: string; offsetLng: number; offsetLat: number; size: number }[];
};

const SECTION_DEFINITIONS: SectionDefinition[] = [
	{
		id: 'ambulance-trusts',
		heading: 'Ambulance Trusts (within 1km of the site)',
		distanceLabel: 'Ambulance Trust within 1km of the project site',
		consultees: ['South Central Ambulance Service', 'South Western Ambulance Service'],
		areas: [
			{ name: 'South Central Ambulance Service', code: 'SCAS', offsetLng: -0.08, offsetLat: 0.05, size: 0.06 },
			{ name: 'South Western Ambulance Service', code: 'SWAS', offsetLng: 0.07, offsetLat: -0.04, size: 0.055 }
		]
	},
	{
		id: 'police-force-areas',
		heading: 'Police Force Areas (within 10km of the site)',
		distanceLabel: 'Police Force Area within 10km of the project site',
		consultees: ['Dorset Police', 'Hampshire and Isle of Wight Constabulary'],
		areas: [
			{ name: 'Dorset Police', code: 'DOR', offsetLng: -0.12, offsetLat: 0.02, size: 0.09 },
			{ name: 'Hampshire and Isle of Wight Constabulary', code: 'HIOW', offsetLng: 0.1, offsetLat: 0.06, size: 0.08 }
		]
	},
	{
		id: 'fire-rescue',
		heading: 'Fire and Rescue Authorities (within 10km of the site)',
		distanceLabel: 'Fire and Rescue Authority within 10km of the project site',
		consultees: ['Dorset and Wiltshire Fire and Rescue Service', 'Hampshire and Isle of Wight Fire and Rescue Service'],
		areas: [
			{
				name: 'Dorset and Wiltshire Fire and Rescue Service',
				code: 'DWFRS',
				offsetLng: -0.05,
				offsetLat: 0.08,
				size: 0.07
			},
			{
				name: 'Hampshire and Isle of Wight Fire and Rescue Service',
				code: 'HIOWFRS',
				offsetLng: 0.09,
				offsetLat: -0.06,
				size: 0.07
			}
		]
	}
];

function firstQueryValue(value: unknown): string {
	if (Array.isArray(value)) {
		return typeof value[0] === 'string' ? value[0] : '';
	}
	return typeof value === 'string' ? value : '';
}

function buildSectionAssets(definition: SectionDefinition, reference: string, caseName: string, geometryId: string) {
	const projectGeojson = buildProjectSiteGeojson(reference, caseName);
	const consulteeGeojson = buildConsulteeAreaGeojson(definition.distanceLabel, definition.areas);
	const view = mapViewForCollections(projectGeojson, consulteeGeojson);
	const mapLabel = `${definition.distanceLabel} for ${caseName} (${reference})`;
	const staticSvg = buildStaticMapSvg({
		center: view.center,
		zoom: view.zoom,
		projectGeojson,
		consulteeGeojson
	});

	const mapConfig = {
		center: view.center,
		zoom: view.zoom,
		width: MAP_VIEWPORT.width,
		height: MAP_VIEWPORT.height,
		mapLabel,
		projectLayerLabel: `Project site (${reference})`,
		consulteeLayerLabel: definition.distanceLabel,
		projectGeojson,
		consulteeGeojson
	};

	const section: ConsulteeMapSection = {
		id: definition.id,
		heading: definition.heading,
		mapTitle: mapLabel,
		mapRegionLabel: mapLabel,
		consultees: definition.consultees,
		staticMapSrc: `/consultees/${encodeURIComponent(geometryId)}/sections/${definition.id}/static-map.svg`,
		staticMapAlt: `Static map showing ${mapLabel}`,
		mapWidth: MAP_VIEWPORT.width,
		mapHeight: MAP_VIEWPORT.height,
		mapConfigJson: JSON.stringify(mapConfig)
	};

	return { section, staticSvg };
}

export function buildConsulteesResultsPage(service: ManageService): AsyncRequestHandler {
	const { logger } = service;

	return async (req, res) => {
		const geometryId = String(req.params.geometryId ?? '');
		const geometry = findDummyGeometry(geometryId);

		if (!geometry) {
			res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
			return;
		}

		const ruleset = firstQueryValue(req.query.ruleset) || 'post-30-apr-2024-england-wales';
		const rulesetLabel = findRulesetLabel(ruleset);
		logger.info({ geometryId, reference: geometry.reference }, 'consultees results page');

		const sections = SECTION_DEFINITIONS.map(
			(definition) => buildSectionAssets(definition, geometry.reference, geometry.caseName, geometry.id).section
		);

		const viewModel: ConsulteesResultsViewModel = {
			pageHeading: `Consultees identified for ${geometry.caseName} (${geometry.reference})`,
			backLinkUrl: '/',
			backLinkText: 'Back to project geometry search',
			rulesetLabel,
			reference: geometry.reference,
			caseName: geometry.caseName,
			geometryId: geometry.id,
			downloadSummaryHref: '#',
			downloadMapsHref: '#',
			sections
		};

		return res.render('views/consultees/results/view.njk', viewModel);
	};
}

export function buildSectionStaticMap(service: ManageService): AsyncRequestHandler {
	const { logger } = service;

	return async (req, res) => {
		const geometryId = String(req.params.geometryId ?? '');
		const sectionId = String(req.params.sectionId ?? '');
		const geometry = findDummyGeometry(geometryId);
		const definition = SECTION_DEFINITIONS.find((section) => section.id === sectionId);

		if (!geometry || !definition) {
			res.status(404).type('text/plain').send('Not found');
			return;
		}

		logger.debug({ geometryId, sectionId }, 'serving static consultee map svg');
		const { staticSvg } = buildSectionAssets(definition, geometry.reference, geometry.caseName, geometry.id);

		res.status(200).type('image/svg+xml').set('Cache-Control', 'public, max-age=300').send(staticSvg);
	};
}
