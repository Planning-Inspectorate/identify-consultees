#!/usr/bin/env node
/**
 * Load smoke for the ruleset-run path - the service's slowest request (around a second
 * locally, several seconds against the smaller Azure databases). Not part of CI: run it
 * deliberately against a dev server or an environment to catch a run that has gotten
 * meaningfully slower.
 *
 * The report page needs sign-in unless the app runs with AUTH_DISABLED=true (as local dev
 * does), so an environment needs a signed-in session's cookie: sign in through the browser,
 * copy the `connect.sid` value from dev tools, and pass it as LOAD_COOKIE:
 *
 *   npm run load:smoke
 *   LOAD_BASE_URL=https://... LOAD_COOKIE='connect.sid=s%3A...' npm run load:smoke
 *   LOAD_BASE_URL=https://... LOAD_REQUESTS=50 LOAD_CONCURRENCY=8 npm run load:smoke
 *
 * Without a cookie each request is a fresh session and pays for a real run rather than
 * reading the session's stored result (see run-ruleset.ts's storedRun). With one, every
 * request shares the session, whose stored run - keyed on the case and ruleset - would
 * serve all but the first, so the smoke rotates the requested ruleset to keep each request
 * a real run, and reports per ruleset rather than blending their different costs. Under
 * concurrency a request can still occasionally land on a just-stored run (overlapping
 * requests race the session's single slot), so read p95/max as the signal. Pin LOAD_RULESET
 * for a single request (LOAD_REQUESTS=1), or on a cookieless run where every session is
 * fresh anyway.
 *
 * `redirect: 'manual'` keeps a dead or expired cookie honest - the sign-in redirect fails
 * the request rather than timing the login page.
 *
 * Defaults point at the sample case the e2e seed loads.
 */
import { RULESETS } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import { SAMPLE_CASE_ID, SAMPLE_RULESET_ID } from '../e2e/fixtures.ts';

const baseUrl = (process.env.LOAD_BASE_URL ?? 'http://localhost:8090').replace(/\/$/, '');
const total = Number.parseInt(process.env.LOAD_REQUESTS ?? '20', 10);
const concurrency = Number.parseInt(process.env.LOAD_CONCURRENCY ?? '4', 10);
const cookie = process.env.LOAD_COOKIE;
const caseId = process.env.LOAD_CASE_ID ?? SAMPLE_CASE_ID;

// a shared session's stored run only serves the ruleset it was for (see the header
// comment), so with a session cookie the requested ruleset rotates - without a pinned
// LOAD_RULESET - to keep each request paying for a real run
const rulesetIds =
	cookie && !process.env.LOAD_RULESET
		? RULESETS.map((ruleset) => ruleset.id)
		: [process.env.LOAD_RULESET ?? SAMPLE_RULESET_ID];
const rulesetId = (index) => rulesetIds[index % rulesetIds.length];
const requestPath = (index) => `/consultees/${caseId}/report?ruleset=${rulesetId(index)}`;
const headers = cookie ? { cookie } : {};

const timings = [];
const failures = [];
let signInRedirects = 0;
let next = 0;

async function worker() {
	while (next < total) {
		const index = next++;
		const started = performance.now();
		try {
			const response = await fetch(`${baseUrl}${requestPath(index)}`, { redirect: 'manual', headers });
			timings[index] = { ms: performance.now() - started, rulesetId: rulesetId(index) };
			if (!response.ok) {
				const location = response.headers.get('location') ?? '';
				if (location.includes('/auth/signin')) {
					signInRedirects += 1;
				}
				failures.push(`${index}: HTTP ${response.status}${location ? ` -> ${location}` : ''}`);
			}
			await response.arrayBuffer();
		} catch (error) {
			timings[index] = { ms: performance.now() - started, rulesetId: rulesetId(index) };
			failures.push(`${index}: ${error.cause?.message ?? error.message}`);
		}
	}
}

const rotating = rulesetIds.length > 1;
console.log(`GET ${baseUrl}/consultees/${caseId}/report?ruleset=${rotating ? rulesetIds.join('|') : rulesetIds[0]}`);
console.log(
	`${total} requests at concurrency ${concurrency}, ` +
		(cookie
			? `sharing the LOAD_COOKIE session${rotating ? ' - rotating the ruleset so its stored run cannot serve a request' : ''}`
			: 'each a fresh session')
);
if (cookie && !rotating && total > 1) {
	console.warn(
		"note: requests share the LOAD_COOKIE session, so the report's stored run serves all but the first - " +
			(process.env.LOAD_RULESET ? 'drop LOAD_RULESET to rotate the rulesets' : 'only one ruleset is configured') +
			', or use LOAD_REQUESTS=1 for a single timed run'
	);
}
const started = performance.now();
await Promise.all(Array.from({ length: concurrency }, worker));
const elapsed = performance.now() - started;

const ms = (value) => `${Math.round(value)}ms`;
const stats = (samples) => {
	const sorted = samples.map((sample) => sample.ms).sort((a, b) => a - b);
	const percentile = (p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
	return `min ${ms(sorted[0])}  p50 ${ms(percentile(50))}  p95 ${ms(percentile(95))}  max ${ms(sorted[sorted.length - 1])}`;
};

console.log(`done in ${ms(elapsed)}: ${timings.length} requests`);
if (rotating) {
	// rulesets differ in cost - blend them and the percentiles lie
	const groups = new Map();
	for (const timing of timings) {
		const group = groups.get(timing.rulesetId) ?? [];
		group.push(timing);
		groups.set(timing.rulesetId, group);
	}
	for (const [id, samples] of groups) {
		console.log(`  ${id} (${samples.length}): ${stats(samples)}`);
	}
} else {
	console.log(`  ${stats(timings)}`);
}
if (failures.length > 0) {
	console.error(`${failures.length} request(s) failed:\n${failures.join('\n')}`);
	if (signInRedirects > 0) {
		console.error(
			`${signInRedirects} redirected to sign-in - the report page needs a session: ` +
				`set LOAD_COOKIE to a signed-in session's cookie, or run locally with AUTH_DISABLED=true`
		);
	}
	process.exit(1);
}
