import axe from 'axe-core';
import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { configureNunjucks } from './nunjucks.ts';

const pageLocals = {
	config: {
		styleFile: 'style.css',
		headerTitle: 'Manage template',
		footerLinks: []
	},
	cspNonce: 'test-nonce'
};

async function assertNoSeriousA11yViolations(html: string) {
	const dom = new JSDOM(html);
	const results = await axe.run(dom.window.document.documentElement, {
		// jsdom cannot compute styles reliably
		rules: {
			'color-contrast': { enabled: false },
			'link-in-text-block': { enabled: false }
		}
	});

	const serious = results.violations.filter(
		(violation) => violation.impact === 'critical' || violation.impact === 'serious'
	);

	assert.equal(serious.length, 0, serious.map((violation) => `${violation.id}: ${violation.help}`).join('\n'));
}

describe('manage page accessibility smoke', () => {
	const nunjucks = configureNunjucks();

	test('401 error page has no serious a11y violations', async () => {
		const html = nunjucks.render('views/errors/401.njk', {
			...pageLocals,
			pageHeading: 'Sorry, there is a problem with your login'
		});
		await assertNoSeriousA11yViolations(html);
	});

	test('403 error page has no serious a11y violations', async () => {
		const html = nunjucks.render('views/errors/403.njk', {
			...pageLocals,
			pageHeading: 'You do not have access to this service'
		});
		await assertNoSeriousA11yViolations(html);
	});

	test('404 error page has no serious a11y violations', async () => {
		const html = nunjucks.render('views/errors/404.njk', {
			...pageLocals,
			pageHeading: 'Page not found'
		});
		await assertNoSeriousA11yViolations(html);
	});

	test('500 error page has no serious a11y violations', async () => {
		const html = nunjucks.render('views/errors/500.njk', {
			...pageLocals,
			pageHeading: 'Sorry, there is a problem with the service'
		});
		await assertNoSeriousA11yViolations(html);
	});

	test('items list page has no serious a11y violations', async () => {
		const html = nunjucks.render('views/items/list/view.njk', {
			...pageLocals,
			pageHeading: 'Some Service Name',
			items: [
				{ task: 'Create new service', done: true },
				{ task: 'Implement a new feature', done: false }
			]
		});
		await assertNoSeriousA11yViolations(html);
	});
});
