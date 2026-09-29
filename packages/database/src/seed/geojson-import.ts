import type { PrismaClient } from '@pins/identify-consultees-database/src/client/client.ts';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { CaseBoundaryFeature, CaseBoundaryFeatureCollection } from '../geospatial/case-boundaries.ts';
import { loadCaseBoundaries } from '../geospatial/case-boundaries.ts';
import type { ConsulteeAreaFeature, ConsulteeAreaFeatureCollection } from '../geospatial/consultee-areas.ts';
import { loadConsulteeAreas } from '../geospatial/consultee-areas.ts';
import type { Geometry } from '../geospatial/wkt.ts';

/**
 * Shared logic for importing the two GeoJSON sources this project loads: reference/consultee
 * area data (railways, police force areas, etc.) and project/case boundary data (CBOS). Used both
 * for the small local dev sample (see data-dev.ts) and for a real, large dataset via import-cli.ts
 * - the shape is the same source format either way, just more rows.
 */

interface RawFeature {
	geometry: Geometry;
	properties: Record<string, unknown>;
}

export async function readFeatures(filePath: string): Promise<RawFeature[]> {
	const contents = await readFile(filePath, 'utf8');
	return JSON.parse(contents).features;
}

/**
 * A stable id derived from `seed`, so re-running an import updates the same rows instead of
 * inserting duplicates each time - SQL Server's UNIQUEIDENTIFIER just needs a valid 8-4-4-4-12 hex
 * shape, it doesn't care about RFC 4122 version/variant bits.
 */
export function deterministicId(seed: string): string {
	const hash = createHash('sha256').update(seed).digest('hex');
	return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

export function toConsulteeArea(feature: RawFeature): ConsulteeAreaFeature {
	const props = feature.properties;

	// two source shapes seen so far: the original small ArcGIS-style sample (consulteeCategory,
	// camelCase, metadata as a real JSON object) and the real "combined reference data" export
	// (consultee_category, snake_case, metadata as a Python dict repr string - not valid JSON, so
	// it's kept as-is under rawMetadata rather than risking corruption from a fragile parser)
	const consulteeCategory = (props.consulteeCategory ?? props.consultee_category) as string | undefined;
	const rawMetadata = props.metadata;
	let metadata: Record<string, unknown> = {};
	if (rawMetadata && typeof rawMetadata === 'object') {
		metadata = rawMetadata as Record<string, unknown>;
	} else if (typeof rawMetadata === 'string') {
		metadata = { rawMetadata };
	}

	return {
		id: deterministicId(`consultee-area:${props.id}`),
		type: 'Feature',
		geometry: feature.geometry,
		properties: {
			consultee: (props.consultee as string) ?? null,
			region: (props.region as string) ?? null,
			consulteeCategory: consulteeCategory ?? null,
			caseReference: (props.caseId as string) ?? null,
			documentId: (props.documentId as string) ?? null,
			consulteeId: (props.consulteeId as string) ?? null,
			organisationId: (props.organisationId as string) ?? null,
			currentVersion: (props.currentVersion as number) ?? 1,
			// keep the source data's own id/lastUpdated alongside its metadata, rather than dropping
			// them - our schema only has a dedicated column for currentVersion
			metadata: {
				...metadata,
				sourceId: props.id,
				sourceLastUpdated: props.last_updated
			}
		}
	};
}

export function toCaseBoundary(feature: RawFeature): CaseBoundaryFeature {
	const props = feature.properties;
	return {
		// caseReference alone isn't a unique key for real data - the same project can have several
		// boundary submissions over time (different fileName/receivedDate for the same reference),
		// which caseReference-only ids would silently collapse into one, dropping real rows. Note:
		// this changes ids for anything already seeded under the old caseReference-only scheme
		// (harmless - it just leaves old rows alongside new ones, as already happens with
		// consultee_area's sample vs. real data; clear case_boundary first for a clean re-seed).
		id: deterministicId(`case-boundary:${props.caseReference}:${props.fileName}`),
		type: 'Feature',
		geometry: feature.geometry,
		properties: {
			caseReference: props.caseReference as string,
			caseName: props.projectName as string,
			fileName: (props.fileName as string) ?? null,
			receivedDate: props.receivedDate ? new Date(props.receivedDate as string) : null,
			metadata: {}
		}
	};
}

export interface ImportOptions {
	batchSize?: number;
	onProgress?: (loaded: number, total: number) => void;
}

/**
 * Read a reference-data GeoJSON file (same shape as
 * apps/function-python/setup_database/sample_data/reference_data.geojson, just potentially many
 * more/larger features) and load it into consultee_area.
 */
export async function importConsulteeAreas(
	dbClient: PrismaClient,
	filePath: string,
	options: ImportOptions = {}
): Promise<number> {
	const rawFeatures = await readFeatures(filePath);
	const featureCollection: ConsulteeAreaFeatureCollection = {
		type: 'FeatureCollection',
		features: rawFeatures.map(toConsulteeArea)
	};
	return loadConsulteeAreas(dbClient, featureCollection, options);
}

/**
 * Read a project/case-boundary GeoJSON file (same shape as
 * apps/function-python/setup_database/sample_data/sample_application_boundaries.geojson) and load
 * it into case_boundary.
 */
export async function importCaseBoundaries(
	dbClient: PrismaClient,
	filePath: string,
	options: ImportOptions = {}
): Promise<number> {
	const rawFeatures = await readFeatures(filePath);
	const featureCollection: CaseBoundaryFeatureCollection = {
		type: 'FeatureCollection',
		features: rawFeatures.map(toCaseBoundary)
	};
	return loadCaseBoundaries(dbClient, featureCollection, options);
}
