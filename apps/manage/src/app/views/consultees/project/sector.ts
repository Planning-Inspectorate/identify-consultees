/**
 * The "Sector, Type, Sub-type" line under a project's name on the map page.
 *
 * case_boundary has no dedicated sector columns, so this is derived: a case reference's first
 * four characters are the sector/type code used across NSIP casework (e.g. EN0110007 -> EN01 =
 * Energy, Generating Stations - see the code table in docs/gis-shapefile-upload-and-report.md),
 * and for generating stations the energy sub-type is taken from a keyword in the project name
 * (the GIS tool captures it as a separate attribute - see the same doc - but the boundary export
 * doesn't carry it).
 */

const SECTOR_NAMES: Record<string, string> = {
	BC: 'Business or Commercial',
	EN: 'Energy',
	TR: 'Transport',
	WA: 'Water',
	WS: 'Waste',
	WW: 'Waste Water'
};

const TYPE_NAMES: Record<string, string> = {
	BC01: 'Office Use',
	BC03: 'An Industrial Process or Processes',
	BC04: 'Storage or Distribution of Goods',
	BC08: 'Leisure',
	EN01: 'Generating Stations',
	EN02: 'Electric Lines',
	EN03: 'Underground Gas Storage Facilities',
	EN04: 'LNG Facilities',
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

const GENERATING_STATIONS_CODE = 'EN01';

// matched against the project name, most specific first - "offshore wind" must beat the generic
// "wind" fallback, and "energy from waste"/"natural gas" their single-word overlaps
const ENERGY_SUBTYPE_PATTERNS: [RegExp, string][] = [
	[/offshore/i, 'Offshore wind'],
	[/onshore/i, 'Onshore wind'],
	[/energy from waste|\befw\b/i, 'Energy from waste'],
	[/natural gas|\bgas\b|\bccgt\b/i, 'Natural Gas'],
	[/solar/i, 'Solar'],
	[/nuclear/i, 'Nuclear'],
	[/tidal/i, 'Tidal'],
	[/hydrogen/i, 'Hydrogen'],
	[/biomass/i, 'Biomass'],
	[/wind/i, 'Onshore wind']
];

/**
 * e.g. "Energy, Generating Stations, Solar". Returns null when the reference doesn't carry a
 * known sector code - the line is simply omitted from the page.
 */
export function describeCaseSector(reference: string, caseName: string): string | null {
	const sector = SECTOR_NAMES[reference.slice(0, 2).toUpperCase()];
	if (!sector) {
		return null;
	}

	const parts = [sector];
	const typeCode = reference.slice(0, 4).toUpperCase();
	const type = TYPE_NAMES[typeCode];
	if (type) {
		parts.push(type);
	}

	if (typeCode === GENERATING_STATIONS_CODE) {
		const subtype = ENERGY_SUBTYPE_PATTERNS.find(([pattern]) => pattern.test(caseName))?.[1];
		if (subtype) {
			parts.push(subtype);
		}
	}

	return parts.join(', ');
}
