import type { BaseConfig } from '#lib/app/index.ts';
import path from 'node:path';
import { loadEnvFile } from 'node:process';
import { loadNearbyConsultees } from './nearby-consultees.ts';
import { loadScreeningConfig } from './screening-config.ts';

export interface Config extends BaseConfig {
	appHostname: string;
	// the URL of the Python function app's consultee-areas endpoint - see apps/function-python
	// undefined if not configured; only the consultee-areas-python page needs this, so its absence
	// shouldn't crash the whole app at boot (see its controller for the fallback behaviour)
	pythonFunctionUrl: string | undefined;
	// shared secret the Python function requires on its data route (sent as x-api-key) - see
	// apps/function-python/function_app.py; Key Vault-wired in infrastructure. Optional so local
	// setups without the function running keep working.
	pythonFunctionApiKey: string | undefined;
	// the app's own blob storage container (infrastructure/storage.tf) - Entra/managed-identity
	// auth only, no connection string/key (shared_access_key_enabled = false on the storage
	// account). Optional so local setups without a configured storage account keep working.
	blobStore:
		| {
				host: string;
				container: string;
		  }
		| undefined;
	// how far around a site the maps show consultees the ruleset didn't identify: the default, and a
	// distance per category - from config/nearby-consultees.yaml (see nearby-consultees.ts)
	nearbyConsulteeRadiusMetres: number;
	nearbyRadiusMetresByCategory?: Record<string, number>;
	// how far from the site another case is a Nearby NSIP - the same file's nsipRadiusKm; unset or 0
	// looks for none
	nearbyNsipRadiusMetres?: number;
	// screen a site whose simplified outline has more points than this against its bounding box -
	// config/screening.yaml (see screening-config.ts); unset or 0 never does up front
	boundingBoxAbovePoints?: number;
	// listen for CBOS's document events (its nsip-document Service Bus topic) and import a case's
	// boundaries when one changes - see cbos/subscriber.ts. Undefined - off - unless
	// CBOS_SUBSCRIBER_ENABLED=true and the namespace and subscription are set: the staging slot has
	// it off (infrastructure/app-web.tf), so only the live app takes the messages
	cbosSubscriber?: CbosSubscriberSettings;
	// whether the prototype/debug pages are mounted (/map-layers-demo, /components,
	// /consultee-areas-python, /consultee-areas-direct). On by default outside production; set
	// ENABLE_DEV_PAGES=true to enable them on a deployed environment running NODE_ENV=production
	// (e.g. reviewing component examples on test/training).
	devPagesEnabled: boolean;
	// whether the ?test-fail= triggers (views/consultees/test-faults.ts) are honoured, for QA
	// exercising the service's error states. On everywhere but the prod deployment (the
	// ENVIRONMENT app setting - infrastructure/app-web.tf); test and training run
	// NODE_ENV=production, so that alone can't gate them. TEMPORARY - remove before go-live
	// (see kt-docs/overview.md's "Before go-live").
	testFaultsEnabled: boolean;
	auth: {
		authority: string;
		clientId: string;
		clientSecret: string;
		disabled: boolean;
		groups: {
			// group ID for accessing the application
			applicationAccess: string;
		};
		redirectUri: string;
		signoutUrl: string;
	};
}

/** Where CBOS's document events are taken from: CBOS's Service Bus namespace, its topic, and our subscription. */
export interface CbosSubscriberSettings {
	/** Fully qualified, as pins-sb-back-office-dev-ukw-001.servicebus.windows.net. */
	namespace: string;
	topic: string;
	subscription: string;
}

/** The CBOS subscriber's settings when it's turned on and set up, else undefined (off). */
export function cbosSubscriberSettings(env: NodeJS.ProcessEnv): CbosSubscriberSettings | undefined {
	const namespace = env.CBOS_SERVICE_BUS_NAMESPACE?.trim();
	const subscription = env.CBOS_SERVICE_BUS_SUBSCRIPTION?.trim();
	if (env.CBOS_SUBSCRIBER_ENABLED !== 'true' || !namespace || !subscription) {
		return undefined;
	}
	return { namespace, topic: env.CBOS_SERVICE_BUS_TOPIC?.trim() || 'nsip-document', subscription };
}

// cache the config
let config: Config | undefined;

/**
 * Clear cached config. Used by unit tests when mutating process.env between cases.
 */
export function resetConfigCache(): void {
	config = undefined;
}

/**
 * Load configuration from the environment
 */
export function loadConfig(): Config {
	if (config) {
		return config;
	}
	// load configuration from .env file into process.env
	// prettier-ignore
	try {loadEnvFile()} catch {/* ignore errors*/}

	// get values from the environment
	const {
		APP_HOSTNAME,
		AUTH_CLIENT_ID,
		AUTH_CLIENT_SECRET,
		AUTH_DISABLED,
		AUTH_GROUP_APPLICATION_ACCESS,
		AUTH_TENANT_ID,
		BLOB_STORE_HOST,
		BLOB_STORE_CONTAINER,
		CACHE_CONTROL_MAX_AGE,
		ENABLE_DEV_PAGES,
		ENVIRONMENT,
		GIT_SHA,
		LOG_LEVEL,
		PORT,
		MANAGED_REDIS_URL,
		NODE_ENV,
		PYTHON_FUNCTION_URL,
		PYTHON_FUNCTION_API_KEY,
		SESSION_SECRET,
		SQL_CONNECTION_STRING
	} = process.env;

	const buildConfig = loadBuildConfig();

	if (!SESSION_SECRET) {
		throw new Error('SESSION_SECRET is required');
	}

	let httpPort = 8090;
	if (PORT) {
		// PORT is set by App Service
		const port = parseInt(PORT);
		if (isNaN(port)) {
			throw new Error('PORT must be an integer');
		}
		httpPort = port;
	}

	const nearbyConsultees = loadNearbyConsultees();
	const screening = loadScreeningConfig();

	const isProduction = NODE_ENV === 'production';

	const authDisabled = AUTH_DISABLED === 'true' && !isProduction;
	if (!authDisabled) {
		const props = {
			AUTH_CLIENT_ID,
			AUTH_CLIENT_SECRET,
			AUTH_GROUP_APPLICATION_ACCESS,
			AUTH_TENANT_ID
		};
		for (const [k, v] of Object.entries(props)) {
			if (v === undefined || v === '') {
				throw new Error(k + ' must be a non-empty string');
			}
		}
	}

	const protocol = APP_HOSTNAME?.startsWith('localhost') ? 'http://' : 'https://';

	config = {
		appHostname: APP_HOSTNAME || '',
		pythonFunctionUrl: PYTHON_FUNCTION_URL || undefined,
		pythonFunctionApiKey: PYTHON_FUNCTION_API_KEY || undefined,
		blobStore:
			BLOB_STORE_HOST && BLOB_STORE_CONTAINER ? { host: BLOB_STORE_HOST, container: BLOB_STORE_CONTAINER } : undefined,
		nearbyConsulteeRadiusMetres: nearbyConsultees.defaultRadiusMetres,
		nearbyRadiusMetresByCategory: nearbyConsultees.radiusMetresByCategory,
		nearbyNsipRadiusMetres: nearbyConsultees.nsipRadiusMetres,
		boundingBoxAbovePoints: screening.boundingBoxAbovePoints,
		devPagesEnabled: !isProduction || ENABLE_DEV_PAGES === 'true',
		testFaultsEnabled: ENVIRONMENT !== 'prod',
		cbosSubscriber: cbosSubscriberSettings(process.env),
		auth: {
			authority: `https://login.microsoftonline.com/${AUTH_TENANT_ID}`,
			clientId: AUTH_CLIENT_ID || '',
			clientSecret: AUTH_CLIENT_SECRET || '',
			disabled: authDisabled,
			groups: {
				applicationAccess: AUTH_GROUP_APPLICATION_ACCESS || ''
			},
			redirectUri: `${protocol}${APP_HOSTNAME}/auth/redirect`,
			signoutUrl: `https://login.microsoftonline.com/common/oauth2/v2.0/logout?post_logout_redirect_uri=${encodeURIComponent(`${protocol}${APP_HOSTNAME}/signed-out`)}`
		},
		cacheControl: {
			maxAge: CACHE_CONTROL_MAX_AGE || '1d'
		},
		database: {
			connectionString: SQL_CONNECTION_STRING
		},
		gitSha: GIT_SHA,
		// the log level to use
		logLevel: LOG_LEVEL || 'info',
		NODE_ENV: NODE_ENV || 'development',
		// the HTTP port to listen on
		httpPort: httpPort,
		// the src directory
		srcDir: buildConfig.srcDir,
		session: {
			redisPrefix: 'manage:',
			redis: MANAGED_REDIS_URL,
			secret: SESSION_SECRET
		},
		// the static directory to serve assets from (images, css, etc..)
		staticDir: buildConfig.staticDir
	};

	return config;
}

export interface BuildConfig {
	srcDir: string;
	staticDir: string;
}

/**
 * Config required for the build script
 */
export function loadBuildConfig(): BuildConfig {
	// get the file path for the src directory
	const srcDir = path.join(import.meta.dirname, '..');
	// get the file path for the .static directory
	const staticDir = path.join(srcDir, '.static');

	return {
		srcDir,
		staticDir
	};
}
