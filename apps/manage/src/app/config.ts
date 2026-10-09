import { DEFAULT_NEARBY_RADIUS_METRES } from '@pins/identify-consultees-database/src/geospatial/nearby-radius.ts';
import type { BaseConfig } from '@planning-inspectorate/core/app';
import path from 'node:path';
import { loadEnvFile } from 'node:process';

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
	// radius (metres) consultees are shown within by default on the results page, and the radius
	// most ruleset conditions are filtered from a single shared query rather than their own - see
	// packages/database/src/geospatial/rulesets.ts. Tunable via NEARBY_CONSULTEE_RADIUS_KM so this
	// can change without a code deploy; defaults to the package's own default if unset.
	nearbyConsulteeRadiusMetres: number;
	// whether the prototype/debug pages are mounted (/items, /map-layers-demo, /components,
	// /consultee-areas-python, /consultee-areas-direct). On by default outside production; set
	// ENABLE_DEV_PAGES=true to enable them on a deployed environment running NODE_ENV=production
	// (e.g. reviewing component examples on test/training).
	devPagesEnabled: boolean;
	auth: {
		authority: string;
		clientId: string;
		clientSecret: string;
		disabled: boolean;
		groups: {
			// group ID for accessing the application
			applicationAccess: string;
			// group ID for the /admin pages (blob upload, replace-imports). Optional - when
			// unset the /admin guard fails closed and denies everyone (see router.ts).
			admin: string;
		};
		redirectUri: string;
		signoutUrl: string;
	};
}

export type ENVIRONMENT_NAMES = Readonly<{ PROD: string; DEV: string; TEST: string; TRAINING: string }>;

/**
 * The environment names
 */
export const ENVIRONMENT_NAME: ENVIRONMENT_NAMES = Object.freeze({
	DEV: 'dev',
	TEST: 'test',
	TRAINING: 'training',
	PROD: 'prod'
});

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
		AUTH_GROUP_ADMIN,
		AUTH_GROUP_APPLICATION_ACCESS,
		AUTH_TENANT_ID,
		BLOB_STORE_HOST,
		BLOB_STORE_CONTAINER,
		CACHE_CONTROL_MAX_AGE,
		ENABLE_DEV_PAGES,
		GIT_SHA,
		LOG_LEVEL,
		NEARBY_CONSULTEE_RADIUS_KM,
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

	let nearbyConsulteeRadiusMetres = DEFAULT_NEARBY_RADIUS_METRES;
	if (NEARBY_CONSULTEE_RADIUS_KM) {
		const radiusKm = Number.parseFloat(NEARBY_CONSULTEE_RADIUS_KM);
		if (!Number.isFinite(radiusKm) || radiusKm <= 0) {
			throw new Error('NEARBY_CONSULTEE_RADIUS_KM must be a positive number');
		}
		nearbyConsulteeRadiusMetres = radiusKm * 1000;
	}

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
		nearbyConsulteeRadiusMetres,
		devPagesEnabled: !isProduction || ENABLE_DEV_PAGES === 'true',
		auth: {
			authority: `https://login.microsoftonline.com/${AUTH_TENANT_ID}`,
			clientId: AUTH_CLIENT_ID || '',
			clientSecret: AUTH_CLIENT_SECRET || '',
			disabled: authDisabled,
			groups: {
				applicationAccess: AUTH_GROUP_APPLICATION_ACCESS || '',
				admin: AUTH_GROUP_ADMIN || ''
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

/**
 * Load the environment the application is running in. The value should be
 * one of the ENVIRONMENT_NAME values defined at the top of the file, and matches
 * the environment variable in the infrastructure code.
 */
export function loadEnvironmentConfig(): string {
	// load configuration from .env file into process.env
	// prettier-ignore
	try {loadEnvFile()} catch {/* ignore errors*/}

	// get values from the environment
	const { ENVIRONMENT } = process.env;

	if (!ENVIRONMENT) {
		throw new Error('ENVIRONMENT is required');
	}

	if (!Object.values(ENVIRONMENT_NAME).includes(ENVIRONMENT)) {
		throw new Error(`ENVIRONMENT must be one of: ${Object.values(ENVIRONMENT_NAME)}`);
	}

	return ENVIRONMENT;
}
