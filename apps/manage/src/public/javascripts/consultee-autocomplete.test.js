import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { afterEach, describe, mock, test } from 'node:test';
import {
	enhanceConsulteeInput,
	fetchSuggestions,
	initConsulteeAutocomplete,
	matchingSuggestions,
	mergeSuggestions,
	readSuggestions,
	registerConsulteeAutocomplete,
	suggestionHtml,
	suggestionSource
} from './consultee-autocomplete.js';

const FORM = `
	<form>
		<label for="consultee-name">Name</label>
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
		// the value is typed in once it's rendered instead (see the next test)
		assert.equal(options.defaultValue, '');
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

	test('types the input value into the rendered autocomplete, so its matches show at once', () => {
		const document = documentWith();
		const typed = [];
		const accessibleAutocomplete = mock.fn(({ element }) => {
			const rendered = document.createElement('input');
			rendered.addEventListener('input', () => typed.push(rendered.value));
			element.append(rendered);
		});
		enhanceConsulteeInput(document.getElementById('consultee-name'), accessibleAutocomplete);
		assert.deepEqual(typed, ['Bar']);
		assert.equal(document.querySelector('.pins-autocomplete input').value, 'Bar');
	});

	test('types nothing in when the input is empty, or nothing was rendered', () => {
		const document = documentWith(FORM.replace(' value="Bar"', ''));
		const typed = [];
		const accessibleAutocomplete = mock.fn(({ element }) => {
			const rendered = document.createElement('input');
			rendered.addEventListener('input', () => typed.push(rendered.value));
			element.append(rendered);
		});
		enhanceConsulteeInput(document.getElementById('consultee-name'), accessibleAutocomplete);
		assert.deepEqual(typed, []);

		// a library that renders nothing leaves nothing to type into
		assert.equal(enhanceConsulteeInput(documentWith().getElementById('consultee-name'), mock.fn()), true);
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

describe('consultee autocomplete suggestions from the server', () => {
	const PAGE = [
		{ name: 'Barton', hint: '1.3 km from the site' },
		{ name: 'Newton (Ribble Valley)', hint: '3.0 km from the site' }
	];
	const reply = (body, ok = true) => mock.fn(async () => ({ ok, json: async () => body }));
	const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

	test('asks for the typed name, and keeps only suggestions from the reply', async () => {
		const fetchImpl = reply([{ name: 'Newton (Craven)', hint: '60.0 km from the site' }, { name: 1 }, null]);
		assert.deepEqual(await fetchSuggestions('/add/suggestions?ruleset=r', 'New ton', fetchImpl), [
			{ name: 'Newton (Craven)', hint: '60.0 km from the site' }
		]);
		const [url, init] = fetchImpl.mock.calls[0].arguments;
		assert.equal(url, '/add/suggestions?ruleset=r&q=New%20ton');
		assert.equal(init.headers.Accept, 'application/json');
	});

	test("has none when the server can't give them", async () => {
		assert.deepEqual(await fetchSuggestions('/s?', 'New', reply([], false)), []);
		assert.deepEqual(await fetchSuggestions('/s?', 'New', reply({ not: 'a list' })), []);
		const offline = mock.fn(async () => {
			throw new Error('offline');
		});
		assert.deepEqual(await fetchSuggestions('/s?', 'New', offline), []);
	});

	test("adds the server's to the page's own, without repeating a name", () => {
		assert.deepEqual(
			mergeSuggestions(PAGE, [
				{ name: 'newton (ribble valley)', hint: '3.0 km from the site' },
				{ name: 'Newton (Craven)', hint: '60.0 km from the site' }
			]),
			[...PAGE, { name: 'Newton (Craven)', hint: '60.0 km from the site' }]
		);
	});

	test("shows the page's matches at once, then the server's once typing pauses", async () => {
		const fetchImpl = reply([{ name: 'Newton (Craven)', hint: '60.0 km from the site' }]);
		const source = suggestionSource(PAGE, '/s?ruleset=r', { fetchImpl, delayMs: 0 });
		const populate = mock.fn();

		source('newt', populate);
		assert.deepEqual(populate.mock.calls[0].arguments[0], [PAGE[1]]);
		await settle();
		assert.deepEqual(populate.mock.calls[1].arguments[0], [
			PAGE[1],
			{ name: 'Newton (Craven)', hint: '60.0 km from the site' }
		]);
		assert.equal(fetchImpl.mock.callCount(), 1);
	});

	test("doesn't ask for fewer than three letters, without a URL, or show a reply to an earlier query", async () => {
		const fetchImpl = reply([{ name: 'Newton (Craven)', hint: '' }]);
		const populate = mock.fn();
		suggestionSource(PAGE, '/s?', { fetchImpl, delayMs: 0 })('ne', populate);
		suggestionSource(PAGE, undefined, { fetchImpl, delayMs: 0 })('newton', populate);
		await settle();
		assert.equal(fetchImpl.mock.callCount(), 0);

		// typing on before the first reply: only the latest query's reply shows
		let answer;
		const slow = mock.fn(
			() =>
				new Promise((resolve) => {
					answer = resolve;
				})
		);
		const source = suggestionSource(PAGE, '/s?', { fetchImpl: slow, delayMs: 0 });
		const shown = mock.fn();
		source('newt', shown);
		await settle();
		source('newto', shown);
		answer({ ok: true, json: async () => [{ name: 'Newton (Craven)', hint: '' }] });
		await settle();
		// the page's matches for each query, and no reply to "newt"
		assert.equal(shown.mock.callCount(), 2);

		// and nothing more when the server has nothing to add
		const empty = mock.fn();
		suggestionSource(PAGE, '/s?', { fetchImpl: reply([]), delayMs: 0 })('newton', empty);
		await settle();
		assert.equal(empty.mock.callCount(), 1);
	});

	test("asks the input's suggestions URL once typing pauses", async () => {
		const document = documentWith(
			FORM.replace('data-consultee-autocomplete>', 'data-consultee-autocomplete data-suggestions-url="/s?r=1">')
		);
		const accessibleAutocomplete = mock.fn();
		enhanceConsulteeInput(document.getElementById('consultee-name'), accessibleAutocomplete);
		const fetchImpl = mock.fn(async () => ({ ok: true, json: async () => [] }));
		const original = globalThis.fetch;
		globalThis.fetch = fetchImpl;
		try {
			accessibleAutocomplete.mock.calls[0].arguments[0].source('barton', () => {});
			assert.equal(fetchImpl.mock.callCount(), 0);
			await new Promise((resolve) => setTimeout(resolve, 250));
			assert.equal(fetchImpl.mock.calls[0].arguments[0], '/s?r=1&q=barton');
		} finally {
			globalThis.fetch = original;
		}
	});
});
