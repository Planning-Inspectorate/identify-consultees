import type { PrismaClient } from '@pins/identify-consultees-database/src/client/client.ts';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CaseBoundaryFeature, CaseBoundaryFeatureCollection } from '../geospatial/case-boundaries.ts';
import { loadCaseBoundaries } from '../geospatial/case-boundaries.ts';
import type { ConsulteeAreaFeature, ConsulteeAreaFeatureCollection } from '../geospatial/consultee-areas.ts';
import { loadConsulteeAreas } from '../geospatial/consultee-areas.ts';
import type { Geometry } from '../geospatial/wkt.ts';

// real UK infrastructure/consultee boundary exports, used as realistic local dev/demo data - see
// apps/function-python/setup_database/sample_data
const sampleDataDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../../../../apps/function-python/setup_database/sample_data'
);

interface RawFeature {
	geometry: Geometry;
	properties: Record<string, unknown>;
}

async function readFeatures(fileName: string): Promise<RawFeature[]> {
	const contents = await readFile(path.join(sampleDataDir, fileName), 'utf8');
	return JSON.parse(contents).features;
}

/**
 * A stable id derived from `seed`, so re-running the seed updates the same rows instead of
 * inserting duplicates each time - SQL Server's UNIQUEIDENTIFIER just needs a valid 8-4-4-4-12 hex
 * shape, it doesn't care about RFC 4122 version/variant bits.
 */
function deterministicId(seed: string): string {
	const hash = createHash('sha256').update(seed).digest('hex');
	return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

function toConsulteeArea(feature: RawFeature): ConsulteeAreaFeature {
	const props = feature.properties;
	return {
		id: deterministicId(`consultee-area:${props.id}`),
		type: 'Feature',
		geometry: feature.geometry,
		properties: {
			consultee: (props.consultee as string) ?? null,
			region: (props.region as string) ?? null,
			consulteeCategory: (props.consulteeCategory as string) ?? null,
			caseReference: (props.caseId as string) ?? null,
			documentId: (props.documentId as string) ?? null,
			consulteeId: (props.consulteeId as string) ?? null,
			organisationId: (props.organisationId as string) ?? null,
			currentVersion: (props.currentVersion as number) ?? 1,
			// keep the source data's own id/lastUpdated alongside its ArcGIS export metadata, rather
			// than dropping them - our schema only has a dedicated column for currentVersion
			metadata: {
				...(props.metadata as Record<string, unknown>),
				sourceId: props.id,
				sourceLastUpdated: props.last_updated
			}
		}
	};
}

function toCaseBoundary(feature: RawFeature): CaseBoundaryFeature {
	const props = feature.properties;
	return {
		id: deterministicId(`case-boundary:${props.caseReference}`),
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

export async function seedDev(dbClient: PrismaClient) {
	const consulteeAreaFeatures = await readFeatures('reference_data.geojson');
	const consulteeAreas: ConsulteeAreaFeatureCollection = {
		type: 'FeatureCollection',
		features: consulteeAreaFeatures.map(toConsulteeArea)
	};
	const consulteeAreaCount = await loadConsulteeAreas(dbClient, consulteeAreas);
	console.log(`Loaded ${consulteeAreaCount} consultee areas`);

	const caseBoundaryFeatures = await readFeatures('sample_application_boundaries.geojson');
	const caseBoundaries: CaseBoundaryFeatureCollection = {
		type: 'FeatureCollection',
		features: caseBoundaryFeatures.map(toCaseBoundary)
	};
	const caseBoundaryCount = await loadCaseBoundaries(dbClient, caseBoundaries);
	console.log(`Loaded ${caseBoundaryCount} case boundaries`);

	console.log('dev seed complete');
}
