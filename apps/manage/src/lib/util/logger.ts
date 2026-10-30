import { createRequire } from 'node:module';
import pino, { type Logger } from 'pino';

const require = createRequire(import.meta.url);

interface InitLoggerOptions {
	logLevel: string;
	NODE_ENV: string;
}

export function initLogger(config: InitLoggerOptions): Logger {
	// pino-pretty options: https://github.com/pinojs/pino-pretty?tab=readme-ov-file#options
	const prettyTransport = {
		targets: [
			{
				target: 'pino-pretty',
				level: config.logLevel,
				options: {
					ignore: 'pid,hostname',
					colorize: true,
					translateTime: 'HH:MM:ss.l'
				}
			}
		]
	};

	const isProduction = config.NODE_ENV === 'production';
	const pinoPrettyIsAvailable = pinoPrettyAvailable();
	let transport = undefined;
	if (!isProduction && pinoPrettyIsAvailable) {
		// only pretty print in dev, and if pino-pretty is installed
		transport = prettyTransport;
	}
	// configure the pino logger for use within the app
	return pino({
		timestamp: pino.stdTimeFunctions.isoTime,
		level: config.logLevel,
		transport
	});
}

function pinoPrettyAvailable(): boolean {
	try {
		require.resolve('pino-pretty');
		return true;
	} catch {
		return false;
	}
}
