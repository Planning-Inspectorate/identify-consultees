import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import {
	azureDevOpsCopyPipeline,
	azureDevOpsToken,
	COPY_PIPELINE_NAME,
	routeName,
	toCopyRun
} from './copy-pipeline.ts';

const SETTINGS = {
	projectUrl: 'https://dev.azure.com/planninginspectorate/identify-consultees',
	from: 'Test',
	to: 'Training'
} as const;

const build = (overrides: Record<string, unknown> = {}) => ({
	id: 42,
	status: 'completed',
	result: 'succeeded',
	queueTime: '2026-11-06T09:00:00Z',
	finishTime: '2026-11-06T09:04:00Z',
	templateParameters: { route: 'Test to Training', quarter: ' ' },
	_links: { web: { href: 'https://dev.azure.com/runs/42' } },
	...overrides
});

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Answers the pipeline look-up, then each call `respond` gives - recording each request. */
function stubFetch(respond: (url: string, init: RequestInit) => Response) {
	return mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) =>
		url.includes('/build/definitions?') ? json({ value: [{ id: 7 }] }) : respond(url, init)
	);
}

afterEach(() => mock.restoreAll());

describe('the reference data copy pipeline', () => {
	it('names the route as the pipeline does', () => {
		assert.equal(routeName(SETTINGS), 'Test to Training');
		assert.equal(routeName({ from: 'Training', to: 'Prod' }), 'Training to Prod');
	});

	it("reads a run's status - running until it completes, Prod's approval included", () => {
		assert.deepEqual(toCopyRun(build()), {
			id: 42,
			status: 'succeeded',
			queuedAt: new Date('2026-11-06T09:00:00Z'),
			finishedAt: new Date('2026-11-06T09:04:00Z'),
			url: 'https://dev.azure.com/runs/42'
		});
		const waiting = toCopyRun(
			build({ status: 'notStarted', result: undefined, finishTime: undefined, _links: undefined })
		);
		assert.equal(waiting.status, 'running');
		assert.equal(waiting.finishedAt, undefined);
		assert.equal(waiting.url, '');
		assert.equal(toCopyRun(build({ result: 'canceled' })).status, 'cancelled');
		assert.equal(toCopyRun(build({ result: 'failed' })).status, 'failed');
		assert.equal(toCopyRun(build({ result: 'partiallySucceeded' })).status, 'failed');
		assert.equal(toCopyRun(build({ result: undefined })).status, 'failed');
	});

	it("finds the pipeline by name, once, and gives this route's latest run", async () => {
		const fetchMock = stubFetch(() =>
			json({
				value: [
					build({ id: 50, templateParameters: { route: 'Training to Prod' } }),
					build({ id: 49 }),
					build({ id: 48 })
				]
			})
		);
		const token = mock.fn(async () => 'token');
		const pipeline = azureDevOpsCopyPipeline(SETTINGS, token);

		assert.equal((await pipeline.latestRun())?.id, 49);
		await pipeline.latestRun();

		const urls = fetchMock.mock.calls.map((call) => String(call.arguments[0]));
		assert.equal(
			urls[0],
			`${SETTINGS.projectUrl}/_apis/build/definitions?name=${encodeURIComponent(COPY_PIPELINE_NAME)}&api-version=7.1`
		);
		assert.equal(urls.filter((url) => url.includes('/build/definitions')).length, 1);
		assert.equal(
			urls[1],
			`${SETTINGS.projectUrl}/_apis/build/builds?definitions=7&$top=20&queryOrder=queueTimeDescending&api-version=7.1`
		);
		const init = fetchMock.mock.calls[1].arguments[1] as RequestInit & { headers: Record<string, string> };
		assert.equal(init.headers.authorization, 'Bearer token');
	});

	it('has no latest run when the route has never run, or the pipeline none', async () => {
		stubFetch(() => json({ value: [build({ templateParameters: { route: 'Training to Prod' } })] }));
		assert.equal(await azureDevOpsCopyPipeline(SETTINGS, async () => 't').latestRun(), undefined);
		mock.restoreAll();
		stubFetch(() => json({}));
		assert.equal(await azureDevOpsCopyPipeline(SETTINGS, async () => 't').latestRun(), undefined);
	});

	it("starts a run on main for the route, copying the source's dataset in use", async () => {
		const fetchMock = stubFetch(() => json(build({ id: 51, status: 'notStarted', result: undefined })));
		const run = await azureDevOpsCopyPipeline(SETTINGS, async () => 't').start();

		assert.equal(run.id, 51);
		assert.equal(run.status, 'running');
		const [url, init] = fetchMock.mock.calls[1].arguments as [string, RequestInit];
		assert.equal(url, `${SETTINGS.projectUrl}/_apis/build/builds?api-version=7.1`);
		assert.equal(init.method, 'POST');
		assert.deepEqual(JSON.parse(String(init.body)), {
			definition: { id: 7 },
			sourceBranch: 'refs/heads/main',
			templateParameters: { route: 'Test to Training', quarter: ' ' }
		});
	});

	it("says why Azure DevOps refused, and looks the pipeline up again after it couldn't be found", async () => {
		mock.method(globalThis, 'fetch', async () => json({ message: 'no access' }, 401));
		const refused = azureDevOpsCopyPipeline(SETTINGS, async () => 't');
		await assert.rejects(refused.latestRun(), /status 401 to GET build\/definitions/);

		mock.restoreAll();
		let lookUps = 0;
		mock.method(globalThis, 'fetch', async (url: string) => {
			if (url.includes('/build/definitions?')) {
				return json({ value: lookUps++ === 0 ? [] : [{ id: 7 }] });
			}
			return json({ value: [build()] });
		});
		const pipeline = azureDevOpsCopyPipeline(SETTINGS, async () => 't');
		await assert.rejects(pipeline.latestRun(), /no pipeline named "Promote reference data"/);
		assert.equal((await pipeline.latestRun())?.id, 42);
		assert.equal(lookUps, 2);

		mock.restoreAll();
		stubFetch(() => json({}, 403));
		await assert.rejects(
			azureDevOpsCopyPipeline(SETTINGS, async () => 't').start(),
			/status 403 to POST build\/builds/
		);
	});

	it('signs in for Azure DevOps with the credential it is given', async () => {
		const getToken = mock.fn(async () => ({ token: 'abc', expiresOnTimestamp: 0 }));
		assert.equal(await azureDevOpsToken({ getToken } as never)(), 'abc');
		assert.deepEqual(getToken.mock.calls[0].arguments, ['499b84ac-1321-427f-aa17-267ca6975798/.default']);
	});
});
