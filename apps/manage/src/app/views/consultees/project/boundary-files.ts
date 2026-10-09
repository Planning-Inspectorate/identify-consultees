import type { CaseBoundaryFile } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import type { Geometry, Position } from '@pins/identify-consultees-database/src/geospatial/wkt.ts';

/**
 * The shapefile options the project boundary page offers: every stored boundary file for the
 * case (a caseReference can have several submissions - see listCaseBoundaryFiles), plus a
 * stand-in second file when only one exists so the file-toggle/confirm UI can be exercised while
 * real data is still single-file (the mock points at the real boundary underneath).
 */
export interface BoundaryFileOption {
	/** The radio's value and the map dataset's key - the boundary's own id for real files. */
	id: string;
	/** The case_boundary id continuing the journey when this option is chosen. */
	targetId: string;
	label: string;
	receivedDate: Date | null;
	/** True for the file this boundary page was opened on. */
	checked: boolean;
	/** True for the stand-in file - its geometry is a scaled copy of the real one, not stored data. */
	mock: boolean;
}

// the mock file's upload date sits a few weeks before the real file's, like an earlier submission
const MOCK_RECEIVED_OFFSET_MS = 52 * 24 * 60 * 60 * 1000;

// shrink the mock's geometry slightly around its centre so toggling it shows a visibly different
// boundary without it drifting off the site
const MOCK_GEOMETRY_SCALE = 0.96;

function mockFileName(caseName: string): string {
	const slug = caseName
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/(^-|-$)/g, '');
	return `${slug.charAt(0).toUpperCase()}${slug.slice(1)}-shapefile.geojson`;
}

function mockBoundaryFile(real: BoundaryFileOption, caseName: string): BoundaryFileOption {
	return {
		// a distinct radio value/map key that never hits the database - submit resolves it through
		// the same options list, where targetId leads back to the real boundary
		id: `${real.id}:placeholder`,
		targetId: real.targetId,
		label: mockFileName(caseName),
		receivedDate: real.receivedDate ? new Date(real.receivedDate.getTime() - MOCK_RECEIVED_OFFSET_MS) : null,
		checked: false,
		mock: true
	};
}

/**
 * The boundary page's file options: the case's stored files (its own boundary row is always one),
 * with the file the page was opened on checked - or the top file when the current id isn't in the
 * list. A single-file case gains the stand-in second file described above.
 */
export function boundaryFileOptions(
	files: CaseBoundaryFile[],
	currentId: string,
	caseName: string
): BoundaryFileOption[] {
	const options = files.map((file) => ({
		id: file.id,
		targetId: file.id,
		label: file.fileName ?? 'Unnamed file',
		receivedDate: file.receivedDate,
		checked: file.id === currentId,
		mock: false
	}));
	if (options.length > 0 && !options.some((option) => option.checked)) {
		options[0].checked = true;
	}
	if (options.length === 1) {
		options.push(mockBoundaryFile(options[0], caseName));
	}
	return options;
}

type CoordinateList = number | CoordinateList[];

function collectPositions(value: CoordinateList, positions: Position[]): void {
	if (typeof value === 'number') {
		return;
	}
	if (typeof value[0] === 'number' && typeof value[1] === 'number') {
		positions.push(value as unknown as Position);
		return;
	}
	for (const item of value) {
		collectPositions(item, positions);
	}
}

function scalePositions(value: CoordinateList, center: Position, factor: number): CoordinateList {
	if (typeof value === 'number') {
		return value;
	}
	if (typeof value[0] === 'number' && typeof value[1] === 'number') {
		const [lng, lat] = value as unknown as Position;
		return [center[0] + (lng - center[0]) * factor, center[1] + (lat - center[1]) * factor];
	}
	return value.map((item) => scalePositions(item, center, factor));
}

/** A copy of `geometry` scaled `factor`-fold toward its positions' mean centre - the mock file's shape. */
export function scaledGeometry(geometry: Geometry, factor: number = MOCK_GEOMETRY_SCALE): Geometry {
	const positions: Position[] = [];
	const members = geometry.type === 'GeometryCollection' ? geometry.geometries : [geometry];
	for (const member of members) {
		if (member.type !== 'GeometryCollection') {
			collectPositions(member.coordinates as CoordinateList, positions);
		}
	}
	if (positions.length === 0) {
		return geometry;
	}
	// a polygon repeats its first vertex to close the ring - dedupe so repeats don't skew the mean
	const unique = [...new Map(positions.map((position) => [position.join(','), position])).values()];
	const center: Position = [
		unique.reduce((sum, [lng]) => sum + lng, 0) / unique.length,
		unique.reduce((sum, [, lat]) => sum + lat, 0) / unique.length
	];
	const scale = (member: Geometry): Geometry =>
		member.type === 'GeometryCollection'
			? member
			: ({ ...member, coordinates: scalePositions(member.coordinates as CoordinateList, center, factor) } as Geometry);
	return geometry.type === 'GeometryCollection'
		? { type: 'GeometryCollection', geometries: geometry.geometries.map(scale) }
		: scale(geometry);
}
