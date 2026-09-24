import { LogLevel } from '@azure/msal-node';
import { mockLogger } from '@planning-inspectorate/core/testing';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildMsalConfig } from './auth.ts';

describe('buildMsalConfig', () => {
	test('maps MSAL log levels onto the application logger', () => {
		const logger = mockLogger();
		const config = buildMsalConfig({
			config: {
				authority: 'https://login.microsoftonline.com/tenant',
				clientId: 'client',
				clientSecret: 'secret',
				disabled: false,
				groups: { applicationAccess: 'group' },
				redirectUri: 'http://localhost/auth/redirect',
				signoutUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/logout'
			},
			logger
		});

		assert.equal(config.auth.clientId, 'client');
		const callback = config.system?.loggerOptions?.loggerCallback;
		assert.ok(callback);

		callback(LogLevel.Error, 'error-message', false);
		callback(LogLevel.Warning, 'warn-message', false);
		callback(LogLevel.Info, 'info-message', false);
		callback(LogLevel.Verbose, 'debug-message', false);
		callback(99 as LogLevel, 'trace-message', false);

		assert.equal(logger.error.mock.callCount(), 1);
		assert.equal(logger.warn.mock.callCount(), 1);
		assert.equal(logger.info.mock.callCount(), 1);
		assert.equal(logger.debug.mock.callCount(), 1);
		assert.equal(logger.trace.mock.callCount(), 1);
	});
});
