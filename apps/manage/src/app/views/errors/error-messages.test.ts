import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { generateRuleSetError } from './error-messages.ts';

describe('generateRuleSetError', () => {
	const expectedBase = {
		pageHeading: 'Sorry, there is a problem with the service',
		messages: [
			{
				href: '',
				message: 'Refresh the page to try again'
			},
			'If you leave this page you will have to start this process again.'
		]
	};

	it('returns default error data without back link properties when called with no arguments', () => {
		const result = generateRuleSetError();

		assert.deepEqual(result, expectedBase);
		assert.equal('backLinkText' in result, false);
		assert.equal('backLinkUrl' in result, false);
	});

	it('omits backLinkText and backLinkUrl when empty strings are passed', () => {
		const result = generateRuleSetError({
			backLinkText: '',
			backLinkUrl: ''
		});

		assert.deepEqual(result, expectedBase);
	});

	it('includes backLinkText and backLinkUrl when both are provided', () => {
		const result = generateRuleSetError({
			backLinkText: 'Back to dashboard',
			backLinkUrl: '/dashboard'
		});

		assert.deepEqual(result, {
			...expectedBase,
			backLinkText: 'Back to dashboard',
			backLinkUrl: '/dashboard'
		});
	});

	it('includes only the provided back link property when partially specified', () => {
		const result = generateRuleSetError({ backLinkText: 'Back' });

		assert.deepEqual(result, {
			...expectedBase,
			backLinkText: 'Back'
		});
		assert.equal('backLinkUrl' in result, false);
	});
});
