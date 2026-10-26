import { ManageService } from '#service';
import { sleep } from '@planning-inspectorate/core/util';
import { createApp, prepareStaticAssetServing } from './app/app.ts';
import { loadConfig } from './app/config.ts';

const config = loadConfig();
const service = new ManageService(config);

// @planning-inspectorate/core's RedisClient kicks off client.connect() in the background
// without awaiting it (see its constructor) - accepting traffic before that resolves lets the
// first request needing a session (e.g. the auth redirect on /, since auth can't be disabled in
// production) call session.save() while the client is still "offline", which throws in a spot
// that isn't caught and crashes the whole process. That's been causing a deploy-time restart
// loop (the container never stays up long enough for /health to succeed). Wait here instead.
async function waitForRedisReady(): Promise<void> {
	const client = service.redisClient?.fullClient;
	if (!client || client.isReady) {
		return;
	}
	const deadline = Date.now() + 15_000;
	while (!client.isReady && Date.now() < deadline) {
		await sleep(100);
	}
	if (!client.isReady) {
		service.logger.warn('Redis was not ready after 15s waiting at startup - starting anyway');
	}
}

await waitForRedisReady();

await prepareStaticAssetServing(service);
const app = createApp(service);

// Trust one proxy hop (Azure App Service ARR in front of the Node process).
// Front Door terminates TLS and forwards to App Service; App Service then
// presents a single reverse-proxy hop to this origin. Use a hop count — not
// `true` — so express-rate-limit can trust req.ip (ERR_ERL_PERMISSIVE_TRUST_PROXY).
// Also required for secure session cookies via X-Forwarded-Proto.
// see https://expressjs.com/en/guide/behind-proxies.html
// see https://express-rate-limit.github.io/ERR_ERL_PERMISSIVE_TRUST_PROXY/
app.set('trust proxy', 1);

// set the HTTP port to use from loaded config
app.set('http-port', config.httpPort);

// HTTP/1.1 origin listener by design. Azure Front Door terminates client HTTP/2
// (and eventually HTTP/3/QUIC when enabled on the CDN) and forwards to App Service
// over HTTP/1.1. Do not attach experimental node:quic / HTTP/3 here — see AGENTS.md
// "HTTP protocols and Azure Front Door" and infrastructure/front-door.tf.
app.listen(app.get('http-port'), () => {
	service.logger.info(`Server is running at http://localhost:${app.get('http-port')} in ${app.get('env')} mode`);
});
