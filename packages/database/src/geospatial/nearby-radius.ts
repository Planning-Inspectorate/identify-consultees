/**
 * Fallback for the nearby radius used by runRuleset (see rulesets.ts) when a caller doesn't specify
 * one - a caller running inside a configured app (e.g. apps/manage) should normally pass its own
 * value sourced from an env var, so this distance can be tuned without a code change. Consultees
 * within the radius are shown by default regardless of which ruleset condition (if any) actually
 * matches them - both as a simple baseline view in its own right, and as the source every
 * `intersection` condition at or under this radius is filtered from rather than each querying the
 * database separately.
 *
 * Deliberately dependency-free: apps/manage's config module imports this value at build time (to
 * resolve NEARBY_CONSULTEE_RADIUS_KM's default), before the generated Prisma client exists - pulling
 * this in from rulesets.ts instead (which re-exports from consultee-areas.ts, which imports the
 * generated client) broke that Docker build stage, since `npm run build` runs before `npm run
 * db-generate`.
 */
export const DEFAULT_NEARBY_RADIUS_METRES = 20_000;
