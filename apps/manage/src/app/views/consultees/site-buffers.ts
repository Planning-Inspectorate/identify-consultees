import type { ManageService } from '#service';
import type { CaseBoundaryFeature } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import type { Ruleset, SiteScreenedAs } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import type { Geometry } from '@pins/identify-consultees-database/src/geospatial/wkt.ts';
import { computeBounds } from '../../maps/geometry-bounds.ts';
import type { GeoJsonFeatureCollection } from '../../maps/sample-geojson.ts';
import { grownSite } from './grown-site.ts';
import { NEARBY_NSIPS } from './nearby-nsips.ts';

/**
 * The ruleset's buffers around a site, as a category's maps draw them - its page's interactive map
 * and static image, and the report's PDF: each distance a condition finds the category within,
 * grown from what the run screened.
 */

// how far the bounding box a too-detailed site is screened as reaches past it - as
// apps/function-python/intersector/queries.py's BOUNDING_BOX_MARGIN_METRES
const BOUNDING_BOX_MARGIN_METRES = 1_000;
const METRES_PER_DEGREE = 111_320;

/**
 * The distances a category's consultees were looked for within: each ruleset condition that finds
 * the category within a buffer of the site, or - for Nearby NSIPs - the Nearby NSIPs distance.
 * Smallest first, each once; a condition that needs them to touch the site, or borders a host area,
 * has none.
 */
export function categoryBufferMetres(ruleset: Ruleset, category: string, nearbyNsipRadiusMetres: number): number[] {
	const metres =
		category === NEARBY_NSIPS
			? [nearbyNsipRadiusMetres]
			: ruleset.rules
					.filter((rule) => rule.logicType === 'intersection' && rule.categories.includes(category))
					.map((rule) => rule.bufferMetres ?? 0);
	return [...new Set(metres.filter((value) => value > 0))].toSorted((a, b) => a - b);
}

/** A buffer distance as the maps and their keys give it - `500 m`, `2 km`, `1.5 km`. */
export function formatBufferDistance(metres: number): string {
	return metres < 1000 ? `${Math.round(metres)} m` : `${Math.round(metres / 100) / 10} km`;
}

/**
 * What a run screened, to grow the buffers from: the site's outline - simplified to 10m, as the run
 * sends it (see run-ruleset.ts), which grows in a fraction of the time the original takes - or
 * the rectangle around it (grown by BOUNDING_BOX_MARGIN_METRES) for a site too detailed to screen
 * in time, as the function's bounding_box builds it.
 */
export function screenedSite(project: CaseBoundaryFeature, siteScreenedAs: SiteScreenedAs): Geometry {
	if (siteScreenedAs !== 'boundingBox') {
		return project.simplifiedGeometry ?? project.geometry;
	}
	const bounds = computeBounds({ features: [{ geometry: project.geometry }] })!;
	const latitudeMargin = BOUNDING_BOX_MARGIN_METRES / METRES_PER_DEGREE;
	const widest = Math.max(Math.abs(bounds.south), Math.abs(bounds.north)) + latitudeMargin;
	const longitudeMargin =
		BOUNDING_BOX_MARGIN_METRES / (METRES_PER_DEGREE * Math.cos((Math.min(widest, 89) * Math.PI) / 180));
	const [west, east] = [bounds.west - longitudeMargin, bounds.east + longitudeMargin];
	const [south, north] = [bounds.south - latitudeMargin, bounds.north + latitudeMargin];
	return {
		type: 'Polygon',
		coordinates: [
			[
				[west, south],
				[east, south],
				[east, north],
				[west, north],
				[west, south]
			]
		]
	};
}

export interface SiteBuffer {
	metres: number;
	geometry: Geometry;
}

/** Buffers already drawn, by distance - so the maps of one report grow each only once. */
export type SiteBufferCache = Map<number, Promise<Geometry | undefined>>;

/**
 * The site - as the run screened it - grown by each of `metres`, smallest first. One that can't be
 * drawn is logged and left out, so the rest of the map still draws.
 */
export async function siteBuffers(
	service: Pick<ManageService, 'db' | 'logger'>,
	project: CaseBoundaryFeature,
	siteScreenedAs: SiteScreenedAs,
	metres: number[],
	cache: SiteBufferCache = new Map()
): Promise<SiteBuffer[]> {
	const grown = await Promise.all(
		metres.map(async (distance) => {
			let buffer = cache.get(distance);
			if (!buffer) {
				buffer = grownSite(service.db, screenedSite(project, siteScreenedAs), distance).catch((error: unknown) => {
					service.logger.warn({ error, caseId: project.id, metres: distance }, 'could not draw a buffer on a map');
					return undefined;
				});
				cache.set(distance, buffer);
			}
			return { metres: distance, geometry: await buffer };
		})
	);
	return grown.filter((buffer): buffer is SiteBuffer => buffer.geometry !== undefined);
}

/** The buffers as the maps take them: a feature each, labelled with its distance. */
export function siteBufferGeojson(buffers: SiteBuffer[]): GeoJsonFeatureCollection {
	return {
		type: 'FeatureCollection',
		features: buffers.map(({ metres, geometry }) => ({
			type: 'Feature',
			properties: { label: formatBufferDistance(metres) },
			geometry
		}))
	};
}
