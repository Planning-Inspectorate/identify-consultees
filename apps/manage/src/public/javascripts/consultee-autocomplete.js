/**
 * The category page's add form: swaps the name input's native datalist for the GOV.UK accessible
 * autocomplete (accessible-autocomplete.min.js, loaded before this as `window.accessibleAutocomplete`).
 *
 * Suggestions are the consultees near the site the ruleset didn't identify, each with its distance.
 * Any other name can still be typed - the server matches the name either way, so without this
 * script (or the library) the form works the same with the browser's own datalist suggestions.
 */

/**
 * @typedef {{ name: string, hint: string }} Suggestion
 */

/**
 * The datalist's options as suggestions.
 * @param {HTMLDataListElement} datalist
 * @returns {Suggestion[]}
 */
export function readSuggestions(datalist) {
	return [...datalist.querySelectorAll('option')].map((option) => ({
		name: option.value,
		hint: option.getAttribute('label') ?? ''
	}));
}

/**
 * The suggestions whose names contain `query` (case aside), those starting with it first.
 * @param {Suggestion[]} suggestions
 * @param {string} query
 * @returns {Suggestion[]}
 */
export function matchingSuggestions(suggestions, query) {
	const wanted = query.trim().toLowerCase();
	const matches = suggestions.filter((suggestion) => suggestion.name.toLowerCase().includes(wanted));
	const starting = matches.filter((suggestion) => suggestion.name.toLowerCase().startsWith(wanted));
	return [...starting, ...matches.filter((suggestion) => !starting.includes(suggestion))];
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeHtml(value) {
	return value.replace(
		/[&<>"']/g,
		(character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]
	);
}

/**
 * How a suggestion reads in the menu: its name, then its distance from the site.
 * @param {Suggestion | string | undefined} suggestion
 * @returns {string}
 */
export function suggestionHtml(suggestion) {
	if (!suggestion || typeof suggestion === 'string') {
		return escapeHtml(suggestion ?? '');
	}
	const hint = suggestion.hint ? ` <span class="pins-autocomplete__hint">${escapeHtml(suggestion.hint)}</span>` : '';
	return `${escapeHtml(suggestion.name)}${hint}`;
}

/**
 * Swap one name input for the accessible autocomplete, keeping its id, name, value and classes (so
 * its label, and its error styling, still apply). False, leaving the input as it is, when there's
 * no datalist or no library.
 * @param {HTMLInputElement} input
 * @param {unknown} accessibleAutocomplete
 * @returns {boolean}
 */
export function enhanceConsulteeInput(input, accessibleAutocomplete) {
	const listId = input.getAttribute('list');
	const datalist = listId ? input.ownerDocument.getElementById(listId) : null;
	if (!(datalist instanceof input.ownerDocument.defaultView.HTMLDataListElement)) {
		return false;
	}
	if (typeof accessibleAutocomplete !== 'function') {
		return false;
	}

	const suggestions = readSuggestions(datalist);
	const container = input.ownerDocument.createElement('div');
	// pins-autocomplete--error carries a GOV.UK error border onto the autocomplete's own input
	container.className = input.classList.contains('govuk-input--error')
		? 'pins-autocomplete pins-autocomplete--error'
		: 'pins-autocomplete';
	input.replaceWith(container);
	datalist.remove();
	accessibleAutocomplete({
		element: container,
		id: input.id,
		name: input.name,
		defaultValue: input.value,
		minLength: 1,
		// a typed name that matches no suggestion is still a name to add - don't swap it on blur, or
		// say "No results found"
		confirmOnBlur: false,
		showNoOptionsFound: false,
		inputClasses: input.className,
		source: (query, populate) => populate(matchingSuggestions(suggestions, query)),
		templates: {
			inputValue: (suggestion) => (suggestion && typeof suggestion === 'object' ? suggestion.name : (suggestion ?? '')),
			suggestion: suggestionHtml
		}
	});
	return true;
}

/**
 * Enhance every add form name input on the page.
 * @param {Document} documentTarget
 * @param {unknown} accessibleAutocomplete
 */
export function initConsulteeAutocomplete(documentTarget, accessibleAutocomplete) {
	for (const input of documentTarget.querySelectorAll('input[data-consultee-autocomplete]')) {
		enhanceConsulteeInput(input, accessibleAutocomplete);
	}
}

/**
 * Run once the page has loaded - module scripts run after the deferred library script before them.
 * @param {Document | undefined} documentTarget
 */
export function registerConsulteeAutocomplete(documentTarget = globalThis.document) {
	if (!documentTarget) {
		return;
	}
	const init = () => initConsulteeAutocomplete(documentTarget, globalThis.accessibleAutocomplete);
	if (documentTarget.readyState === 'loading') {
		documentTarget.addEventListener('DOMContentLoaded', init);
		return;
	}
	init();
}

registerConsulteeAutocomplete();
