import { initDatabaseClient } from '@pins/identify-consultees-database';
import type { PrismaClient } from '@pins/identify-consultees-database/src/client/client.ts';
import { BaseService } from '@planning-inspectorate/core/app';
import path from 'node:path';
import type { Config } from './config.ts';
import type { RulesetRunner } from './ruleset-runner.ts';
import { buildPythonRulesetRunner } from './ruleset-runner.ts';

/**
 * This class encapsulates all the services and clients for the application
 */
export class ManageService extends BaseService<PrismaClient> {
	/**
	 * @private
	 */
	#config: Config;
	#rulesetRunner: RulesetRunner;

	/**
	 * @param rulesetRunner - stands in for the Python function in tests; defaults to calling it
	 */
	constructor(config: Config, rulesetRunner?: RulesetRunner) {
		super(config, initDatabaseClient);
		this.#config = config;
		this.#rulesetRunner =
			rulesetRunner ??
			buildPythonRulesetRunner({ pythonFunctionUrl: config.pythonFunctionUrl, apiKey: config.pythonFunctionApiKey });
	}

	get authConfig(): Config['auth'] {
		return this.#config.auth;
	}

	get authDisabled(): boolean {
		return this.#config.auth.disabled;
	}

	get pythonFunctionUrl(): string | undefined {
		return this.#config.pythonFunctionUrl;
	}

	get pythonFunctionApiKey(): string | undefined {
		return this.#config.pythonFunctionApiKey;
	}

	/** Runs a ruleset's intersection logic - in the Python function (see ruleset-runner.ts). */
	get rulesetRunner(): RulesetRunner {
		return this.#rulesetRunner;
	}

	get blobStoreConfig(): Config['blobStore'] {
		return this.#config.blobStore;
	}

	get nearbyConsulteeRadiusMetres(): number {
		return this.#config.nearbyConsulteeRadiusMetres;
	}

	/** Whether the prototype/debug pages are mounted - see Config.devPagesEnabled. */
	get devPagesEnabled(): boolean {
		return this.#config.devPagesEnabled;
	}

	/**
	 * Built asset root (fingerprinted + Brotli sidecars). Used by our static middleware.
	 */
	get assetsStaticDir(): string {
		return this.#config.staticDir;
	}

	/**
	 * Empty mount used by `@planning-inspectorate/core` `createBaseApp` `express.static`
	 * so asset responses are owned by {@link createStaticAssetsMiddleware} instead.
	 */
	override get staticDir(): string {
		return path.join(this.#config.staticDir, '.core-static-noop');
	}
}
