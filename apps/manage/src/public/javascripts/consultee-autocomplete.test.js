import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { afterEach, describe, mock, test } from 'node:test';
import {
	enhanceConsulteeInput,
	initConsulteeAutocomplete,
	matchingSuggestions,
	readSuggestions,
	registerConsulteeAutocomplete,
	suggestionHtml
} from './consultee-autocomplete.js';

const FORM = `
	<form>
		<label for="consultee-name">Name of consultee</label>
		<input class="govuk-input govuk-input--error" id="consultee-name" name="name" value="Bar"
			list="nearby-consultees" data-consultee-autocomplete>
		<datalist id="nearby-consultees">
			<option value="Barton" label="1.3 km from the site"></option>
			<option value="Christleton" label="7.3 km from the site"></option>
			<option value="No Hint"></option>
		</datalist>
	</form>`;

function documentWith(body = FORM) {
	return new JSDOM(`<!DOCTYPE html><html><body>${body}</body></html>`).window.document;
}

afterEach(() => {
	delete globalThis.accessibleAutocomplete;
});

describe('consultee autocomplete', () => {
	test('reads the datalist as suggestions, with each one’s distance as its hint', () => {
		const document = documentWith();
		assert.deepEqual(readSuggestions(document.getElementById('nearby-consultees')), [
			{ name: 'Barton', hint: '1.3 km from the site' },
			{ name: 'Christleton', hint: '7.3 km from the site' },
			// an option without a label reads its value as its label
			{ name: 'No Hint', hint: '' }
		]);
	});

	test('matches names containing the query, those starting with it first, case aside', () => {
		const suggestions = [
			{ name: 'Comberbach', hint: '' },
			{ name: 'Christleton', hint: '' },
			{ name: 'Northwich', hint: '' },
			{ name: 'Barton', hint: '' }
		];
		assert.deepEqual(
			matchingSuggestions(suggestions, ' CH ').map((suggestion) => suggestion.name),
			['Christleton', 'Comberbach', 'Northwich']
		);
	});

	test('writes a suggestion as its name then its hint, escaped', () => {
		assert.equal(
			suggestionHtml({ name: 'A & <B>', hint: '1.0 km "from" the site' }),
			'A &amp; &lt;B&gt; <span class="pins-autocomplete__hint">1.0 km &quot;from&quot; the site</span>'
		);
		assert.equal(suggestionHtml({ name: "O'Brien", hint: '' }), 'O&#39;Brien');
		// the library passes a typed string, or nothing, through the same template
		assert.equal(suggestionHtml('typed <text>'), 'typed &lt;text&gt;');
		assert.equal(suggestionHtml(undefined), '');
	});

	test('swaps the input for the accessible autocomplete, keeping its id, name, value and classes', () => {
		const document = documentWith();
		const accessibleAutocomplete = mock.fn();
		const input = document.getElementById('consultee-name');

		assert.equal(enhanceConsulteeInput(input, accessibleAutocomplete), true);

		assert.equal(document.getElementById('nearby-consultees'), null);
		assert.equal(input.isConnected, false);
		const [options] = accessibleAutocomplete.mock.calls[0].arguments;
		assert.equal(options.element.tagName, 'DIV');
		assert.equal(options.element.className, 'pins-autocomplete pins-autocomplete--error');
		assert.equal(options.element.parentElement.tagName, 'FORM');
		assert.equal(options.id, 'consultee-name');
		assert.equal(options.name, 'name');
		assert.equal(options.defaultValue, 'Bar');
		assert.equal(options.inputClasses, 'govuk-input govuk-input--error');
		// any name can be typed - nothing replaces it on blur, and no "No results found"
		assert.equal(options.confirmOnBlur, false);
		assert.equal(options.showNoOptionsFound, false);
		assert.equal(options.minLength, 1);

		const populate = mock.fn();
		options.source('chr', populate);
		assert.deepEqual(populate.mock.calls[0].arguments[0], [{ name: 'Christleton', hint: '7.3 km from the site' }]);
		assert.equal(options.templates.inputValue({ name: 'Barton', hint: '' }), 'Barton');
		assert.equal(options.templates.inputValue('typed'), 'typed');
		assert.equal(options.templates.inputValue(undefined), '');
		assert.equal(options.templates.suggestion, suggestionHtml);
	});

	test('leaves the input as it is without its datalist or the library', () => {
		const document = documentWith(`
			<input id="no-list" data-consultee-autocomplete>
			<input id="missing-list" list="nowhere" data-consultee-autocomplete>
			<input id="not-a-datalist" list="a-div" data-consultee-autocomplete><div id="a-div"></div>
			${FORM}`);
		const accessibleAutocomplete = mock.fn();
		for (const id of ['no-list', 'missing-list', 'not-a-datalist']) {
			assert.equal(enhanceConsulteeInput(document.getElementById(id), accessibleAutocomplete), false);
		}
		assert.equal(enhanceConsulteeInput(document.getElementById('consultee-name'), undefined), false);
		assert.equal(accessibleAutocomplete.mock.callCount(), 0);
		assert.ok(document.getElementById('nearby-consultees'));
	});

	test('enhances every marked input on the page', () => {
		const document = documentWith(`${FORM.replace(' govuk-input--error', '')}<input name="other">`);
		const accessibleAutocomplete = mock.fn();
		initConsulteeAutocomplete(document, accessibleAutocomplete);
		assert.equal(accessibleAutocomplete.mock.callCount(), 1);
		// no error, no error border
		assert.equal(accessibleAutocomplete.mock.calls[0].arguments[0].element.className, 'pins-autocomplete');
	});

	test('runs once the page has loaded, with the library the page loaded', () => {
		globalThis.accessibleAutocomplete = mock.fn();

		const loaded = documentWith();
		Object.defineProperty(loaded, 'readyState', { value: 'complete' });
		registerConsulteeAutocomplete(loaded);
		assert.equal(globalThis.accessibleAutocomplete.mock.callCount(), 1);

		const loading = documentWith();
		Object.defineProperty(loading, 'readyState', { value: 'loading' });
		registerConsulteeAutocomplete(loading);
		assert.equal(globalThis.accessibleAutocomplete.mock.callCount(), 1);
		loading.dispatchEvent(new loading.defaultView.Event('DOMContentLoaded'));
		assert.equal(globalThis.accessibleAutocomplete.mock.callCount(), 2);

		// no document (node) - nothing to do
		registerConsulteeAutocomplete(undefined);
	});
});
