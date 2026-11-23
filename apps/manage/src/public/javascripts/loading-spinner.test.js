import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	enhanceLoadingTrigger,
	registerLoadingSpinners,
	removeLoadingOverlay,
	showLoadingOverlay
} from './loading-spinner.js';

function documentWith(body = '') {
	const dom = new JSDOM(`<!DOCTYPE html><html><body>${body}</body></html>`);
	return dom.window.document;
}

const overlayOf = (document) => document.querySelector('.indicator-loading');

describe('showLoadingOverlay', () => {
	test('appends the overlay with the spinner markup and message', () => {
		const document = documentWith();
		showLoadingOverlay(document, 'Creating report');
		const overlay = overlayOf(document);
		assert.ok(overlay);
		assert.equal(overlay.getAttribute('role'), 'status');
		assert.equal(overlay.querySelector('.indicator-loading__text').textContent, 'Creating report');
		const spinner = overlay.querySelector('.indicator-loading-spinner');
		assert.equal(spinner.getAttribute('aria-hidden'), 'true');
		assert.ok(spinner.querySelector('.indicator-loading-spinner__container'));
		assert.ok(spinner.querySelector('.indicator-loading-spinner__icon'));
	});

	test('falls back to "Loading" without a message', () => {
		const document = documentWith();
		showLoadingOverlay(document);
		assert.equal(overlayOf(document).querySelector('.indicator-loading__text').textContent, 'Loading');
	});

	test('a second call while one is up does not stack overlays', () => {
		const document = documentWith();
		showLoadingOverlay(document, 'First');
		showLoadingOverlay(document, 'Second');
		assert.equal(document.querySelectorAll('.indicator-loading').length, 1);
		assert.equal(overlayOf(document).querySelector('.indicator-loading__text').textContent, 'First');
	});

	test('does nothing without a document or a body to hang the overlay on', () => {
		assert.doesNotThrow(() => showLoadingOverlay(undefined));
		assert.doesNotThrow(() => showLoadingOverlay({ querySelector: () => null }));
	});
});

describe('removeLoadingOverlay', () => {
	test('removes the overlay when one is up', () => {
		const document = documentWith();
		showLoadingOverlay(document);
		removeLoadingOverlay(document);
		assert.equal(overlayOf(document), null);
	});

	test('is a no-op with no overlay or no document', () => {
		const document = documentWith();
		assert.doesNotThrow(() => removeLoadingOverlay(document));
		assert.doesNotThrow(() => removeLoadingOverlay(undefined));
	});
});

describe('enhanceLoadingTrigger', () => {
	test('a form shows the overlay on submit, with its data-loading-text', () => {
		const document = documentWith('<form data-loading-spinner data-loading-text="Identifying consultees"></form>');
		const form = document.querySelector('form');
		enhanceLoadingTrigger(form);
		form.dispatchEvent(new document.defaultView.Event('submit', { cancelable: true }));
		assert.equal(overlayOf(document).querySelector('.indicator-loading__text').textContent, 'Identifying consultees');
	});

	test('a link shows the overlay on click', () => {
		const document = documentWith('<a data-loading-spinner href="/somewhere">Create report</a>');
		const link = document.querySelector('a');
		enhanceLoadingTrigger(link);
		link.dispatchEvent(new document.defaultView.MouseEvent('click', { bubbles: true, cancelable: true }));
		assert.equal(overlayOf(document).querySelector('.indicator-loading__text').textContent, 'Loading');
	});

	test('an action another handler already cancelled shows no overlay', () => {
		const document = documentWith('<a data-loading-spinner href="/somewhere">Create report</a>');
		const link = document.querySelector('a');
		// like govuk-frontend's double-click debounce: the first listener wins
		link.addEventListener('click', (event) => event.preventDefault());
		enhanceLoadingTrigger(link);
		link.dispatchEvent(new document.defaultView.MouseEvent('click', { bubbles: true, cancelable: true }));
		assert.equal(overlayOf(document), null);
	});
});

describe('registerLoadingSpinners', () => {
	test('does nothing without a document', () => {
		assert.doesNotThrow(() => registerLoadingSpinners(undefined));
	});

	test('enhances every data-loading-spinner element once the document is ready', () => {
		const document = documentWith('<form data-loading-spinner></form><a data-loading-spinner href="#">go</a>');
		Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });
		registerLoadingSpinners(document);
		document.querySelector('form').dispatchEvent(new document.defaultView.Event('submit', { cancelable: true }));
		assert.ok(overlayOf(document));
	});

	test('enhances a document with no view to listen for cache restores on', () => {
		const fake = { readyState: 'complete', querySelectorAll: () => [], defaultView: undefined };
		assert.doesNotThrow(() => registerLoadingSpinners(fake));
	});

	test('waits for DOMContentLoaded while the document is still loading', () => {
		const document = documentWith('<form data-loading-spinner></form>');
		Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true });
		registerLoadingSpinners(document);
		document.querySelector('form').dispatchEvent(new document.defaultView.Event('submit', { cancelable: true }));
		assert.equal(overlayOf(document), null);
		document.dispatchEvent(new document.defaultView.Event('DOMContentLoaded'));
		document.querySelector('form').dispatchEvent(new document.defaultView.Event('submit', { cancelable: true }));
		assert.ok(overlayOf(document));
	});

	test('drops the overlay on pagehide and pageshow, for back/forward-cache restores', () => {
		const document = documentWith('<a data-loading-spinner href="#">go</a>');
		Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });
		registerLoadingSpinners(document);
		const show = () => {
			document.querySelector('a').dispatchEvent(new document.defaultView.MouseEvent('click', { cancelable: true }));
			assert.ok(overlayOf(document));
		};
		show();
		document.defaultView.dispatchEvent(new document.defaultView.Event('pagehide'));
		assert.equal(overlayOf(document), null);
		show();
		document.defaultView.dispatchEvent(new document.defaultView.Event('pageshow'));
		assert.equal(overlayOf(document), null);
	});
});
