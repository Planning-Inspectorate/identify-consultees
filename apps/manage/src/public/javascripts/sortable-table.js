/**
 * Sortable tables, ported from the MoJ Design System's sortable table
 * (design-patterns.service.justice.gov.uk/components/sortable-table). A port
 * rather than the moj-frontend package because the packaged component imports
 * govuk-frontend's internals as a bare specifier - it only works through a
 * bundler, and shipping the whole component bundle for one table widget would
 * cost far more than this file.
 *
 * Same contract, so the MoJ guidance applies:
 * - `table[data-module="moj-sortable-table"]` is enhanced; a button goes into
 *   every column header carrying `aria-sort` (headers without it - an Actions
 *   column, say - stay plain text and never sort).
 * - `data-sort-value` on a cell overrides its text as the sort key; numeric
 *   values (key or text) sort by number, anything else sorts as text. Both
 *   apply to any column added later - marking its header sortable is all a
 *   new column needs.
 * - `aria-sort="ascending"`/`"descending"` in the served markup sorts on load;
 *   `none` leaves the server's row order untouched until a header is clicked.
 * - A polite live region after the table announces each sort, and the caption
 *   gains "(column headers with buttons are sortable)" for assistive tech.
 *
 * Two deliberate deviations from the original, both for sort quality on these
 * tables: the text sort key is textContent, not innerHTML (the Identified
 * column's reasons are <br>-joined - markup has no place in a sort key), and
 * comparing is a cached Intl.Collator with numeric:true over keys read from
 * the DOM once per sort, rather than a localeCompare of values re-read per
 * comparison - so "Ward 2" sorts before "Ward 10" and a click costs O(n) DOM
 * reads, not O(n log n).
 *
 * Without this script the table reads exactly as the server rendered it.
 */

const SORTABLE_SELECTOR = 'table[data-module="moj-sortable-table"]';
/** Set once a table is enhanced - a second init pass must not re-wrap or duplicate. */
const ENHANCED_ATTRIBUTE = 'data-sortable-table-ready';

const SORT_DIRECTIONS = new Set(['ascending', 'descending']);

// the three indicator states, from the MoJ component - currentColor takes the
// button's link colour, or the focus colour when it has it
const UP_ARROW = `<svg width="22" height="22" focusable="false" aria-hidden="true" role="img" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M6.5625 15.5L11 6.63125L15.4375 15.5H6.5625Z" fill="currentColor"/>
</svg>`;
const DOWN_ARROW = `<svg width="22" height="22" focusable="false" aria-hidden="true" role="img" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M15.4375 7L11 15.8687L6.5625 7L15.4375 7Z" fill="currentColor"/>
</svg>`;
const UP_DOWN_ARROW = `<svg width="22" height="22" focusable="false" aria-hidden="true" role="img" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M8.1875 9.5L10.9609 3.95703L13.7344 9.5H8.1875Z" fill="currentColor"/>
<path d="M13.7344 12.0781L10.9609 17.6211L8.1875 12.0781H13.7344Z" fill="currentColor"/>
</svg>`;

// natural, case-insensitive ordering for the text keys ("Ward 2" < "Ward 10")
const COLLATOR = new Intl.Collator('en-GB', { numeric: true, sensitivity: 'base' });

/**
 * A cell's sort key: its `data-sort-value` when set, else its text. A value
 * that is wholly a number sorts as a number (counts, distances keyed by
 * `data-sort-value`); anything else compares as text.
 * @param {HTMLTableCellElement} cell
 * @returns {number | string}
 */
export function cellSortKey(cell) {
	const explicit = cell.getAttribute('data-sort-value');
	const value = explicit || cell.textContent.trim();
	const asNumber = Number(value);
	return value !== '' && Number.isFinite(asNumber) ? asNumber : value;
}

/**
 * `rows` sorted by `columnIndex`, `direction` ('ascending' or 'descending').
 * Each row's key is read once before the sort - the comparator never touches
 * the DOM.
 * @param {HTMLTableRowElement[]} rows
 * @param {number} columnIndex
 * @param {string} direction
 * @returns {HTMLTableRowElement[]}
 */
export function sortedRows(rows, columnIndex, direction) {
	const decorated = rows.map((row) => {
		const cell = row.cells[columnIndex];
		return { row, key: cell ? cellSortKey(cell) : '' };
	});
	decorated.sort((a, b) => {
		const [first, second] = direction === 'descending' ? [b.key, a.key] : [a.key, b.key];
		if (typeof first === 'number' && typeof second === 'number') {
			return first - second;
		}
		return COLLATOR.compare(String(first), String(second));
	});
	return decorated.map((entry) => entry.row);
}

/**
 * Replace each sortable heading's text with a button carrying that text - the
 * headers keep `aria-sort`; the buttons get the arrow indicators.
 * @param {HTMLTableCellElement[]} headings
 * @returns {HTMLButtonElement[]}
 */
function createHeadingButtons(headings) {
	return headings.map((heading) => {
		const button = heading.ownerDocument.createElement('button');
		button.type = 'button';
		button.textContent = heading.textContent;
		heading.textContent = '';
		heading.appendChild(button);
		return button;
	});
}

/**
 * The arrow each sortable button shows for its header's `aria-sort` state.
 * @param {HTMLTableCellElement[]} headings
 */
function updateDirectionIndicators(headings) {
	for (const heading of headings) {
		const button = heading.querySelector('button');
		button.querySelector('svg')?.remove();
		const direction = heading.getAttribute('aria-sort');
		const arrow = direction === 'ascending' ? UP_ARROW : direction === 'descending' ? DOWN_ARROW : UP_DOWN_ARROW;
		button.insertAdjacentHTML('beforeend', arrow);
	}
}

/**
 * The polite live region that announces each sort to screen readers.
 * @param {HTMLTableElement} table
 * @returns {HTMLDivElement}
 */
function createStatusBox(table) {
	const status = table.ownerDocument.createElement('div');
	status.setAttribute('aria-atomic', 'true');
	status.setAttribute('aria-live', 'polite');
	status.setAttribute('class', 'govuk-visually-hidden');
	status.setAttribute('role', 'status');
	table.insertAdjacentElement('afterend', status);
	return status;
}

/**
 * "(column headers with buttons are sortable)" on the caption, for assistive
 * tech - skipped when one is already there.
 * @param {HTMLTableElement} table
 */
function updateCaption(table) {
	const caption = table.querySelector('caption');
	if (!caption || caption.querySelector('.govuk-visually-hidden')) {
		return;
	}
	const assistive = caption.ownerDocument.createElement('span');
	assistive.classList.add('govuk-visually-hidden');
	assistive.textContent = ' (column headers with buttons are sortable).';
	caption.appendChild(assistive);
}

/**
 * Enhance one `data-module="moj-sortable-table"` table: heading buttons,
 * indicators, live region and the click-to-sort wiring. A table without both
 * head and body, or one already enhanced, is left alone.
 * @param {HTMLTableElement} table
 */
export function initSortableTable(table) {
	const head = table.tHead;
	const body = table.tBodies[0];
	if (!head || !body || table.hasAttribute(ENHANCED_ATTRIBUTE)) {
		return;
	}
	const headings = [...head.querySelectorAll('th[aria-sort]')];
	if (headings.length === 0) {
		return;
	}
	table.setAttribute(ENHANCED_ATTRIBUTE, '');

	createHeadingButtons(headings);
	updateCaption(table);
	updateDirectionIndicators(headings);
	const status = createStatusBox(table);

	const applySort = (columnIndex, direction) => {
		// moveBefore reorders the live rows without losing focus inside them
		// (a Remove link, say) - append() is the fallback where it's missing (Safari)
		const move =
			typeof body.moveBefore === 'function' ? (row) => body.moveBefore(row, null) : (row) => body.append(row);
		for (const row of sortedRows([...body.rows], columnIndex, direction)) {
			move(row);
		}
		for (const heading of headings) {
			heading.setAttribute('aria-sort', 'none');
		}
		// the sorted column is always one of the sortable headings - a click's own
		// header, or the pre-sorted one the markup named
		headings.find((heading) => heading.cellIndex === columnIndex).setAttribute('aria-sort', direction);
		updateDirectionIndicators(headings);
	};

	// a column the markup already has ascending/descending sorts on load
	const preSorted = headings.find((heading) => SORT_DIRECTIONS.has(heading.getAttribute('aria-sort')));
	if (preSorted) {
		applySort(preSorted.cellIndex, preSorted.getAttribute('aria-sort'));
	}

	head.addEventListener('click', (event) => {
		// event.target is the clicked node - the arrow's svg, the button's text, a
		// plain header cell: walk up to the sort button, then its sortable header
		const button = event.target?.closest?.('button');
		const heading = button?.closest('th[aria-sort]');
		if (!heading) {
			return;
		}
		const direction = heading.getAttribute('aria-sort') === 'ascending' ? 'descending' : 'ascending';
		applySort(heading.cellIndex, direction);
		// the arrow svg adds whitespace text to the button - collapse it out of the announcement
		status.textContent = `Sort by ${button.textContent.replace(/\s+/g, ' ').trim()} (${direction})`;
	});
}

/**
 * Enhance every sortable table under `documentTarget`.
 * @param {Document | HTMLElement} documentTarget
 */
export function initSortableTables(documentTarget) {
	for (const table of documentTarget.querySelectorAll(SORTABLE_SELECTOR)) {
		initSortableTable(table);
	}
}

/**
 * Run once the page has loaded - module scripts execute after parsing anyway,
 * but wait for DOMContentLoaded if one somehow runs early.
 * @param {Document | undefined} documentTarget
 */
export function registerSortableTables(documentTarget = globalThis.document) {
	if (!documentTarget) {
		return;
	}
	const init = () => initSortableTables(documentTarget);
	if (documentTarget.readyState === 'loading') {
		documentTarget.addEventListener('DOMContentLoaded', init);
		return;
	}
	init();
}

registerSortableTables();
