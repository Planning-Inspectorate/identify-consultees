import type { Request } from 'express';
import { ipKeyGenerator } from 'express-rate-limit';

/**
 * Who a request is from, for the rate limiters: the client's own address. Behind Front Door and
 * App Service, `req.ip` (with `trust proxy` 1, see server.ts) can be a Front Door edge's address -
 * so every user coming through one edge would share a limit. Front Door sets `X-Azure-ClientIP` to
 * the address that connected to it, and the web app only takes traffic from Front Door (the
 * module's `front_door_restriction`, infrastructure/app-web.tf), so it's the one to trust; locally,
 * where there's no Front Door, `req.ip`. An IPv6 address is keyed by its /56, as express-rate-limit
 * advises, so one client can't step round the limit by changing its last bits.
 */
export function clientAddressKey(req: Pick<Request, 'ip' | 'headers'>): string {
	const header = req.headers['x-azure-clientip'];
	const fromFrontDoor = (Array.isArray(header) ? header[0] : header)?.trim();
	return ipKeyGenerator(fromFrontDoor || req.ip || '');
}
