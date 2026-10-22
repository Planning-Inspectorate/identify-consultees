import type { ManageService } from '#service';
import type {
	CaseBoundaryFeature,
	NearbyCase
} from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import { findNearbyCases } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import type { ConsulteeMatch } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';

/**
 * Nearby NSIPs: the other cases - Nationally Significant Infrastructure Projects - near a case's
 * site. They're treated as another consultee category: listed on the check page, changed on their
 * own category page, mapped, and in the report on their own tab. Only where the data comes from
 * differs - case_boundary, not consultee_area - so each nearby case's newest shapefile becomes a
 * consultee match (see nearbyNsipMatch) and joins the ruleset run's (see run-ruleset.ts).
 */

/** The category, check-page group and report tab Nearby NSIPs go under. */
export const NEARBY_NSIPS = 'Nearby NSIPs';

/** True for a Nearby NSIP - a case_boundary row, not a consultee_area one. */
export function isNearbyNsip(match: Pick<ConsulteeMatch, 'feature'>): boolean {
	return match.feature.properties.consulteeCategory === NEARBY_NSIPS;
}

/** A nearby case as a consultee match: named for its project and reference, its id its shapefile's. */
export function nearbyNsipMatch(nearbyCase: NearbyCase, radiusMetres: number): ConsulteeMatch {
	return {
		feature: {
			id: nearbyCase.id,
			properties: {
				sourceId: nearbyCase.caseReference,
				consulteeCategory: NEARBY_NSIPS,
				consulteeGroup: NEARBY_NSIPS,
				consultee: `${nearbyCase.caseName} (${nearbyCase.caseReference})`,
				region: null
			}
		},
		distanceMetres: nearbyCase.distanceMetres,
		reasons: [{ type: 'nearbyNsip', radiusMetres }]
	};
}

/**
 * The cases within `radiusMetres` of `project`'s site, nearest first, as consultee matches - one per
 * case, by its newest shapefile, and never the site's own case (see findNearbyCases). None when the
 * distance is 0, as config/nearby-consultees.yaml's nsipRadiusKm can set.
 */
export async function findNearbyNsips(
	db: ManageService['db'],
	project: CaseBoundaryFeature,
	radiusMetres: number
): Promise<ConsulteeMatch[]> {
	if (!(radiusMetres > 0)) {
		return [];
	}
	const nearbyCases = await findNearbyCases(db, project.id, radiusMetres);
	return nearbyCases.map((nearbyCase) => nearbyNsipMatch(nearbyCase, radiusMetres));
}

/**
 * The project types a case reference's first four characters stand for: the Planning Act 2008
 * sector (EN, TR...) and its sub-sector (EN01, EN02...), as the National Infrastructure Planning
 * website's references use them - EN010012 is a generating station.
 */
const NSIP_TYPES: Record<string, string> = {
	BC: 'Business and Commercial',
	EN: 'Energy',
	TR: 'Transport',
	WA: 'Water',
	WS: 'Waste',
	WW: 'Waste Water'
};
const NSIP_SUBTYPES: Record<string, string> = {
	EN01: 'Generating Stations',
	EN02: 'Electric Lines',
	EN03: 'Underground Gas Storage Facilities',
	EN04: 'LNG Facilities',
	EN05: 'Gas Reception Facilities',
	EN06: 'Gas Transporter Pipe-lines',
	EN07: 'Other Pipe-lines',
	TR01: 'Highways',
	TR02: 'Airports',
	TR03: 'Harbour Facilities',
	TR04: 'Railways',
	TR05: 'Rail Freight Interchanges',
	WA01: 'Dams and Reservoirs',
	WA02: 'Transfer of Water Resources',
	WS01: 'Hazardous Waste Facilities',
	WW01: 'Waste Water Treatment Plants'
};

/** A case's project type and sub-type, from its reference - null for what a reference doesn't say. */
export function nsipType(caseReference: string | null | undefined): { type: string | null; subType: string | null } {
	const reference = (caseReference ?? '').trim().toUpperCase();
	return { type: NSIP_TYPES[reference.slice(0, 2)] ?? null, subType: NSIP_SUBTYPES[reference.slice(0, 4)] ?? null };
}

/**
 * A Nearby NSIP's project name and case reference from the name it's listed under - "Project
 * (EN010001)", as nearbyNsipMatch names it, or as one added by hand was matched - else the name
 * alone.
 */
export function splitNsipName(name: string): { projectName: string; caseReference?: string } {
	const named = /^(.*\S)\s*\(([A-Za-z]{2}\d{6})\)$/.exec(name.trim());
	return named ? { projectName: named[1], caseReference: named[2] } : { projectName: name.trim() };
}
