import { load } from 'js-yaml';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CONFIG_DIR } from '../config-dir.ts';

/**
 * Which consultee category each of the reference data's source datasets loads as, from
 * config/reference-data.yaml - see the file for what each setting means.
 */
export interface ReferenceDataConfig {
	/** Consultee category by dataset code: AMB_EW → Ambulance Trust. */
	datasets: ReadonlyMap<string, string>;
	/**
	 * By dataset code, the category a subcategory of it loads as instead - OWF_EW's Offshore Wind
	 * Export Cables → Offshore Wind Export Cable. Subcategories are keyed lower case.
	 */
	subcategories: ReadonlyMap<string, ReadonlyMap<string, string>>;
}

const FILE = 'reference-data.yaml';
const DATASET_CODE = /^[A-Z]+_[A-Z]{2}$/;
// a feature id naming its dataset: a lower-case group, the dataset code, then a number -
// health_AMB_EW_00001, administrative_boundaries_FRS_EW_00001
const DATASET_ID = /^[a-z]+(?:_[a-z]+)*_([A-Z]+_[A-Z]{2})_\d+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
	throw new Error(`${FILE}: ${message}`);
}

function category(value: unknown, setting: string): string {
	if (typeof value !== 'string' || value.trim() === '') {
		fail(`${setting} must be a consultee category`);
	}
	return value.trim();
}

/** A subcategory as subcategories are compared: case, and runs of spaces, ignored. */
function subcategoryKey(subcategory: string): string {
	return subcategory.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** A dataset's settings: its category alone, or its category and the subcategories that load as another. */
function datasetSettings(code: string, value: unknown): { category: string; subcategories?: Map<string, string> } {
	if (!isRecord(value)) {
		return { category: category(value, `datasets.${code}`) };
	}
	const unknown = Object.keys(value).filter((key) => key !== 'category' && key !== 'subcategories');
	if (unknown.length > 0) {
		fail(
			`datasets.${code} has ${unknown.map((key) => `"${key}"`).join(', ')} - it can only have category, subcategories`
		);
	}
	if (!isRecord(value.subcategories) || Object.keys(value.subcategories).length === 0) {
		fail(`datasets.${code}.subcategories must map each subcategory to its consultee category`);
	}
	return {
		category: category(value.category, `datasets.${code}.category`),
		subcategories: new Map(
			Object.entries(value.subcategories).map(([subcategory, value]) => [
				subcategoryKey(subcategory),
				category(value, `datasets.${code}.subcategories.${subcategory}`)
			])
		)
	};
}

export function parseReferenceDataConfig(text: string): ReferenceDataConfig {
	const document = text.trim() === '' ? null : load(text);
	if (!isRecord(document) || document.version !== 1) {
		fail('must be a version 1 document');
	}
	const unknown = Object.keys(document).filter((key) => key !== 'version' && key !== 'datasets');
	if (unknown.length > 0) {
		fail(`the document has ${unknown.map((key) => `"${key}"`).join(', ')} - it can only have version, datasets`);
	}
	if (!isRecord(document.datasets) || Object.keys(document.datasets).length === 0) {
		fail('datasets must map each dataset code to its consultee category');
	}
	const datasets = new Map<string, string>();
	const subcategories = new Map<string, Map<string, string>>();
	for (const [code, value] of Object.entries(document.datasets)) {
		if (!DATASET_CODE.test(code)) {
			fail(`datasets: "${code}" isn't a dataset code - write its capitals and area, as in AMB_EW`);
		}
		const settings = datasetSettings(code, value);
		datasets.set(code, settings.category);
		if (settings.subcategories) {
			subcategories.set(code, settings.subcategories);
		}
	}
	return { datasets, subcategories };
}

/** A feature from a dataset config/reference-data.yaml doesn't list - its message says which. */
export class UnknownDatasetError extends Error {}

/** The dataset a feature id names, if it names one: health_AMB_EW_00001 → AMB_EW. */
export function datasetCode(id: string): string | undefined {
	return DATASET_ID.exec(id)?.[1];
}

/**
 * A feature's consultee category: its dataset's, when its id names one - or, if the config gives
 * its subcategory a category of its own, that one - else the one the file gives it. A dataset the
 * config doesn't list throws, naming it, rather than loading as a category the rulesets don't match.
 */
export function consulteeCategoryFor(
	id: string,
	fileCategory: string | undefined,
	subcategory: string | null | undefined,
	config: ReferenceDataConfig = REFERENCE_DATA_CONFIG
): string | undefined {
	const code = datasetCode(id);
	if (code === undefined) {
		return fileCategory;
	}
	const category = config.datasets.get(code);
	if (category === undefined) {
		throw new UnknownDatasetError(
			`Feature ${id} is from dataset ${code}, which config/${FILE} doesn't list - add it to datasets with its consultee category`
		);
	}
	return (subcategory && config.subcategories.get(code)?.get(subcategoryKey(subcategory))) || category;
}

export const REFERENCE_DATA_CONFIG = parseReferenceDataConfig(readFileSync(path.join(CONFIG_DIR, FILE), 'utf8'));
