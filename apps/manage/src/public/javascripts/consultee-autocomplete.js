/**
 * The "Add a consultee" page: swaps the name input's native datalist for the GOV.UK accessible
 * autocomplete (accessible-autocomplete.min.js, loaded before this as `window.accessibleAutocomplete`).
 *
 * Suggestions are the consultees near the site the ruleset didn't identify, each with its distance -
 * and, for a consultee category, once three letters are typed, the rest of its reference data whose
 * names start with them, from the page's suggestions URL (`data-suggestions-url`): every Newton for
 * "Newton", each saying which it is. Any other name can still be typed - the server matches the name
 * either way, so without this script (or the library) the form works the same with the browser's own
 * datalist suggestions.
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

// what's typed before the server's suggestions are asked for, and how long typing pauses first
const MIN_REMOTE_QUERY = 3;
const REMOTE_DELAY_MS = 200;

/**
 * Whether a server reply's item is a suggestion.
 * @param {unknown} item
 * @returns {item is Suggestion}
 */
function isSuggestion(item) {
	return Boolean(item) && typeof item.name === 'string' && typeof item.hint === 'string';
}

/**
 * The server's suggestions for `query`, or none when it can't give them.
 * @param {string} url
 * @param {string} query
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<Suggestion[]>}
 */
export async function fetchSuggestions(url, query, fetchImpl = globalThis.fetch) {
	try {
		const response = await fetchImpl(`${url}&q=${encodeURIComponent(query)}`, {
			headers: { Accept: 'application/json' },
			credentials: 'same-origin'
		});
		if (!response.ok) {
			return [];
		}
		const body = await response.json();
		return Array.isArray(body) ? body.filter(isSuggestion) : [];
	} catch {
		return [];
	}
}

/**
 * `local`, then those of `remote` it doesn't already have, by name, case aside.
 * @param {Suggestion[]} local
 * @param {Suggestion[]} remote
 * @returns {Suggestion[]}
 */
export function mergeSuggestions(local, remote) {
	const names = new Set(local.map((suggestion) => suggestion.name.toLowerCase()));
	return [...local, ...remote.filter((suggestion) => !names.has(suggestion.name.toLowerCase()))];
}

/**
 * The autocomplete's source: the page's own suggestions at once, then - for a long enough query,
 * once typing pauses - with what the server adds. A reply to an earlier query is dropped.
 * @param {Suggestion[]} suggestions
 * @param {string | undefined} url
 * @param {{ fetchImpl?: typeof fetch, delayMs?: number }} [options]
 * @returns {(query: string, populate: (results: Suggestion[]) => void) => void}
 */
export function suggestionSource(suggestions, url, { fetchImpl, delayMs = REMOTE_DELAY_MS } = {}) {
	let latest = '';
	let timer;
	return (query, populate) => {
		latest = query;
		const local = matchingSuggestions(suggestions, query);
		populate(local);
		clearTimeout(timer);
		if (!url || query.trim().length < MIN_REMOTE_QUERY) {
			return;
		}
		timer = setTimeout(async () => {
			const remote = await fetchSuggestions(url, query.trim(), fetchImpl);
			if (latest === query && remote.length > 0) {
				populate(mergeSuggestions(local, remote));
			}
		}, delayMs);
	};
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
		// the input's value is typed in below instead, so what matches it shows at once
		defaultValue: '',
		minLength: 1,
		// a typed name that matches no suggestion is still a name to add - don't swap it on blur, or
		// say "No results found"
		confirmOnBlur: false,
		showNoOptionsFound: false,
		inputClasses: input.className,
		source: suggestionSource(suggestions, input.getAttribute('data-suggestions-url') || undefined),
		templates: {
			inputValue: (suggestion) => (suggestion && typeof suggestion === 'object' ? suggestion.name : (suggestion ?? '')),
			suggestion: suggestionHtml
		}
	});
	showMatchesFor(container, input.value);
	return true;
}

/**
 * Put `value` - a name typed back, when the page is shown again with an error - into the autocomplete
 * as if typed, so its matches show without another keystroke: given it as its default value, the
 * library only looks for them once the text changes ("There is more than one Newton - choose the one
 * you mean from the list" would show no list).
 * @param {HTMLElement} container
 * @param {string} value
 */
function showMatchesFor(container, value) {
	const rendered = container.querySelector('input');
	if (!value || !rendered) {
		return;
	}
	rendered.value = value;
	rendered.dispatchEvent(new container.ownerDocument.defaultView.Event('input', { bubbles: true }));
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
