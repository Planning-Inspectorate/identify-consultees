import { mockLogger } from '@planning-inspectorate/core/testing';
import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import type { CopyPipeline, CopyRun } from './copy-pipeline.ts';
import { buildStartCopy, copySection } from './copy.ts';

const SETTINGS = { projectUrl: 'https://dev.azure.com/org/project', from: 'Test', to: 'Training' } as const;
const RUN: CopyRun = {
	id: 1,
	status: 'succeeded',
	queuedAt: new Date('2026-11-06T09:00:00Z'),
	finishedAt: new Date('2026-11-06T09:04:00Z'),
	url: 'https://dev.azure.com/runs/1'
};

function pipelineWith(
	latest: CopyRun | undefined | Error,
	started: CopyRun | Error = { ...RUN, id: 2, status: 'running' }
) {
	return {
		latestRun: mock.fn(async () => {
			if (latest instanceof Error) throw latest;
			return latest;
		}),
		start: mock.fn(async () => {
			if (started instanceof Error) throw started;
			return started;
		})
	} satisfies CopyPipeline;
}

const service = (referenceDataCopy: unknown = SETTINGS) => ({ referenceDataCopy, logger: mockLogger() }) as never;

describe("the files page's Copy section", () => {
	it('is there only where copying is set up', async () => {
		assert.equal(await copySection(service(null), pipelineWith(RUN)), undefined);
		assert.equal(await copySection(service(), undefined), undefined);
	});

	it('shows the last copy, in UK time, and whether Prod needs approving', async () => {
		assert.deepEqual(await copySection(service(), pipelineWith(RUN), 'started'), {
			from: 'Test',
			to: 'Training',
			needsApproval: false,
			running: false,
			notice: 'started',
			latest: {
				status: { text: 'Copied', colour: 'green' },
				queuedAt: '09:00, 6 Nov 2026',
				finishedAt: '09:04, 6 Nov 2026',
				url: RUN.url
			}
		});
		const prod = await copySection(
			service({ ...SETTINGS, from: 'Training', to: 'Prod' }),
			pipelineWith({ ...RUN, status: 'running', finishedAt: undefined }),
			'something else'
		);
		assert.equal(prod?.needsApproval, true);
		assert.equal(prod?.running, true);
		assert.equal(prod?.notice, undefined);
		assert.equal(prod?.latest?.finishedAt, undefined);
		assert.deepEqual(prod?.latest?.status, { text: 'Running', colour: 'blue' });
	});

	it('has no last copy before the first, and says why when Azure DevOps cannot be read', async () => {
		const first = await copySection(service(), pipelineWith(undefined));
		assert.equal(first?.latest, undefined);
		assert.equal(first?.running, false);

		const down = await copySection(service(), pipelineWith(new Error('status 401')));
		assert.equal(down?.error, "Couldn't reach Azure DevOps to see the last copy: status 401");
		const throwsText = { latestRun: async () => Promise.reject('offline'), start: async () => RUN };
		assert.equal(
			(await copySection(service(), throwsText))?.error,
			"Couldn't reach Azure DevOps to see the last copy: offline"
		);
	});
});

describe('starting a copy', () => {
	const res = () => ({ redirect: mock.fn() }) as unknown as { redirect: ReturnType<typeof mock.fn> };

	it('starts one and goes back to the page saying so', async () => {
		const pipeline = pipelineWith(RUN);
		const response = res();
		await buildStartCopy(SETTINGS, pipeline, service(), async () => {})({} as never, response as never);
		assert.equal(pipeline.start.mock.callCount(), 1);
		assert.deepEqual(response.redirect.mock.calls[0].arguments, ['/admin/upload-to-blob?copy=started']);
	});

	it("doesn't start another while one is running", async () => {
		const pipeline = pipelineWith({ ...RUN, status: 'running' });
		const response = res();
		await buildStartCopy(SETTINGS, pipeline, service(), async () => {})({} as never, response as never);
		assert.equal(pipeline.start.mock.callCount(), 0);
		assert.deepEqual(response.redirect.mock.calls[0].arguments, ['/admin/upload-to-blob?copy=running']);
	});

	it("shows the page again with why it couldn't start", async () => {
		const renderPage = mock.fn(async () => {});
		const response = res();
		await buildStartCopy(
			SETTINGS,
			pipelineWith(undefined, new Error('status 403')),
			service(),
			renderPage
		)({} as never, response as never);
		assert.deepEqual(renderPage.mock.calls[0].arguments, [response, "Couldn't start the copy from Test: status 403"]);
		const refuses = { latestRun: async () => undefined, start: async () => Promise.reject('refused') };
		await buildStartCopy(SETTINGS, refuses, service(), renderPage)({} as never, response as never);
		assert.equal(renderPage.mock.calls[1].arguments[1], "Couldn't start the copy from Test: refused");
	});
});
