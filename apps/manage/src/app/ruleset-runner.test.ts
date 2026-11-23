import type { Ruleset } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, describe, it, mock } from 'node:test';
import { buildPythonRulesetRunner, runRulesetUrl } from './ruleset-runner.ts';

// the wire format both deployables pin to - contracts/ at the repo root explains why these
// fixtures are shared with the function's tests rather than inlined here
const contractRequest = JSON.parse(
	readFileSync(new URL('../../../../contracts/run-ruleset/request.json', import.meta.url), 'utf8')
);
const contractResponse = JSON.parse(
	readFileSync(new URL('../../../../contracts/run-ruleset/response.json', import.meta.url), 'utf8')
);

const ruleset: Ruleset = {
	id: 'example',
	name: 'Example',
	rules: [
		{
			id: 'hospital',
			name: 'Hospitals',
			logicType: 'intersection',
			categories: ['Hospitals operated by NHS trusts and NHS foundation trusts (England)'],
			bufferMetres: 10_000
		},
		{
			id: 'parish',
			name: 'Bordering parishes',
			logicType: 'bordering',
			categories: ['Parish, town and community councils'],
			hostCategory: 'Parish, town and community councils'
		}
	]
};
const site = { type: 'Point' as const, coordinates: [-1.5, 52.5] as [number, number] };
const properties = {
	consulteeCategory: 'Hospitals operated by NHS trusts and NHS foundation trusts (England)',
	consultee: 'Example Hospital',
	region: null,
	metadata: {}
};

const originalFetch = globalThis.fetch;

function stubFetch(impl: typeof fetch) {
	return (globalThis.fetch = mock.fn(impl));
}

function respondWith(body: unknown, status = 200) {
	return stubFetch(async () => new Response(JSON.stringify(body), { status }));
}

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe('runRulesetUrl', () => {
	it('resolves run-ruleset alongside the configured consultee-areas route', () => {
		assert.equal(
			runRulesetUrl('https://func.example.net/api/consultee-areas'),
			'https://func.example.net/api/run-ruleset'
		);
		assert.equal(runRulesetUrl('http://localhost:7071/api/consultee-areas'), 'http://localhost:7071/api/run-ruleset');
	});
});

describe('buildPythonRulesetRunner', () => {
	it("posts the site, radius and ruleset's conditions with the API key", async () => {
		const fetchMock = respondWith({ consultees: [] });
		const run = buildPythonRulesetRunner({
			pythonFunctionUrl: 'http://localhost:7071/api/consultee-areas',
			apiKey: 'shared-key',
			nearbyRadiusMetresByCategory: { 'Parish, town and community councils': 5_000 }
		});

		await run(site, ruleset, 20_000);

		const [url, init] = fetchMock.mock.calls[0].arguments;
		assert.equal(url, 'http://localhost:7071/api/run-ruleset');
		assert.equal(init?.method, 'POST');
		assert.deepEqual(init?.headers, { 'content-type': 'application/json', 'x-api-key': 'shared-key' });
		assert.ok(init?.signal, 'expected a timeout signal');
		assert.deepEqual(JSON.parse(String(init?.body)), {
			siteWkt: 'POINT(-1.5 52.5)',
			nearbyRadiusMetres: 20_000,
			nearbyRadiusMetresByCategory: { 'Parish, town and community councils': 5_000 },
			includeGeometry: false,
			// the function stops its run before this request gives up on it
			timeoutSeconds: 50,
			// the display name stays here - the function only needs what to run
			rules: [
				{
					id: 'hospital',
					logicType: 'intersection',
					categories: ['Hospitals operated by NHS trusts and NHS foundation trusts (England)'],
					bufferMetres: 10_000
				},
				{
					id: 'parish',
					logicType: 'bordering',
					categories: ['Parish, town and community councils'],
					hostCategory: 'Parish, town and community councils'
				}
			]
		});
	});

	it("sends the site's case boundary for the function to check administrative areas against", async () => {
		const fetchMock = respondWith({ consultees: [] });
		const run = buildPythonRulesetRunner({
			pythonFunctionUrl: 'http://localhost:7071/api/consultee-areas',
			apiKey: undefined
		});

		await run(site, ruleset, 20_000, 'aaaaaaaa-0000-0000-0000-000000000001');

		const body = JSON.parse(String(fetchMock.mock.calls[0].arguments[1]?.body));
		assert.equal(body.caseBoundaryId, 'aaaaaaaa-0000-0000-0000-000000000001');
	});

	it('asks for the bounding box past the configured detail, and says what the function screened', async () => {
		const fetchMock = respondWith({ consultees: [], siteScreenedAs: 'boundingBox' });
		const run = buildPythonRulesetRunner({
			pythonFunctionUrl: 'http://localhost:7071/api/consultee-areas',
			apiKey: undefined,
			boundingBoxAbovePoints: 2_000
		});

		assert.equal((await run(site, ruleset, 20_000)).siteScreenedAs, 'boundingBox');
		const body = JSON.parse(String(fetchMock.mock.calls[0].arguments[1]?.body));
		assert.equal(body.boundingBoxAbovePoints, 2_000);
		// the function decides - the app never asks for the box itself
		assert.equal(body.boundingBox, undefined);
	});

	it('reads a response that says nothing about what it screened, or a covering outline, as the outline', async () => {
		respondWith({ consultees: [] });
		const run = buildPythonRulesetRunner({
			pythonFunctionUrl: 'http://localhost:7071/api/consultee-areas',
			apiKey: undefined
		});
		assert.equal((await run(site, ruleset, 20_000)).siteScreenedAs, 'outline');
		respondWith({ consultees: [], siteScreenedAs: 'simplifiedOutline' });
		assert.equal((await run(site, ruleset, 20_000)).siteScreenedAs, 'outline');
	});

	it('maps each consultee with its reasons, and no geometry - even from an older function that sent some', async () => {
		const conditionAndNearby = [
			{ type: 'condition', conditionId: 'hospital' },
			{ type: 'nearby', radiusMetres: 20_000 }
		];
		respondWith({
			consultees: [
				{
					feature: { id: 'a', properties, geometryWkt: 'POINT (-1.4 52.6)' },
					distanceMetres: 12.5,
					reasons: conditionAndNearby
				},
				{ feature: { id: 'b', properties }, distanceMetres: 900, reasons: [conditionAndNearby[1]] }
			]
		});
		const run = buildPythonRulesetRunner({
			pythonFunctionUrl: 'http://localhost:7071/api/consultee-areas',
			apiKey: undefined
		});

		const { consultees } = await run(site, ruleset, 20_000);

		assert.deepEqual(consultees, [
			{
				distanceMetres: 12.5,
				reasons: conditionAndNearby,
				feature: { id: 'a', properties }
			},
			{ distanceMetres: 900, reasons: [conditionAndNearby[1]], feature: { id: 'b', properties } }
		]);
	});

	it('sends no API key header when none is configured', async () => {
		const fetchMock = respondWith({ consultees: [] });
		await buildPythonRulesetRunner({ pythonFunctionUrl: 'http://f/api/x', apiKey: undefined })(site, ruleset, 1);
		assert.deepEqual(fetchMock.mock.calls[0].arguments[1]?.headers, { 'content-type': 'application/json' });
	});

	it('rejects without calling out when the function URL is not configured', async () => {
		const fetchMock = respondWith({});
		const run = buildPythonRulesetRunner({ pythonFunctionUrl: undefined, apiKey: undefined });
		await assert.rejects(() => run(site, ruleset, 20_000), /PYTHON_FUNCTION_URL is not configured/);
		assert.equal(fetchMock.mock.callCount(), 0);
	});

	it('posts exactly the request the contract fixture describes', async () => {
		const fetchMock = respondWith({ consultees: [] });
		const run = buildPythonRulesetRunner({
			pythonFunctionUrl: 'http://localhost:7071/api/consultee-areas',
			apiKey: undefined,
			nearbyRadiusMetresByCategory: { 'Parish, town and community councils': 5_000 },
			boundingBoxAbovePoints: 2_000
		});

		await run(site, ruleset, 20_000, 'aaaaaaaa-0000-0000-0000-000000000001');

		// the function's test parses this same fixture - a field changed here without a contract
		// change fails on one side or the other
		assert.deepEqual(JSON.parse(String(fetchMock.mock.calls[0].arguments[1]?.body)), contractRequest);
	});

	it('maps the response the contract fixture describes', async () => {
		respondWith(contractResponse);
		const run = buildPythonRulesetRunner({
			pythonFunctionUrl: 'http://localhost:7071/api/consultee-areas',
			apiKey: undefined
		});

		assert.deepEqual(await run(site, ruleset, 20_000), {
			consultees: contractResponse.consultees.map(
				(consultee: { feature: { id: string; properties: object }; distanceMetres: number; reasons: object[] }) => ({
					feature: consultee.feature,
					distanceMetres: consultee.distanceMetres,
					reasons: consultee.reasons
				})
			),
			siteScreenedAs: 'boundingBox'
		});
	});

	it('rejects on a non-2xx response, an unexpected body, or a network failure', async () => {
		const run = buildPythonRulesetRunner({ pythonFunctionUrl: 'http://f/api/x', apiKey: 'k' });
		const attempt = () => run(site, ruleset, 1);

		respondWith({ error: 'Unauthorised' }, 401);
		await assert.rejects(attempt, /status 401/);

		respondWith({ matches: [] });
		await assert.rejects(attempt, /unexpected run-ruleset response/);

		stubFetch(async () => {
			throw new TypeError('fetch failed');
		});
		await assert.rejects(attempt, /fetch failed/);
	});
});
