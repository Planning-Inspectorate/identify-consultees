import { expect, test } from '@playwright/test';
import { SAMPLE_CASE_ID, SAMPLE_CASE_REFERENCE, SAMPLE_RULESET_ID } from './fixtures.ts';

/**
 * Asset-integrity wiring check: every stylesheet/script/image path the pages
 * reference must actually serve, and the fingerprinted ones must carry the
 * long-lived caching contract the fingerprinting exists for -
 * `Cache-Control: immutable, max-age=31536000` with a Brotli response for
 * clients that accept `br`.
 *
 * A stale literal or a missing build output is a hard 404 on an
 * immutable-cached asset that breaks every page requesting it - this spec is
 * the end-to-end tripwire for that failure mode. Sizes are gated separately
 * by `npm run check-asset-sizes` in the pipeline.
 */

// the same journey pages the render and a11y specs cover - their combined
// markup references every fingerprinted asset the app ships
const pages = [
	{ path: `/?q=${SAMPLE_CASE_REFERENCE}`, name: 'home' },
	{ path: `/consultees/${SAMPLE_CASE_ID}`, name: 'project boundary' },
	{ path: `/consultees/${SAMPLE_CASE_ID}/ruleset`, name: 'ruleset picker' },
	{ path: `/consultees/${SAMPLE_CASE_ID}/report?ruleset=${SAMPLE_RULESET_ID}`, name: 'report check' },
	{
		path: `/consultees/${SAMPLE_CASE_ID}/report/consultees?ruleset=${SAMPLE_RULESET_ID}&category=Parish%2C%20town%20and%20community%20councils`,
		name: 'report consultees'
	},
	{
		path: `/consultees/${SAMPLE_CASE_ID}/report/consultees/add?ruleset=${SAMPLE_RULESET_ID}&category=Parish%2C%20town%20and%20community%20councils`,
		name: 'report consultee add'
	},
	{
		path: `/consultees/${SAMPLE_CASE_ID}/report/consultees/remove?ruleset=${SAMPLE_RULESET_ID}&category=Parish%2C%20town%20and%20community%20councils&add=${Buffer.from('{"c":"Parish, town and community councils","n":"A Consultee","r":"borders"}').toString('base64url')}&added=0`,
		name: 'report consultee remove'
	},
	{ path: `/consultees/${SAMPLE_CASE_ID}/report/created?ruleset=${SAMPLE_RULESET_ID}`, name: 'report created' },
	{ path: '/signed-out', name: 'signed out' }
];

// root-relative src/href targets with a static-file extension - external URLs
// and anchors are not the app's asset wiring
const LOCAL_ASSET_REFERENCE =
	/(?:src|href)="(\/[a-z0-9\-._~/]*\.(?:css|js|mjs|svg|png|ico|webmanifest))(?:[?#][^"]*)?"/gi;
const FINGERPRINTED = /-[0-9a-f]{8}\.[a-z]+$/i;
const BROTLI_ELIGIBLE = /\.(?:css|js|mjs|svg)$/i;

test('every asset every page references serves, fingerprinted ones immutable and brotli', async ({ request }) => {
	const referenced = new Map<string, string[]>();
	for (const { path: pagePath, name } of pages) {
		const response = await request.get(pagePath);
		expect(response.ok(), `${name} (${pagePath}) did not render`).toBeTruthy();
		for (const match of (await response.text()).matchAll(LOCAL_ASSET_REFERENCE)) {
			const url = match[1];
			referenced.set(url, [...(referenced.get(url) ?? []), name]);
		}
	}

	const failures: string[] = [];
	for (const [url, seenOn] of referenced) {
		const response = await request.get(url, { headers: { 'accept-encoding': 'br' } });
		const where = [...new Set(seenOn)].join(', ');
		if (!response.ok()) {
			failures.push(`${url} referenced by ${where}: HTTP ${response.status()}`);
			continue;
		}
		if (!FINGERPRINTED.test(url)) {
			continue;
		}
		const headers = response.headers();
		const cacheControl = headers['cache-control'] ?? '';
		if (!cacheControl.includes('immutable') || !cacheControl.includes('max-age=31536000')) {
			failures.push(`${url}: Cache-Control "${cacheControl}" is not the fingerprinted-asset contract`);
		}
		if (BROTLI_ELIGIBLE.test(url) && headers['content-encoding'] !== 'br') {
			failures.push(
				`${url}: expected a Brotli response for accept-encoding: br, got "${headers['content-encoding'] ?? 'none'}"`
			);
		}
	}

	expect(failures, `${failures.length} asset problems:\n${failures.join('\n')}`).toEqual([]);
});
