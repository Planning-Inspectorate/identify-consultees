import type { ManageService } from '#service';
import { getAccount } from '@planning-inspectorate/core/auth';
import type { RequestHandler } from 'express';

/**
 * Who may use the admin section: the members of its Entra group (AUTH_GROUP_ADMIN), on top of the
 * application access group every page needs - and everyone locally, with sign-in off. With sign-in
 * on and no admin group set, no one: the section loads and clears the reference data, so an
 * environment that hasn't been given its group keeps it shut rather than open to every user.
 */

type AdminAccessService = Pick<ManageService, 'authDisabled' | 'authConfig' | 'logger'>;

/** Whether the request's signed-in user may use the admin section. */
export function canUseAdmin(service: AdminAccessService, session: Express.Request['session']): boolean {
	if (service.authDisabled) {
		return true;
	}
	const adminGroup = service.authConfig.groups.admin;
	if (!adminGroup) {
		return false;
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
		service.logger.warn(
			{ path: req.originalUrl },
			service.authConfig.groups.admin
				? 'admin section refused: not in the admin group'
				: 'admin section refused: no admin group is set (AUTH_GROUP_ADMIN)'
		);
		res.status(403).render('views/errors/403.njk');
	};
}
