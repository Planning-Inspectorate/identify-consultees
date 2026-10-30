import { ConfidentialClientApplication, type AccountInfo, type AuthenticationResult } from '@azure/msal-node';
import type { RequestHandler } from 'express';
import type { Logger } from 'pino';
import type { IRedisClient } from '../redis/index.ts';
import { buildMsalConfig, type AuthConfig } from './config.ts';
import * as authSession from './session.service.ts';

type AuthenticationResultWithNonce = AuthenticationResult & {
	idTokenClaims: { nonce?: string };
};

export interface AuthServiceOptions {
	config: AuthConfig;
	logger: Logger;
	redisClient: IRedisClient | null;
}

export class AuthService {
	#config: AuthConfig;
	#logger: Logger;
	#redisClient: IRedisClient | null;
	#scopes: string[];
	#msalClient: ConfidentialClientApplication | null;

	constructor({ config, logger, redisClient }: AuthServiceOptions) {
		this.#config = config;
		this.#logger = logger;
		this.#redisClient = redisClient;
		this.#scopes = config.tokenScopes || ['User.Read'];
		this.#msalClient = null;
	}

	/**
	 * Acquire a {@link AuthenticationResultWithNonce} using a code sourced from the user
	 * having signed in manually at a MSAL authentication url.
	 */
	async acquireTokenByCode({
		code,
		sessionId,
		nonce
	}: {
		code: string;
		sessionId: string;
		nonce: string;
	}): Promise<AuthenticationResultWithNonce | null> {
		const msalClient = this.#getMsalClient(sessionId);
		await msalClient.getTokenCache().getAllAccounts(); // required to trigger beforeCacheAccess
		// msal-node >= 7 reads the expected nonce from request.nonce and ignores
		// authCodePayload.nonce (ConfidentialClientApplication sanitizes the payload),
		// so it must be set on the request here - passing it via the payload silently
		// drops it and every sign-in fails with nonceMismatch at /auth/redirect.
		return await msalClient.acquireTokenByCode({
			authority: this.#config.authority,
			code,
			redirectUri: this.#config.redirectUri,
			scopes: this.#scopes,
			nonce
		});
	}

	/**
	 * Acquire a new {@link AuthenticationResultWithNonce} using an account. Note that
	 * `acquireTokenSilent` will use a cached access token where possible, and only
	 * use a network request as a last resort.
	 */
	async acquireTokenSilent(
		account: AccountInfo,
		sessionId: string,
		customScopes = this.#scopes
	): Promise<AuthenticationResultWithNonce | null> {
		const msalClient = this.#getMsalClient(sessionId);
		await msalClient.getTokenCache().getAllAccounts(); // required to trigger beforeCacheAccess
		return await msalClient.acquireTokenSilent({
			account,
			scopes: customScopes
		});
	}

	/**
	 * Clear the token cache of all accounts/access tokens. This will force the
	 * msalClient to renegotiate authentication via a network request. To be used
	 * when signing a user out.
	 */
	async clearCacheForAccount(account: AccountInfo, sessionId: string): Promise<void> {
		const msalClient = this.#getMsalClient(sessionId);
		await msalClient.getTokenCache().removeAccount(account);
	}

	/**
	 * Obtain a url for the user to sign in using MSAL authentication. This url is
	 * scoped to the application via the `nonce` property.
	 */
	async getAuthCodeUrl(options: { nonce: string }, sessionId: string): Promise<string> {
		const msalClient = this.#getMsalClient(sessionId);
		return msalClient.getAuthCodeUrl({
			...options,
			authority: this.#config.authority,
			redirectUri: this.#config.redirectUri,
			scopes: this.#scopes
		});
	}

	get unauthorizedView(): string {
		return this.#config.unauthorizedView || 'views/errors/403';
	}

	/**
	 * If not using Redis, behave as a singleton and return the one global MSAL client.
	 * If using Redis, generate an MSAL client specific to the user's session ID.
	 */
	#getMsalClient(sessionId: string): ConfidentialClientApplication {
		const msalConfig = this.#buildMsalConfig();
		if (this.#redisClient) {
			return new ConfidentialClientApplication({
				...msalConfig,
				cache: { cachePlugin: this.#redisClient.makeCachePlugin(sessionId) }
			});
		}
		if (!this.#msalClient) {
			this.#msalClient = new ConfidentialClientApplication(msalConfig);
		}
		return this.#msalClient;
	}

	#buildMsalConfig() {
		const config = this.#config;
		const logger = this.#logger;
		return buildMsalConfig({ config, logger });
	}
}

export const registerAuthLocals: RequestHandler = (req, res, next) => {
	const account = authSession.getAccount(req.session);
	res.locals.isAuthenticated = Boolean(account);
	next();
};

export const clearAuthenticationData: RequestHandler = ({ session }, _, next) => {
	authSession.destroyAuthenticationData(session as authSession.SessionWithAuth);
	next();
};
