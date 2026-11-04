import type { BaseConfig } from '@planning-inspectorate/core/app';
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
	// the hours of the day, UK time, the app imports every CBOS boundary on its own - as the admin
	// page's button does (admin/import-from-cbos/scheduled-import.ts). From CBOS_IMPORT_HOURS
	// ("7,10,13,16,19"); empty - off - unless set, and the staging slot has it off
	// (infrastructure/app-web.tf), so only the live app imports
	cbosImportHours: number[];
	auth: {
		authority: string;
		clientId: string;
		clientSecret: string;
		disabled: boolean;
		groups: {
			// group ID for accessing the application
			applicationAccess: string;
			// group ID for the admin section (/admin) - from AUTH_GROUP_ADMIN. Empty - unset - leaves it
			// open to everyone with application access, as before there was one (admin/access.ts)
			admin: string;
		};
		redirectUri: string;
		signoutUrl: string;
	};
}

/** CBOS_IMPORT_HOURS's hours, in order: whole hours 0 to 23, comma separated. Unset or empty is none. */
export function parseImportHours(value: string | undefined): number[] {
	const parts = (value ?? '')
		.split(',')
		.map((part) => part.trim())
		.filter(Boolean);
	const hours = parts.map(Number);
	if (hours.some((hour) => !Number.isInteger(hour) || hour < 0 || hour > 23)) {
		throw new Error(`CBOS_IMPORT_HOURS must be whole hours from 0 to 23, comma separated, not "${value}"`);
	}
	return [...new Set(hours)].toSorted((a, b) => a - b);
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
		AUTH_GROUP_ADMIN,
		AUTH_GROUP_APPLICATION_ACCESS,
		AUTH_TENANT_ID,
		BLOB_STORE_HOST,
		CBOS_IMPORT_HOURS,
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
		cbosImportHours: parseImportHours(CBOS_IMPORT_HOURS),
		auth: {
			authority: `https://login.microsoftonline.com/${AUTH_TENANT_ID}`,
			clientId: AUTH_CLIENT_ID || '',
			clientSecret: AUTH_CLIENT_SECRET || '',
			disabled: authDisabled,
			groups: {
				applicationAccess: AUTH_GROUP_APPLICATION_ACCESS || '',
				admin: AUTH_GROUP_ADMIN?.trim() || ''
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
