import type { ConsulteeAreaFeature } from '@pins/identify-consultees-database/src/geospatial/consultee-areas.ts';

export interface ConsulteeAreasDirectViewModel {
	pageHeading: string;
	rows?: ConsulteeAreaFeature[];
	error?: string;
}
