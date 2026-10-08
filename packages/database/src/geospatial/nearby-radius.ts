/**
 * Default nearby radius the manage app sends with each ruleset run (apps/function-python runs it)
 * when NEARBY_CONSULTEE_RADIUS_KM isn't set, so this distance can be tuned without a code change.
 * Consultees within the radius are listed regardless of which ruleset condition (if any) matches
 * them, and every `intersection` condition at or under it is answered from that one fetch rather
 * than its own query.
 *
 * Deliberately dependency-free: apps/manage's config module imports this value at build time (to
 * resolve NEARBY_CONSULTEE_RADIUS_KM's default), before the generated Prisma client exists - a module
 * that imports the generated client broke that Docker build stage, since `npm run build` runs before
 * `npm run db-generate`.
 */
export const DEFAULT_NEARBY_RADIUS_METRES = 20_000;
