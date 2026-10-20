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
