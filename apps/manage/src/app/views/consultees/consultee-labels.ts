import type { PrismaClient } from '@pins/identify-consultees-database/src/client/client.ts';
import type { ConsulteeAreaDetail } from '@pins/identify-consultees-database/src/geospatial/consultee-areas.ts';
import {
	consulteeAreaDetails,
	sharedConsulteeNames
} from '@pins/identify-consultees-database/src/geospatial/consultee-areas.ts';

/**
 * Names for consultees that share one. Many do - 575 parish names are shared, 12 parishes are
 * called Middleton - so where a list or a suggestion would show the same name twice, each reads with
 * what tells it apart: a parish its council area, "Middleton (Lancaster)"; a generator its operator
 * and technology; anything else its region, or its subcategory. One that still reads like another -
 * two Middletons in North Yorkshire - adds its distance from the site. A name the reference data
 * has more than once reads that way even when the list has it only once, so one Newton added on
 * its own still says which Newton it is.
 */

/** A consultee as a list names it. */
export interface Labelled {
	id: string;
	name: string;
	/** From the site, when known - the last thing to tell two apart by. */
	distanceMetres?: number;
}

/** A distance as the add page and its labels give it - "3.2 km from the site". */
export function kilometresFromSite(metres: number): string {
	return `${(metres / 1000).toFixed(1)} km from the site`;
}

/** A name as names are compared: case, and runs of spaces, ignored. */
export function comparableName(name: string): string {
	return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

function metadataOf(detail: ConsulteeAreaDetail): Record<string, unknown> {
	try {
		const parsed: unknown = JSON.parse(detail.metadata);
		return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

const text = (value: unknown): string | undefined =>
	typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

/**
 * What tells a consultee from others of its name, by category: a parish's council area, a
 * generator's operator and technology, else its region or subcategory. None without any.
 */
export function distinguishingDetail(category: string, detail: ConsulteeAreaDetail | undefined): string | undefined {
	if (!detail) {
		return undefined;
	}
	if (detail.authority) {
		return detail.authority;
	}
	if (category === 'Electricity generators with compulsory purchase order powers') {
		const metadata = metadataOf(detail);
		const generator = [text(metadata.COMPANY_NAME), text(metadata.PRIMARY_TYPE)].filter(Boolean).join(', ');
		if (generator) {
			return generator;
		}
	}
	return text(detail.region) ?? text(detail.subcategory);
}

/**
 * Each item's label, by id: its name, or - when another item, or one of `alsoNamed`, has its name -
 * its name and what tells it apart (distinguishingDetail), then its distance from the site if that
 * still isn't enough.
 */
export function distinguishedLabels(
	items: Labelled[],
	category: string,
	details: ReadonlyMap<string, ConsulteeAreaDetail>,
	alsoNamed: readonly string[] = []
): Map<string, string> {
	const names = [...items.map((item) => comparableName(item.name)), ...alsoNamed.map(comparableName)];
	const shared = new Set(names.filter((name, index) => names.indexOf(name) !== index));
	const withDetail = items.map((item) => {
		const detail = shared.has(comparableName(item.name))
			? distinguishingDetail(category, details.get(item.id.toLowerCase()))
			: undefined;
		return { item, detail, label: detail ? `${item.name} (${detail})` : item.name };
	});
	const labels = new Map<string, string>();
	for (const { item, detail, label } of withDetail) {
		const same = withDetail.filter((other) => comparableName(other.label) === comparableName(label));
		const tellApart =
			shared.has(comparableName(item.name)) && (same.length > 1 || !detail) && item.distanceMetres !== undefined;
		labels.set(
			item.id,
			tellApart
				? `${item.name} (${[detail, kilometresFromSite(item.distanceMetres!)].filter(Boolean).join(', ')})`
				: label
		);
	}
	return labels;
}

/**
 * The ways a consultee's label can be typed back, as the add page offers them: with what tells it
 * apart, with that and its distance, or with its distance alone.
 */
export function labelVariants(item: Labelled, detail: string | undefined): string[] {
	const distance = item.distanceMetres === undefined ? undefined : kilometresFromSite(item.distanceMetres);
	return [
		...(detail ? [`${item.name} (${detail})`] : []),
		...(detail && distance ? [`${item.name} (${detail}, ${distance})`] : []),
		...(distance ? [`${item.name} (${distance})`] : [])
	];
}

/** A label's name, without its last bracket - "Middleton (Lancaster)" → "Middleton" - or none. */
export function nameBeforeLabel(typed: string): string | undefined {
	return /^(.*\S) \([^()]*\)$/.exec(typed)?.[1];
}

/**
 * Each item's label (distinguishedLabels), and which items share their name: with another item, one
 * of `alsoNamed`, or another consultee of the category in the reference data. What tells them apart
 * is looked up only for those. Nearby NSIPs (`isConsulteeCategory` false) are other cases, named
 * with their case reference already.
 */
export async function labelsWithReferenceData(
	dbClient: PrismaClient,
	category: string,
	isConsulteeCategory: boolean,
	items: Labelled[],
	alsoNamed: readonly string[] = []
): Promise<{ labels: Map<string, string>; sharing: Set<string> }> {
	const elsewhere = isConsulteeCategory
		? [
				...(await sharedConsulteeNames(
					dbClient,
					category,
					items.map((item) => item.name)
				))
			]
		: [];
	const names = [...items, ...alsoNamed.map((name) => ({ name })), ...elsewhere.map((name) => ({ name }))].map(
		({ name }) => comparableName(name)
	);
	const sharing = items.filter((item) => names.filter((name) => name === comparableName(item.name)).length > 1);
	const details =
		sharing.length > 0 && isConsulteeCategory
			? await consulteeAreaDetails(
					dbClient,
					sharing.map(({ id }) => id)
				)
			: new Map<string, ConsulteeAreaDetail>();
	return {
		labels: distinguishedLabels(items, category, details, [...alsoNamed, ...elsewhere]),
		sharing: new Set(sharing.map(({ id }) => id))
	};
}
