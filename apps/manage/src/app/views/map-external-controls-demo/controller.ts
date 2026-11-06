import { stringifyForInlineScript } from '#util/inline-json.ts';
import type { AsyncRequestHandler, AsyncRequestHandlerWithBody } from '@planning-inspectorate/core/util';
import { recencyRanks, styleForRank } from '../../maps/boundary-map-styles.ts';
import { buildBoundaryMapConfig } from '../../maps/boundary-map.ts';
import type { ExternalControlsConfig, ExternalControlsConfigOptions } from '../../maps/external-controls-config.ts';
import { buildExternalControlsConfig } from '../../maps/external-controls-config.ts';
import {
	buildExternalControlsDemoFiles,
	EXTERNAL_CONTROLS_DEMO_CASE_NAME,
	EXTERNAL_CONTROLS_DEMO_CASE_REFERENCE
} from '../../maps/external-controls-demo-geojson.ts';
import { computeFittedMapView } from '../../maps/geometry-bounds.ts';
import { MAP_VIEW } from '../../maps/map-view.ts';
import type { GeoJsonFeatureCollection } from '../../maps/sample-geojson.ts';
import { MAP_VIEWPORT } from '../../maps/sample-geojson.ts';
import { buildConsulteeStaticMapResponse, sendStaticMapResponse } from '../../maps/serve-static-map.ts';
import { formatUploadedAt } from '../consultees/project/format-uploaded.ts';
import { firstQueryValue } from '../consultees/run-ruleset.ts';
import type { ExternalControlsDemoRadio, MapExternalControlsDemoViewModel } from './view-model.ts';

export const MAP_EXTERNAL_CONTROLS_DEMO_PATH = '/map-external-controls-demo';

const SECTION_DEFS: {
	slug: string;
	title: string;
	description: string;
	controls: Omit<ExternalControlsConfigOptions, 'control'>;
}[] = [
	{
		slug: 'select-shared',
		title: 'Selection ring, shared controls',
		description:
			'Picking a radio draws the map’s selection ring around that file’s shape; clicking a shape on the map checks its radio. ' +
			'Every file stays in the Layers menu too — neither control is primary (primaryControl: "shared").',
		controls: { emphasis: 'select', primaryControl: 'shared' }
	},
	{
		slug: 'solo-external',
		title: 'Solo emphasis, external radios as the primary control',
		description:
			'The radios are the only per-file control: the bound datasets are removed from the Layers menu ' +
			'(primaryControl: "external") and picking one hides the rest (emphasis: "solo").',
		controls: { emphasis: 'solo', primaryControl: 'external' }
	},
	{
		slug: 'dim-zoom',
		title: 'Dim the rest, zoom to the pick',
		description:
			'Picking a radio fades the other files to a faint tint (emphasis: "dim", dimOpacity) and the map ' +
			'zooms to the chosen shape (zoomTo: "always"). The Layers menu still lists every file.',
		controls: { emphasis: 'dim', primaryControl: 'shared', zoomTo: 'always' }
	}
];

/** The section's details panel shows the exact `externalControls` block its map received. */
function configSnippet(controls: ExternalControlsConfig): string {
	return JSON.stringify(controls, null, 2);
}

/** An unrecognised ?mode= (or post `demo` slug) falls back to the first configuration. */
function sectionForSlug(slug: string | undefined) {
	return SECTION_DEFS.find((section) => section.slug === slug) ?? SECTION_DEFS[0];
}

function demoViewModel(modeSlug?: string, posted?: { slug: string; value: string }): MapExternalControlsDemoViewModel {
	const files = buildExternalControlsDemoFiles();
	const section = sectionForSlug(modeSlug);
	const submittedFile = files.find((file) => file.id === posted?.value);
	const submittedSection = SECTION_DEFS.find((def) => def.slug === posted?.slug);
	const showSubmittedState = submittedFile && submittedSection;
	// an unanswered submit mirrors the real page's error - but only when the section resolves;
	// a bogus `demo` value can't be pointed at, so it falls through to a clean render
	const errored = posted && submittedSection && !submittedFile;

	const mapId = `map-external-controls-demo-${section.slug}`;
	const formId = `form-${section.slug}`;
	const externalControls = buildExternalControlsConfig(files, {
		// scoped to this page's form - one bound map per page
		control: `#${formId} input[name="shapefile"]`,
		...section.controls
	});
	const mapConfig = {
		...buildBoundaryMapConfig(EXTERNAL_CONTROLS_DEMO_CASE_NAME, EXTERNAL_CONTROLS_DEMO_CASE_REFERENCE, files, {
			src: `${MAP_EXTERNAL_CONTROLS_DEMO_PATH}/static-map`,
			alt: `Static map showing the fictional boundary files for ${EXTERNAL_CONTROLS_DEMO_CASE_NAME}`
		}),
		detailsPanelId: `details-${section.slug}`,
		externalControls
	};

	return {
		pageHeading: 'External controls demo',
		pageCaption: `${EXTERNAL_CONTROLS_DEMO_CASE_NAME} (${EXTERNAL_CONTROLS_DEMO_CASE_REFERENCE})`,
		mapWidth: MAP_VIEWPORT.width,
		mapHeight: MAP_VIEWPORT.height,
		section: {
			slug: section.slug,
			title: section.title,
			description: section.description,
			mapId,
			mapRegionLabel: `Map showing the fictional boundary files for ${EXTERNAL_CONTROLS_DEMO_CASE_NAME} (${section.title})`,
			staticMapSrc: `${MAP_EXTERNAL_CONTROLS_DEMO_PATH}/static-map`,
			staticMapAlt: `Static map showing the fictional boundary files for ${EXTERNAL_CONTROLS_DEMO_CASE_NAME}`,
			mapConfigJson: stringifyForInlineScript(mapConfig),
			configSnippet: configSnippet(externalControls),
			formId,
			radiosIdPrefix: `shapefile-${section.slug}`,
			radioItems: files.map((file): ExternalControlsDemoRadio => {
				const checked =
					(section.slug === 'select-shared' && !posted && file.id === 'demo-earlier-boundary') ||
					(section.slug === posted?.slug && file.id === posted?.value);
				return {
					value: file.id,
					text: file.label,
					...(file.receivedDate ? { hint: { text: `Uploaded: ${formatUploadedAt(file.receivedDate)}` } } : {}),
					...(checked ? { checked: true } : {})
				};
			}),
			...(errored ? { radiosError: { text: 'Select a shapefile' } } : {}),
			...(showSubmittedState ? { submittedValue: submittedFile.id } : {})
		},
		modes: SECTION_DEFS.map((def) => ({
			slug: def.slug,
			label: def.title,
			href: `${MAP_EXTERNAL_CONTROLS_DEMO_PATH}?mode=${def.slug}`,
			current: def.slug === section.slug
		})),
		...(showSubmittedState
			? {
					submittedBanner: `“${submittedSection.title}” submitted “${submittedFile.label}” — the radios are ordinary form fields and post like any other input.`
				}
			: {}),
		...(errored ? { errorSummary: [{ text: 'Select a shapefile', href: `#shapefile-${section.slug}` }] } : {})
	};
}

/**
 * Localhost-only demo of the external-controls plugin (public/javascripts/external-controls-plugin.mjs):
 * the boundary page's "Confirm shapefile for report" radios bound two ways to a Defra map, in three
 * plugin configurations on fictional data. One map per page - ?mode= picks the configuration - because
 * the datasets plugin's registry and layer adapter are module-level singletons: two interactive maps on
 * one page would share them (a Layers-menu toggle can apply to the wrong map). See kt-docs/maps.md.
 */
export function buildMapExternalControlsDemoPage(): AsyncRequestHandler {
	return async (req, res) => {
		res.render('views/map-external-controls-demo/view.njk', demoViewModel(firstQueryValue(req.query?.mode)));
	};
}

/**
 * Each demo section is a working form: Continue posts `shapefile` like the real boundary page, and
 * the re-rendered banner proves the radios submit normally. An unanswered submit re-renders that
 * section's radios with the same "Select a shapefile" error the real page raises.
 */
export function buildMapExternalControlsDemoSubmit(): AsyncRequestHandlerWithBody<{
	demo?: unknown;
	shapefile?: unknown;
}> {
	return async (req, res) => {
		const slug = firstQueryValue(req.body?.demo);
		res.render(
			'views/map-external-controls-demo/view.njk',
			demoViewModel(slug, { slug, value: firstQueryValue(req.body?.shapefile) })
		);
	};
}

/**
 * The page's noscript/init-failure image shows the same fictional file set, drawn with
 * the real boundary styles (newest red, earlier files dashed). Fictional data, so sharedCache.
 */
export function buildDemoStaticMap(forceSvg = false): AsyncRequestHandler {
	return async (req, res) => {
		const files = buildExternalControlsDemoFiles();
		const ranks = recencyRanks(files.map((file) => file.receivedDate));
		// oldest first, so the most recent file draws over the rest
		const order = files.map((_file, index) => index).sort((a, b) => ranks[b] - ranks[a]);
		const projectGeojson: GeoJsonFeatureCollection = {
			type: 'FeatureCollection',
			features: order.map((index) => {
				const file = files[index];
				const style = styleForRank(ranks[index]);
				return {
					type: 'Feature' as const,
					id: file.id,
					properties: {
						name: file.label,
						reference: EXTERNAL_CONTROLS_DEMO_CASE_REFERENCE,
						colour: style.colour,
						fillOpacity: String(style.fillOpacity)
					},
					geometry: file.geometry
				};
			})
		};
		const view = computeFittedMapView(projectGeojson, MAP_VIEWPORT, MAP_VIEW.boundaryMapMarginMetres);
		const image = await buildConsulteeStaticMapResponse({
			geometryId: 'map-external-controls-demo',
			sectionId: 'external-controls',
			sharedCache: true,
			map: {
				center: view.center,
				zoom: view.zoom,
				projectGeojson,
				consulteeGeojson: { type: 'FeatureCollection', features: [] },
				width: MAP_VIEWPORT.width,
				height: MAP_VIEWPORT.height,
				title: `Fictional boundary files for ${EXTERNAL_CONTROLS_DEMO_CASE_NAME}`
			},
			forceSvg,
			ifNoneMatch: typeof req.headers['if-none-match'] === 'string' ? req.headers['if-none-match'] : undefined,
			accept: typeof req.headers.accept === 'string' ? req.headers.accept : undefined
		});
		sendStaticMapResponse(res, image);
	};
}
