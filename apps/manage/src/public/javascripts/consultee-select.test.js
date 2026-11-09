import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { enhanceConsulteeSelectTable, registerConsulteeSelect } from './consultee-select.js';
import { initSortableTables } from './sortable-table.js';

const row = (id, value, checked = '') => `
	<tr>
		<td>
			<div class="govuk-checkboxes__item govuk-checkboxes--small moj-multi-select__checkbox">
				<input class="govuk-checkboxes__input" id="select-${id}" name="match" type="checkbox" value="${value}" ${checked}>
				<label class="govuk-label govuk-checkboxes__label" for="select-${id}"><span class="govuk-visually-hidden">Select ${id}</span></label>
			</div>
		</td>
		<td>${id}</td>
	</tr>`;

// the server-rendered table: the header's Select all box carries a name so a
// no-JS tick submits `select-all` - the module strips it on enhancement
const TABLE = `
	<form method="get">
		<table data-module="consultee-select" data-id-prefix="consultees-">
			<thead>
				<tr>
					<th scope="col" id="consultees-select-all">
						<div class="govuk-checkboxes__item govuk-checkboxes--small moj-multi-select__checkbox">
							<input class="govuk-checkboxes__input" id="consultees-checkboxes-all" name="select-all" type="checkbox" value="true">
							<label class="govuk-label govuk-checkboxes__label moj-multi-select__toggle-label" for="consultees-checkboxes-all"><span class="govuk-visually-hidden">Select all</span></label>
						</div>
					</th>
					<th scope="col">Name</th>
				</tr>
			</thead>
			<tbody>
				${row('a', 'a')}
				${row('b', 'b', 'checked')}
				${row('c', '0')}
			</tbody>
		</table>
	</form>`;

function documentWith(body = TABLE) {
	return new JSDOM(`<!DOCTYPE html><html><body>${body}</body></html>`).window.document;
}

const checkedValues = (table) =>
	[...table.querySelectorAll('tbody input[type="checkbox"]')].filter((box) => box.checked).map((box) => box.value);

const selectAll = (table) => table.querySelector('#consultees-checkboxes-all');

describe('enhanceConsulteeSelectTable', () => {
	test("strips the toggle's name so it never submits - it only signals a no-JS select all", () => {
		const document = documentWith();
		const table = document.querySelector('table');
		const toggle = selectAll(table);
		assert.equal(toggle.name, 'select-all');
		enhanceConsulteeSelectTable(table);
		assert.equal(toggle.name, '');
	});

	test('Select all ticks every row box', () => {
		const document = documentWith();
		const table = document.querySelector('table');
		enhanceConsulteeSelectTable(table);
		selectAll(table).click();
		assert.deepEqual(checkedValues(table), ['a', 'b', '0']);
	});

	test('clicking it again clears every row box', () => {
		const document = documentWith();
		const table = document.querySelector('table');
		enhanceConsulteeSelectTable(table);
		const toggle = selectAll(table);
		toggle.click();
		toggle.click();
		assert.deepEqual(checkedValues(table), []);
	});

	test('unchecking a row box clears the toggle', () => {
		const document = documentWith();
		const table = document.querySelector('table');
		enhanceConsulteeSelectTable(table);
		const toggle = selectAll(table);
		toggle.click();
		assert.equal(toggle.checked, true);
		table.querySelector('#select-a').click();
		assert.equal(toggle.checked, false);
	});

	test('ticking every row box sets the toggle', () => {
		const document = documentWith();
		const table = document.querySelector('table');
		enhanceConsulteeSelectTable(table);
		const toggle = selectAll(table);
		table.querySelector('#select-a').click();
		assert.equal(toggle.checked, false);
		table.querySelector('#select-c').click();
		assert.equal(toggle.checked, true);
	});

	test('does nothing when the toggle is missing', () => {
		const document = documentWith(TABLE.replace(' id="consultees-checkboxes-all"', ''));
		const table = document.querySelector('table');
		assert.doesNotThrow(() => enhanceConsulteeSelectTable(table));
		assert.equal(table.querySelector('thead input[type="checkbox"]').name, 'select-all');
	});

	test('does nothing without row checkboxes', () => {
		const document = documentWith(
			`<table data-module="consultee-select" data-id-prefix="consultees-"><thead><tr><th><input id="consultees-checkboxes-all" type="checkbox"></th></tr></thead><tbody></tbody></table>`
		);
		const table = document.querySelector('table');
		assert.doesNotThrow(() => enhanceConsulteeSelectTable(table));
	});

	test('defaults to the #checkboxes-all toggle without data-id-prefix', () => {
		const document = documentWith(
			TABLE.replace(' data-id-prefix="consultees-"', '').replace(
				' id="consultees-checkboxes-all"',
				' id="checkboxes-all"'
			)
		);
		const table = document.querySelector('table');
		enhanceConsulteeSelectTable(table);
		const toggle = table.querySelector('#checkboxes-all');
		assert.equal(toggle.name, '');
		toggle.click();
		assert.deepEqual(checkedValues(table), ['a', 'b', '0']);
	});
});

describe('registerConsulteeSelect', () => {
	test('enhances every consultee-select table on the page', () => {
		// a second table with its own id prefix - ids must be unique on a page
		const OTHER = TABLE.replaceAll('consultees-', 'other-');
		const document = documentWith(`${TABLE}${OTHER}`);
		registerConsulteeSelect(document);
		document.dispatchEvent(new document.defaultView.Event('DOMContentLoaded'));
		assert.equal(document.querySelector('#consultees-checkboxes-all').name, '');
		assert.equal(document.querySelector('#other-checkboxes-all').name, '');
	});

	test('does nothing without a document', () => {
		assert.doesNotThrow(() => registerConsulteeSelect(undefined));
	});

	test('enhances straight away once the document has loaded', () => {
		const document = documentWith();
		Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });
		registerConsulteeSelect(document);
		assert.equal(selectAll(document.querySelector('table')).name, '');
	});

	test('waits for DOMContentLoaded while the document is still loading', () => {
		const document = documentWith();
		Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true });
		registerConsulteeSelect(document);
		// not yet enhanced
		assert.equal(selectAll(document.querySelector('table')).name, 'select-all');
		document.dispatchEvent(new document.defaultView.Event('DOMContentLoaded'));
		assert.equal(selectAll(document.querySelector('table')).name, '');
	});
});

// the category page's table carries both module names on one space-separated
// data-module - each module word-matches its own, so both enhancements run
const SHARED_TABLE = TABLE.replace(
	'data-module="consultee-select"',
	'data-module="moj-sortable-table consultee-select"'
)
	.replace('<thead>', '<caption>Included consultees</caption><thead>')
	.replace('<th scope="col">Name</th>', '<th scope="col" aria-sort="none">Name</th>');

describe('alongside the sortable table', () => {
	test('both modules enhance the shared table without touching each other', () => {
		const document = documentWith(SHARED_TABLE);
		registerConsulteeSelect(document);
		document.dispatchEvent(new document.defaultView.Event('DOMContentLoaded'));
		initSortableTables(document);
		const table = document.querySelector('table');
		// the select module stripped the no-JS submit name, and the sortable
		// module added a button only to the header carrying aria-sort - the
		// checkbox header keeps its Select all box untouched
		assert.equal(selectAll(table).name, '');
		assert.equal(table.querySelector('th#consultees-select-all button'), null);
		assert.match(table.querySelector('th[aria-sort] button').textContent, /^Name/);
	});

	test('a sorted row keeps its tick, and the toggle still spans the reordered rows', () => {
		const document = documentWith(SHARED_TABLE);
		const table = document.querySelector('table');
		enhanceConsulteeSelectTable(table);
		initSortableTables(document);
		// descending by Name (a, b, c -> c, b, a): the checked box travels with
		// its row rather than losing its tick to the reorder
		table.querySelector('th[aria-sort] button').click();
		table.querySelector('th[aria-sort] button').click();
		const rows = [...table.querySelectorAll('tbody tr')];
		assert.equal(rows[0].querySelector('input').id, 'select-c');
		assert.equal(rows[1].querySelector('input').id, 'select-b');
		assert.equal(rows[1].querySelector('input').checked, true);
		// Select all still reaches every box in the new row order (row c's
		// checkbox value is '0' - names and values differ in the fixture)
		selectAll(table).click();
		assert.deepEqual(checkedValues(table), ['0', 'b', 'a']);
	});
});
