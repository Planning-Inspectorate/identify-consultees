import type { ManageService } from '#service';
import { getAccount } from '@planning-inspectorate/core/auth';
import type { RequestHandler } from 'express';

/**
 * Who may use the admin section: the members of its Entra group (AUTH_GROUP_ADMIN), on top of the
 * application access group every page needs. Everyone signed in while no admin group is set - as
 * before there was one - and everyone locally, with sign-in off.
 */

type AdminAccessService = Pick<ManageService, 'authDisabled' | 'authConfig' | 'logger'>;

/** Whether the request's signed-in user may use the admin section. */
export function canUseAdmin(service: AdminAccessService, session: Express.Request['session']): boolean {
	const adminGroup = service.authConfig.groups.admin;
	if (service.authDisabled || !adminGroup) {
		return true;
	}
	const groups = getAccount(session)?.idTokenClaims?.groups;
	return Array.isArray(groups) && groups.includes(adminGroup);
}

/** Refuses the admin section, with the 403 page, to anyone not in its group. */
export function buildAssertAdminAccess(service: AdminAccessService): RequestHandler {
	return (req, res, next) => {
		if (canUseAdmin(service, req.session)) {
			next();
			return;
		}
		service.logger.warn({ path: req.originalUrl }, 'admin section refused: not in the admin group');
		res.status(403).render('views/errors/403.njk');
	};
}

/**
 * The header's Admin link, on every page, for those who may use the admin section - set before the
 * routes so any page's header can show it. No link for anyone else.
 */
export function buildAdminHeaderLink(service: AdminAccessService): RequestHandler {
	return (req, res, next) => {
		if (canUseAdmin(service, req.session)) {
			res.locals.adminLink = { href: '/admin', active: req.path === '/admin' || req.path.startsWith('/admin/') };
		}
		next();
	};
}
