/**
 * Build the GeoJSON (and derived map view) for a case's maps - category pages, static images and the report's PDFs: the project's own
 * boundary, plus every consultee a ruleset run found - the same two layers the interactive map
 * and its static-map fallback both render.
 */

import type { CaseBoundaryFeature } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import type { ConsulteeMatch } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import { isIdentified } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import type { Geometry } from '@pins/identify-consultees-database/src/geospatial/wkt.ts';
import { REPORT_CONFIG } from '../report-config.ts';
import { isNearbyNsip } from '../views/consultees/nearby-nsips.ts';
import { assignCategoryColours, colourFor, CONSULTEE_CATEGORY_COLOURS, UNCATEGORISED } from './category-colours.ts';
import { computeBounds, computeFittedMapView } from './geometry-bounds.ts';
import type { InteractiveBasemap } from './os-maps.ts';
import { interactiveBasemap } from './os-maps.ts';
import type { GeoJsonFeature, GeoJsonFeatureCollection } from './sample-geojson.ts';
import { MAP_VIEWPORT } from './sample-geojson.ts';

// ~1m - plenty for drawing, and coordinates are most of the layer's size
const DISPLAY_COORDINATE_DECIMALS = 5;

type Coordinates = number | Coordinates[];

function roundCoordinates(value: Coordinates): Coordinates {
	return typeof value === 'number' ? Number(value.toFixed(DISPLAY_COORDINATE_DECIMALS)) : value.map(roundCoordinates);
}

function roundGeometry(geometry: Geometry): Geometry {
	if (geometry.type === 'GeometryCollection') {
		return { type: 'GeometryCollection', geometries: geometry.geometries.map(roundGeometry) };
	}
	return { ...geometry, coordinates: roundCoordinates(geometry.coordinates as Coordinates) } as Geometry;
}

// a site is drawn whole up to this many points - about 1MB of a page. Past it, as the run screened
// it, simplified to 10m: a 1,000,000-point linear scheme made a 24MB page, which a browser takes
// seconds to download and draw, for detail no map shows
export const SITE_DISPLAY_MAX_POINTS = 50_000;

function pointCount(geometry: Geometry): number {
	if (geometry.type === 'GeometryCollection') {
		return geometry.geometries.reduce((total, part) => total + pointCount(part), 0);
	}
	// a position is an array of numbers; anything else, an array of positions or of their arrays
	const count = (value: Coordinates): number =>
		Array.isArray(value) && typeof value[0] !== 'number'
			? value.reduce<number>((total, part) => total + count(part), 0)
			: 1;
	return count(geometry.coordinates as Coordinates);
}

/** The geometry the maps draw a site with: its own, or - past SITE_DISPLAY_MAX_POINTS - its simplified one. */
export function siteDisplayGeometry(site: Pick<CaseBoundaryFeature, 'geometry' | 'simplifiedGeometry'>): Geometry {
	return site.simplifiedGeometry && pointCount(site.geometry) > SITE_DISPLAY_MAX_POINTS
		? site.simplifiedGeometry
		: site.geometry;
}

export function buildProjectGeojson(project: CaseBoundaryFeature): GeoJsonFeatureCollection {
	return {
		type: 'FeatureCollection',
		features: [
			{
				type: 'Feature',
				id: project.id,
				properties: {
					name: project.properties.caseName,
					reference: project.properties.caseReference,
					layer: 'project-site'
				},
				geometry: roundGeometry(siteDisplayGeometry(project))
			}
		]
	};
}

function categoryOf(match: Pick<ConsulteeMatch, 'feature'>): string {
	return match.feature.properties.consulteeCategory || UNCATEGORISED;
}

/**
 * A match, perhaps one a user added by hand (see markAddedByHand) - from the nearby search, or from
 * further away than the run found anything (`beyondRun`, see addedBeyondRun).
 */
export type MapMatch = ConsulteeMatch & { addedByHand?: boolean; beyondRun?: boolean };

/**
 * `matches` with the ones in `ids` - nearby consultees added by hand (a typed name matched to one) - marked
 * as added by hand, so the map draws them as identified rather than as faint context.
 */
export function markAddedByHand(matches: ConsulteeMatch[], ids: ReadonlySet<string>): MapMatch[] {
	return ids.size === 0
		? matches
		: matches.map((match) => (ids.has(match.feature.id) ? { ...match, addedByHand: true } : match));
}

/** A consultee added by hand, as the map needs it: its id (absent on links from before ids were kept) and how it was added. */
export interface HandAddedConsultee {
	id?: string;
	category: string;
	name: string;
}

/**
 * The consultees in `category` added by hand that the run didn't find - from anywhere in the
 * reference data, or a case further away than Nearby NSIPs look - as matches the map draws by their
 * id, added by hand. Each is drawn whole, wherever it is, and the category map widens to show it
 * (see buildCaseMapConfig). One with no id has no area to draw.
 */
export function addedBeyondRun(
	consultees: ConsulteeMatch[],
	adds: readonly HandAddedConsultee[],
	category: string
): MapMatch[] {
	const runIds = new Set(consultees.map((match) => match.feature.id.toLowerCase()));
	const seen = new Set<string>();
	return adds.flatMap((add) => {
		const id = add.id?.toLowerCase();
		if (add.category !== category || !id || runIds.has(id) || seen.has(id)) {
			return [];
		}
		seen.add(id);
		return [
			{
				feature: { id, properties: { consulteeCategory: category, consultee: add.name } },
				distanceMetres: 0,
				reasons: [],
				addedByHand: true,
				beyondRun: true
			}
		];
	});
}

/** True when the map draws the match as identified: a condition found it, or a user added it. */
function isDrawnAsIdentified(match: MapMatch): boolean {
	return match.addedByHand === true || isIdentified(match);
}

type DrawableMatch = MapMatch & { feature: { geometry: Geometry } };

function isDrawable(match: MapMatch): match is DrawableMatch {
	return match.feature.geometry !== undefined;
}

/**
 * A colour for each Nearby NSIP drawn - each is another project, so each has its own, from the
 * category palette in name order, so the map, its static image and the report's PDF agree.
 */
export function nsipColours(matches: Pick<ConsulteeMatch, 'feature'>[]): Map<string, string> {
	const nsips = matches
		.filter(isNearbyNsip)
		.map((match) => ({ id: match.feature.id, name: match.feature.properties.consultee ?? '' }))
		.toSorted((a, b) => a.name.localeCompare(b.name, 'en-GB') || a.id.localeCompare(b.id));
	return new Map(
		nsips.map(({ id }, index) => [id, CONSULTEE_CATEGORY_COLOURS[index % CONSULTEE_CATEGORY_COLOURS.length]])
	);
}

/**
 * The consultees that have geometry to draw. A run's matches carry none (the function is never
 * asked for it), so these are drawn from display geometry (see buildCaseMapConfig). A Nearby NSIP
 * is drawn in its own colour (nsipColours), marked `ownLayer` so the map lists it on its own.
 */
function buildConsulteeMatchesGeojson(matches: MapMatch[], colours: Map<string, string>): GeoJsonFeatureCollection {
	const drawable = matches.filter(isDrawable);
	const projectColours = nsipColours(drawable);
	return {
		type: 'FeatureCollection',
		features: drawable.map((match) => ({
			type: 'Feature',
			id: match.feature.id,
			properties: {
				// MapLibre drops string feature ids, so map selection needs the id as a property
				consulteeId: match.feature.id,
				name: match.feature.properties.consultee ?? '',
				consulteeCategory: categoryOf(match),
				region: match.feature.properties.region ?? '',
				colour: projectColours.get(match.feature.id) ?? colourFor(colours, categoryOf(match)),
				...(projectColours.has(match.feature.id) ? { ownLayer: 'true' } : {}),
				// 'false' when only the nearby search found it, and no one added it: drawn fainter, as
				// context (see withFillOpacity)
				identified: String(isDrawnAsIdentified(match))
			},
			geometry: match.feature.geometry
		}))
	};
}

/**
 * A site's search area - the site grown by the nearby radius - and the matched consultee areas
 * touching it: what the map draws. The area itself isn't drawn - the map opens on the site, with
 * config/report.yaml's mapKm around it: framing on whole counties and ambulance trusts would zoom
 * out so far the site is lost.
 */
export interface SearchAreaDisplay {
	/** The site grown by the nearby radius. */
	area: Geometry;
	/** Whole display geometry of the ruleset's matches touching `area`, by consultee area id. */
	geometries: Map<string, Geometry>;
}

/** Where the JS fallback's static-map image lives when the interactive map can't start. */
export interface StaticMapFallbackConfig {
	src: string;
	alt: string;
	width: number;
	height: number;
}

export interface CaseMapConfig {
	center: readonly [number, number];
	zoom: number;
	width: number;
	height: number;
	mapLabel: string;
	projectLayerLabel: string;
	consulteeLayerLabel: string;
	projectGeojson: GeoJsonFeatureCollection;
	consulteeGeojson: GeoJsonFeatureCollection;
	/**
	 * The ruleset's buffers around the site for the map's category, drawn dashed - each labelled
	 * with its distance (see views/consultees/site-buffers.ts). None when its conditions have none.
	 */
	bufferGeojson?: GeoJsonFeatureCollection;
	/**
	 * The JS init-failure fallback's static-map image - carried in the page config because
	 * data-* attributes on the map container are JSON.parsed by the InteractiveMap constructor.
	 */
	fallback?: StaticMapFallbackConfig;
	/** OS's basemap, when there's a key - see os-maps.ts. OpenFreeMap's without. */
	interactiveBasemap?: InteractiveBasemap;
}

// regional areas (police force, ambulance trust, county) cover most of the search area, and a dozen
// of them stacked at a local area's opacity bury everything - they're only tinted, and drawn under
// the local ones
export const LOCAL_FILL_OPACITY = 0.35;
export const REGIONAL_FILL_OPACITY = 0.06;
// consultees only the nearby search found aren't in the report - the map shows them as context,
// fainter than the ones a ruleset condition identified
export const NEARBY_LOCAL_FILL_OPACITY = 0.1;
export const NEARBY_REGIONAL_FILL_OPACITY = 0.03;
const REGIONAL_COVERAGE = 0.5;

function boundingBoxArea(features: GeoJsonFeature[]): number {
	const bounds = computeBounds({ features });
	return bounds ? (bounds.east - bounds.west) * (bounds.north - bounds.south) : 0;
}

/**
 * Each match's fill opacity (`fillOpacity`), by category: regional if any area in the category
 * covers most of the search area's bounding box, and fainter for a consultee only the nearby search
 * found. Drawn faintest first, so regional tints and nearby context sit under the identified local
 * areas. Without a search area, every category is local.
 */
function withFillOpacity(
	collection: GeoJsonFeatureCollection,
	searchArea?: GeoJsonFeature[]
): GeoJsonFeatureCollection {
	const regionalArea = searchArea ? boundingBoxArea(searchArea) * REGIONAL_COVERAGE : Infinity;
	const regional = new Set(
		collection.features
			.filter((feature) => boundingBoxArea([feature]) >= regionalArea)
			.map((feature) => feature.properties.consulteeCategory)
	);
	const fillOpacity = (feature: GeoJsonFeature): number => {
		const isRegional = regional.has(feature.properties.consulteeCategory);
		if (feature.properties.identified === 'false') {
			return isRegional ? NEARBY_REGIONAL_FILL_OPACITY : NEARBY_LOCAL_FILL_OPACITY;
		}
		return isRegional ? REGIONAL_FILL_OPACITY : LOCAL_FILL_OPACITY;
	};
	return {
		...collection,
		// the static map draws in feature order (a stable sort keeps the original order within each opacity)
		features: collection.features
			.map((feature) => ({ feature, opacity: fillOpacity(feature) }))
			.sort((a, b) => a.opacity - b.opacity)
			.map(({ feature, opacity }) => ({
				...feature,
				properties: { ...feature.properties, fillOpacity: String(opacity) }
			}))
	};
}

/** `matches` with their display geometry from `geometries`; any with none (not touching the area) are left out. */
function withDisplayGeometry(matches: MapMatch[], geometries: Map<string, Geometry>): MapMatch[] {
	return matches.flatMap((match) => {
		const geometry = geometries.get(match.feature.id);
		return geometry ? [{ ...match, feature: { ...match.feature, geometry: roundGeometry(geometry) } }] : [];
	});
}

export function buildCaseMapConfig(
	project: CaseBoundaryFeature,
	matches: MapMatch[],
	rulesetName: string,
	searchArea?: SearchAreaDisplay,
	fallback?: { src: string; alt: string },
	/** How much the map shows around the site - a category's mapKm in config/report.yaml, else the default. */
	marginMetres: number = REPORT_CONFIG.defaults.mapMarginMetres
): CaseMapConfig {
	const projectGeojson = buildProjectGeojson(project);
	const colours = assignCategoryColours(matches.map(categoryOf));
	const searchAreaFeatures: GeoJsonFeature[] | undefined = searchArea && [
		{ type: 'Feature', properties: {}, geometry: searchArea.area }
	];
	const drawn = searchArea ? withDisplayGeometry(matches, searchArea.geometries) : matches;
	const consulteeGeojson = withFillOpacity(buildConsulteeMatchesGeojson(drawn, colours), searchAreaFeatures);
	// the map opens on the site - widened to take in any consultee added by hand from beyond where
	// the run looked, or it would be off the map
	const view = computeFittedMapView(
		{
			features: [
				...projectGeojson.features,
				...drawn.flatMap((match) => (match.beyondRun && isDrawable(match) ? [match.feature] : []))
			]
		},
		MAP_VIEWPORT,
		marginMetres
	);
	const mapLabel = `${rulesetName} for ${project.properties.caseName} (${project.properties.caseReference})`;

	return {
		center: view.center,
		zoom: view.zoom,
		width: MAP_VIEWPORT.width,
		height: MAP_VIEWPORT.height,
		mapLabel,
		projectLayerLabel: `Project site (${project.properties.caseReference})`,
		consulteeLayerLabel: rulesetName,
		projectGeojson,
		consulteeGeojson,
		...(fallback ? { fallback: { ...fallback, width: MAP_VIEWPORT.width, height: MAP_VIEWPORT.height } } : {}),
		...interactiveBasemap({ center: view.center, zoom: view.zoom, ...MAP_VIEWPORT })
	};
}
