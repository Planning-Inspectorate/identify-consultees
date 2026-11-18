import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	cellSortKey,
	initSortableTable,
	initSortableTables,
	registerSortableTables,
	sortedRows
} from './sortable-table.js';

function documentWith(body = '') {
	const dom = new JSDOM(`<!DOCTYPE html><html><body>${body}</body></html>`);
	return dom.window.document;
}

/** A two-column table like the report's: a sortable and a plain Actions column. */
function tableHtml({ headExtra = '', rows, module = true } = {}) {
	return `<table class="govuk-table"${module ? ' data-module="moj-sortable-table"' : ''}>
		<caption class="govuk-table__caption">Included consultees</caption>
		<thead><tr>
			<th scope="col" aria-sort="none">Name</th>
			<th scope="col" aria-sort="none">Count</th>
			<th scope="col"${headExtra}>Actions</th>
		</tr></thead>
		<tbody>${rows
			.map(
				([name, count, attrs = '']) =>
					`<tr><th scope="row">${name}</th><td${attrs}>${count}</td><td><a href="#">Remove</a></td></tr>`
			)
			.join('')}
		</tbody>
	</table>`;
}

const rowNames = (document) => [...document.querySelectorAll('tbody tr')].map((row) => row.cells[0].textContent);

describe('sortable table cell keys', () => {
	test('text is the key, trimmed; numbers sort as numbers', () => {
		const document = documentWith(tableHtml({ rows: [['Bournmoor', '2']] }));
		const cells = document.querySelector('tbody tr').cells;
		assert.equal(cellSortKey(cells[0]), 'Bournmoor');
		assert.equal(cellSortKey(cells[1]), 2);
	});

	test('data-sort-value overrides the text, in kind', () => {
		const document = documentWith(tableHtml({ rows: [['Bournmoor', 'two', ' data-sort-value="4.9"']] }));
		assert.equal(cellSortKey(document.querySelector('tbody td')), 4.9);
		const withTextKey = documentWith(tableHtml({ rows: [['Bournmoor', '2', ' data-sort-value="near"']] }));
		assert.equal(cellSortKey(withTextKey.querySelector('tbody td')), 'near');
	});

	test('an empty data-sort-value falls back to the cell text; an empty cell is text', () => {
		const document = documentWith(tableHtml({ rows: [['Bournmoor', '7', ' data-sort-value=""']] }));
		assert.equal(cellSortKey(document.querySelector('tbody td')), 7);
		const empty = documentWith(tableHtml({ rows: [['Bournmoor', ' ']] }));
		assert.equal(cellSortKey(empty.querySelector('tbody td')), '');
	});
});

describe('sortable table row ordering', () => {
	function rows(document) {
		return [...document.querySelectorAll('tbody tr')];
	}

	test('text sorts alphabetically, numbers by count', () => {
		const document = documentWith(
			tableHtml({
				rows: [
					['Charlie', '10'],
					['Alpha', '2'],
					['Bravo', '30']
				]
			})
		);
		assert.deepEqual(
			sortedRows(rows(document), 0, 'ascending').map((row) => row.cells[0].textContent),
			['Alpha', 'Bravo', 'Charlie']
		);
		assert.deepEqual(
			sortedRows(rows(document), 0, 'descending').map((row) => row.cells[0].textContent),
			['Charlie', 'Bravo', 'Alpha']
		);
		// '2' < '10' numerically - a text sort would put '10' first
		assert.deepEqual(
			sortedRows(rows(document), 1, 'ascending').map((row) => row.cells[0].textContent),
			['Alpha', 'Charlie', 'Bravo']
		);
	});

	test('names order naturally and regardless of case', () => {
		const document = documentWith(
			tableHtml({
				rows: [
					['Ward 10', 'x'],
					['bournmoor', 'x'],
					['Ward 2', 'x']
				]
			})
		);
		assert.deepEqual(
			sortedRows(rows(document), 0, 'ascending').map((row) => row.cells[0].textContent),
			['bournmoor', 'Ward 2', 'Ward 10']
		);
	});

	test('a mixed column still orders, numbers with numbers', () => {
		const document = documentWith(
			tableHtml({
				rows: [
					['c', 'apple'],
					['a', '9'],
					['b', '40']
				]
			})
		);
		assert.deepEqual(
			sortedRows(rows(document), 1, 'ascending').map((row) => row.cells[0].textContent),
			['a', 'b', 'c']
		);
	});

	test('a row missing the cell sorts on an empty key', () => {
		const document = documentWith(
			`<table><thead><tr><th aria-sort="none">Name</th><th aria-sort="none">Count</th></tr></thead>
			<tbody>
				<tr><td>b</td><td>1</td></tr>
				<tr><td>a</td></tr>
			</tbody></table>`
		);
		assert.deepEqual(
			sortedRows(rows(document), 1, 'ascending').map((row) => row.cells[0].textContent),
			['a', 'b']
		);
	});
});

describe('sortable table enhancement', () => {
	test('sortable headers get buttons; a plain header stays text', () => {
		const document = documentWith(tableHtml({ rows: [['Bournmoor', '2']] }));
		initSortableTable(document.querySelector('table'));

		const headers = [...document.querySelectorAll('thead th')];
		const [name, count, actions] = headers;
		assert.equal(name.querySelector('button').textContent.trim(), 'Name');
		assert.equal(count.querySelector('button').textContent.trim(), 'Count');
		assert.equal(actions.querySelector('button'), null);
		assert.equal(actions.textContent, 'Actions');
		// each sortable button carries the un-sorted up/down indicator to start
		assert.ok(name.querySelector('button svg'));
		assert.equal(name.getAttribute('aria-sort'), 'none');
	});

	test('clicking a header sorts ascending then descending and announces it', () => {
		const document = documentWith(
			tableHtml({
				rows: [
					['Charlie', '30'],
					['Alpha', '10'],
					['Bravo', '2']
				]
			})
		);
		initSortableTable(document.querySelector('table'));

		const nameButton = document.querySelector('thead th[aria-sort] button');
		nameButton.click();
		assert.deepEqual(rowNames(document), ['Alpha', 'Bravo', 'Charlie']);
		assert.equal(document.querySelector('thead th').getAttribute('aria-sort'), 'ascending');
		assert.equal(document.querySelector('table + div[role="status"]').textContent, 'Sort by Name (ascending)');

		nameButton.click();
		assert.deepEqual(rowNames(document), ['Charlie', 'Bravo', 'Alpha']);
		assert.equal(document.querySelector('thead th').getAttribute('aria-sort'), 'descending');
		assert.equal(document.querySelector('table + div[role="status"]').textContent, 'Sort by Name (descending)');
	});

	test('sorting another column resets the first; clicking the arrow svg sorts too', () => {
		const document = documentWith(
			tableHtml({
				rows: [
					['Charlie', '30'],
					['Alpha', '10'],
					['Bravo', '2']
				]
			})
		);
		initSortableTable(document.querySelector('table'));
		const [nameButton, countButton] = document.querySelectorAll('thead button');

		nameButton.click();
		// a click landing on the arrow itself still finds the button
		countButton.querySelector('svg').dispatchEvent(new document.defaultView.MouseEvent('click', { bubbles: true }));
		assert.deepEqual(rowNames(document), ['Bravo', 'Alpha', 'Charlie']);
		const headers = document.querySelectorAll('thead th[aria-sort]');
		assert.equal(headers[0].getAttribute('aria-sort'), 'none');
		assert.equal(headers[1].getAttribute('aria-sort'), 'ascending');
	});

	test('clicks that miss a sortable header change nothing', () => {
		const document = documentWith(
			tableHtml({
				rows: [
					['B', '1'],
					['A', '2']
				]
			})
		);
		initSortableTable(document.querySelector('table'));
		const before = rowNames(document);

		// the Actions header has no button, and a click on a bare text node is ignored
		document
			.querySelectorAll('thead th')[2]
			.dispatchEvent(new document.defaultView.MouseEvent('click', { bubbles: true }));
		document
			.querySelector('thead th button')
			.parentElement.dispatchEvent(new document.defaultView.MouseEvent('click', { bubbles: true }));
		assert.deepEqual(rowNames(document), before);
	});

	test('rows move with moveBefore where the browser has it', () => {
		const document = documentWith(
			tableHtml({
				rows: [
					['B', '1'],
					['A', '2']
				]
			})
		);
		const table = document.querySelector('table');
		const moved = [];
		// jsdom has no moveBefore - stub the Chrome/Firefox primitive on this tbody
		Object.defineProperty(table.tBodies[0], 'moveBefore', {
			value: (row, before) => moved.push([row.cells[0].textContent, before])
		});
		initSortableTable(table);
		document.querySelector('thead button').click();
		assert.deepEqual(moved, [
			['A', null],
			['B', null]
		]);
	});

	test('a served ascending or descending column is sorted on load', () => {
		const document = documentWith(
			`<table data-module="moj-sortable-table"><caption>t</caption><thead><tr>
				<th aria-sort="none">Name</th><th aria-sort="descending">Count</th>
			</tr></thead><tbody>
				<tr><td>a</td><td>2</td></tr><tr><td>b</td><td>10</td></tr>
			</tbody></table>`
		);
		initSortableTable(document.querySelector('table'));
		assert.deepEqual(rowNames(document), ['b', 'a']);
	});

	test('the caption tells assistive tech the headers are sortable, once', () => {
		const document = documentWith(tableHtml({ rows: [['Bournmoor', '2']] }));
		initSortableTable(document.querySelector('table'));
		assert.equal(
			document.querySelector('caption .govuk-visually-hidden').textContent,
			' (column headers with buttons are sortable).'
		);

		// a caption already carrying hidden text is left as it is, and a table
		// without a caption just doesn't get one
		const withHidden = documentWith(tableHtml({ rows: [['Bournmoor', '2']] }));
		withHidden.querySelector('caption').innerHTML = '<span class="govuk-visually-hidden">sorted</span>';
		initSortableTable(withHidden.querySelector('table'));
		assert.equal(withHidden.querySelectorAll('caption .govuk-visually-hidden').length, 1);
		assert.equal(withHidden.querySelector('caption .govuk-visually-hidden').textContent, 'sorted');

		const noCaption = documentWith(
			`<table data-module="moj-sortable-table"><thead><tr><th aria-sort="none">Name</th></tr></thead><tbody><tr><td>a</td></tr></tbody></table>`
		);
		initSortableTable(noCaption.querySelector('table'));
		assert.equal(noCaption.querySelector('caption'), null);
	});

	test('incomplete or already-enhanced tables are left alone', () => {
		const noHead = documentWith('<table data-module="moj-sortable-table"><tbody><tr><td>a</td></tr></tbody></table>');
		initSortableTable(noHead.querySelector('table'));
		assert.equal(noHead.querySelector('button'), null);

		const noBody = documentWith(
			'<table data-module="moj-sortable-table"><thead><tr><th aria-sort="none">N</th></tr></thead></table>'
		);
		initSortableTable(noBody.querySelector('table'));
		assert.equal(noBody.querySelector('button'), null);

		// nothing sortable - no buttons, no live region
		const plain = documentWith(tableHtml({ rows: [['B', '1']] }));
		for (const th of plain.querySelectorAll('th')) {
			th.removeAttribute('aria-sort');
		}
		initSortableTable(plain.querySelector('table'));
		assert.equal(plain.querySelector('button'), null);
		assert.equal(plain.querySelector('div[role="status"]'), null);

		// a second pass doesn't double-wrap
		const document = documentWith(tableHtml({ rows: [['B', '1']] }));
		const table = document.querySelector('table');
		initSortableTable(table);
		initSortableTable(table);
		assert.equal(document.querySelectorAll('thead button').length, 2);
		assert.equal(document.querySelectorAll('div[role="status"]').length, 1);
	});
});

describe('sortable tables on a page', () => {
	test('every marked table is enhanced, unmarked tables are not', () => {
		const document = documentWith(tableHtml({ rows: [['B', '1']] }) + tableHtml({ rows: [['C', '1']], module: false }));
		initSortableTables(document);
		assert.equal(document.querySelectorAll('button').length, 2);
		assert.equal(document.querySelectorAll('table')[1].querySelector('button'), null);
	});

	test('a section can be enhanced instead of the whole document', () => {
		const document = documentWith(
			`<div id="region">${tableHtml({ rows: [['B', '1']] })}</div>` + tableHtml({ rows: [['C', '1']] })
		);
		initSortableTables(document.getElementById('region'));
		assert.equal(document.querySelectorAll('button').length, 2);
	});

	test('runs once the page has loaded', () => {
		const loaded = documentWith(tableHtml({ rows: [['B', '1']] }));
		Object.defineProperty(loaded, 'readyState', { value: 'complete' });
		registerSortableTables(loaded);
		assert.equal(loaded.querySelectorAll('button').length, 2);

		const loading = documentWith(tableHtml({ rows: [['B', '1']] }));
		Object.defineProperty(loading, 'readyState', { value: 'loading' });
		registerSortableTables(loading);
		assert.equal(loading.querySelectorAll('button').length, 0);
		loading.dispatchEvent(new loading.defaultView.Event('DOMContentLoaded'));
		assert.equal(loading.querySelectorAll('button').length, 2);

		// no document (node) - nothing to do
		registerSortableTables(undefined);
	});
});
