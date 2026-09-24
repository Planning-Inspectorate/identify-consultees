import { ManageService } from '#service';
import { createApp, prepareStaticAssetServing } from './app/app.ts';
import { loadConfig } from './app/config.ts';

const config = loadConfig();
const service = new ManageService(config);

await prepareStaticAssetServing(service);
const app = createApp(service);

// Trust proxy, because our application is behind Front Door
// required for secure session cookies
// see https://expressjs.com/en/resources/middleware/session.html#cookiesecure
app.set('trust proxy', true);

// set the HTTP port to use from loaded config
app.set('http-port', config.httpPort);

// HTTP/1.1 origin listener by design. Azure Front Door terminates client HTTP/2
// (and eventually HTTP/3/QUIC when enabled on the CDN) and forwards to App Service
// over HTTP/1.1. Do not attach experimental node:quic / HTTP/3 here — see AGENTS.md
// "HTTP protocols and Azure Front Door" and infrastructure/front-door.tf.
app.listen(app.get('http-port'), () => {
	service.logger.info(`Server is running at http://localhost:${app.get('http-port')} in ${app.get('env')} mode`);
});
