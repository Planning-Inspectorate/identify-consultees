import type { ManageService } from '#service';
import type { AsyncRequestHandler } from '@planning-inspectorate/core/util';
import type { HomeViewModel, ProjectGeometry, RulesetOption } from './view-model.ts';

const RULESETS: RulesetOption[] = [
	{ value: 'post-apr-2025-england-wales', text: 'Post Apr 2025 England & Wales' },
	{ value: 'pre-apr-2025-england-wales', text: 'Pre Apr 2025 England & Wales' },
	{ value: 'scotland', text: 'Scotland' }
];

const PROJECT_STAGES = [
	'Pre-application',
	'Acceptance',
	'Pre-examination',
	'Examination',
	'Recommendation',
	'Decision',
	'Post-decision',
	'Scoping'
] as const;

const DUMMY_PROJECTS: { reference: string; caseName: string }[] = [
	{ reference: 'EN0110036', caseName: 'Gwynt Glas Offshore Wind Farm' },
	{ reference: 'EN010087', caseName: 'East Anglia THREE Offshore Wind Farm' },
	{ reference: 'EN010012', caseName: 'Hornsea Project Four Offshore Wind Farm' },
	{ reference: 'EN010133', caseName: 'Sheringham and Dudgeon Extension Projects' },
	{ reference: 'EN010110', caseName: 'Net Zero Teesside Project' },
	{ reference: 'EN010106', caseName: 'Sizewell C Nuclear Power Station' },
	{ reference: 'EN010098', caseName: 'Awel y Môr Offshore Wind Farm' },
	{ reference: 'EN010095', caseName: 'Immingham Eastern Ro-Ro Terminal' },
	{ reference: 'TR010034', caseName: 'A66 Northern Trans-Pennine Project' },
	{ reference: 'TR010025', caseName: 'A303 Amesbury to Berwick Down' },
	{ reference: 'TR010054', caseName: 'A428 Black Cat to Caxton Gibbet' },
	{ reference: 'TR010060', caseName: 'A12 Chelmsford to A120 Widening' },
	{ reference: 'TR010044', caseName: 'M25 Junction 28 Improvements' },
	{ reference: 'TR010036', caseName: 'Lower Thames Crossing' },
	{ reference: 'TR010029', caseName: 'A417 Missing Link' },
	{ reference: 'WS010005', caseName: 'North London Heat and Power Project' },
	{ reference: 'WS010003', caseName: 'Wheelabrator Kemsley Generating Station' },
	{ reference: 'WS010006', caseName: 'Boston Alternative Energy Facility' },
	{ reference: 'BC080001', caseName: 'Able Marine Energy Park' },
	{ reference: 'BC030001', caseName: 'Port of Tilbury Expansion' },
	{ reference: 'TU010001', caseName: 'Heathrow Northwest Runway' },
	{ reference: 'TR020002', caseName: 'Manston Airport' },
	{ reference: 'EN020022', caseName: 'Hinkley Point C Connection' },
	{ reference: 'EN020016', caseName: 'Richborough Connection Project' },
	{ reference: 'EN020019', caseName: 'North West Coast Connections' },
	{ reference: 'EN070005', caseName: 'HyNet Carbon Dioxide Pipeline' },
	{ reference: 'EN070007', caseName: 'Viking CCS Pipeline' },
	{ reference: 'EN070008', caseName: 'Hydrogen Pipeline Cheshire' },
	{ reference: 'EN010085', caseName: 'Cleve Hill Solar Park' },
	{ reference: 'EN010118', caseName: 'Gate Burton Energy Park' },
	{ reference: 'EN010127', caseName: 'Mallard Pass Solar Farm' },
	{ reference: 'EN010123', caseName: 'Heckington Fen Solar Park' },
	{ reference: 'EN010148', caseName: 'Beacon Fen Energy Park' },
	{ reference: 'TR010027', caseName: 'A38 Derby Junctions' },
	{ reference: 'TR010031', caseName: 'A63 Castle Street Improvements' },
	{ reference: 'TR010035', caseName: 'A303 Sparkford to Ilchester' },
	{ reference: 'EN010053', caseName: 'Triton Knoll Electrical System' },
	{ reference: 'EN010064', caseName: 'Wylfa Newydd Nuclear Power Station' },
	{ reference: 'EN010007', caseName: 'Galloper Offshore Wind Farm' },
	{ reference: 'WS010001', caseName: 'Rookery South Energy Recovery Facility' }
];

function padDatePart(value: number): string {
	return String(value).padStart(2, '0');
}

function formatReceivedDate(dayOffset: number): string {
	const date = new Date(Date.UTC(2025, 0, 15));
	date.setUTCDate(date.getUTCDate() + dayOffset);
	return `${padDatePart(date.getUTCDate())}/${padDatePart(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
}

function formatUploadedDateTime(dayOffset: number, hour: number, minute: number): string {
	const date = new Date(Date.UTC(2025, 0, 15));
	date.setUTCDate(date.getUTCDate() + dayOffset);
	return `${padDatePart(date.getUTCDate())}/${padDatePart(date.getUTCMonth() + 1)}/${date.getUTCFullYear()} ${padDatePart(hour)}:${padDatePart(minute)}:00`;
}

/** Dummy project geometries until a data source is available. */
const DUMMY_GEOMETRIES: ProjectGeometry[] = Array.from({ length: 100 }, (_, index) => {
	const project = DUMMY_PROJECTS[index % DUMMY_PROJECTS.length]!;
	const version = (index % 5) + 1;
	const stage = PROJECT_STAGES[index % PROJECT_STAGES.length]!;
	const receivedOffset = 400 - index * 3;
	const uploadedOffset = receivedOffset + (index % 7) + 1;

	return {
		id: `geo-${index + 1}`,
		reference: project.reference,
		caseName: project.caseName,
		geometryProjectStage: stage,
		version: String(version),
		received: formatReceivedDate(receivedOffset),
		uploadedToCbos: formatUploadedDateTime(uploadedOffset, 8 + (index % 10), (index * 7) % 60)
	};
});

const PAGE_SIZE_OPTIONS = [25, 50, 100];
const DEFAULT_PAGE_SIZE = 25;
const DUMMY_RESULTS_TOTAL = 3889;

function firstQueryValue(value: unknown): string {
	if (Array.isArray(value)) {
		return typeof value[0] === 'string' ? value[0] : '';
	}
	return typeof value === 'string' ? value : '';
}

function parsePageSize(value: unknown): number {
	const parsed = Number.parseInt(firstQueryValue(value), 10);
	return PAGE_SIZE_OPTIONS.includes(parsed) ? parsed : DEFAULT_PAGE_SIZE;
}

function filterGeometries(searchQuery: string): ProjectGeometry[] {
	const normalised = searchQuery.trim().toLowerCase();
	if (!normalised) {
		return DUMMY_GEOMETRIES;
	}

	return DUMMY_GEOMETRIES.filter(
		(geometry) =>
			geometry.reference.toLowerCase().includes(normalised) || geometry.caseName.toLowerCase().includes(normalised)
	);
}

export function buildHomePage(service: ManageService): AsyncRequestHandler {
	const { logger } = service;

	return async (req, res) => {
		logger.info('identify consultees home page');

		const searchQuery = firstQueryValue(req.query.q);
		const selectedRuleset = firstQueryValue(req.query.ruleset) || RULESETS[0]?.value || '';
		const pageSize = parsePageSize(req.query.pageSize);
		const filtered = filterGeometries(searchQuery);
		const pageGeometries = filtered.slice(0, pageSize);
		const selectedGeometryId = firstQueryValue(req.query.geometryId) || pageGeometries[0]?.id || null;
		const resultsTotal = searchQuery ? filtered.length : DUMMY_RESULTS_TOTAL;

		const viewModel: HomeViewModel = {
			pageHeading: 'Identify consultees for an infrastructure project',
			rulesets: RULESETS,
			selectedRuleset,
			searchQuery,
			pageSize,
			pageSizeOptions: PAGE_SIZE_OPTIONS,
			resultsFrom: pageGeometries.length > 0 ? 1 : 0,
			resultsTo: pageGeometries.length,
			resultsTotal,
			geometries: pageGeometries,
			selectedGeometryId
		};

		return res.render('views/home/view.njk', viewModel);
	};
}
