import type { Ruleset } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { buildPythonRulesetRunner, runRulesetUrl } from './ruleset-runner.ts';

const ruleset: Ruleset = {
	id: 'example',
	name: 'Example',
	rules: [
		{ id: 'hospital', name: 'Hospitals', logicType: 'intersection', categories: ['Hospital'], bufferMetres: 10_000 },
		{
			id: 'parish',
			name: 'Bordering parishes',
			logicType: 'bordering',
			categories: ['Parish Council'],
			hostCategory: 'Parish Council'
		}
	]
};
const site = { type: 'Point' as const, coordinates: [-1.5, 52.5] as [number, number] };
const properties = { consulteeCategory: 'Hospital', consultee: 'Example Hospital', region: null, metadata: {} };

function respondWith(body: unknown, status = 200) {
	return mock.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));
}

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
		const fetchImpl = respondWith({ consultees: [] });
		const run = buildPythonRulesetRunner({
			pythonFunctionUrl: 'http://localhost:7071/api/consultee-areas',
			apiKey: 'shared-key',
			fetchImpl
		});

		await run(site, ruleset, 20_000);

		const [url, init] = fetchImpl.mock.calls[0].arguments;
		assert.equal(url, 'http://localhost:7071/api/run-ruleset');
		assert.equal(init?.method, 'POST');
		assert.deepEqual(init?.headers, { 'content-type': 'application/json', 'x-api-key': 'shared-key' });
		assert.ok(init?.signal, 'expected a timeout signal');
		assert.deepEqual(JSON.parse(String(init?.body)), {
			siteWkt: 'POINT(-1.5 52.5)',
			nearbyRadiusMetres: 20_000,
			// the display name stays here - the function only needs what to run
			rules: [
				{ id: 'hospital', logicType: 'intersection', categories: ['Hospital'], bufferMetres: 10_000 },
				{ id: 'parish', logicType: 'bordering', categories: ['Parish Council'], hostCategory: 'Parish Council' }
			]
		});
	});

	it('maps each consultee with its reasons, with geometry only when the function sent it', async () => {
		const conditionAndNearby = [
			{ type: 'condition', conditionId: 'hospital' },
			{ type: 'nearby', radiusMetres: 20_000 }
		];
		const run = buildPythonRulesetRunner({
			pythonFunctionUrl: 'http://localhost:7071/api/consultee-areas',
			apiKey: undefined,
			fetchImpl: respondWith({
				consultees: [
					{
						feature: { id: 'a', properties, geometryWkt: 'POINT (-1.4 52.6)' },
						distanceMetres: 12.5,
						reasons: conditionAndNearby
					},
					{ feature: { id: 'b', properties }, distanceMetres: 900, reasons: [conditionAndNearby[1]] }
				]
			})
		});

		const { consultees } = await run(site, ruleset, 20_000);

		assert.deepEqual(consultees, [
			{
				distanceMetres: 12.5,
				reasons: conditionAndNearby,
				feature: { id: 'a', properties, geometry: { type: 'Point', coordinates: [-1.4, 52.6] } }
			},
			{ distanceMetres: 900, reasons: [conditionAndNearby[1]], feature: { id: 'b', properties } }
		]);
	});

	it('sends no API key header when none is configured', async () => {
		const fetchImpl = respondWith({ consultees: [] });
		await buildPythonRulesetRunner({ pythonFunctionUrl: 'http://f/api/x', apiKey: undefined, fetchImpl })(
			site,
			ruleset,
			1
		);
		assert.deepEqual(fetchImpl.mock.calls[0].arguments[1]?.headers, { 'content-type': 'application/json' });
	});

	it('rejects without calling out when the function URL is not configured', async () => {
		const fetchImpl = respondWith({});
		const run = buildPythonRulesetRunner({ pythonFunctionUrl: undefined, apiKey: undefined, fetchImpl });
		await assert.rejects(() => run(site, ruleset, 20_000), /PYTHON_FUNCTION_URL is not configured/);
		assert.equal(fetchImpl.mock.callCount(), 0);
	});

	it('rejects on a non-2xx response, an unexpected body, or a network failure', async () => {
		const runWith = (fetchImpl: typeof fetch) =>
			buildPythonRulesetRunner({ pythonFunctionUrl: 'http://f/api/x', apiKey: 'k', fetchImpl })(site, ruleset, 1);

		await assert.rejects(() => runWith(respondWith({ error: 'Unauthorised' }, 401)), /status 401/);
		await assert.rejects(() => runWith(respondWith({ matches: [] })), /unexpected run-ruleset response/);
		await assert.rejects(
			() =>
				runWith(async () => {
					throw new TypeError('fetch failed');
				}),
			/fetch failed/
		);
	});
});
