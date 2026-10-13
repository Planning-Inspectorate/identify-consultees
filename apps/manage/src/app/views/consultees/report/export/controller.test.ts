import { mockLogger } from '@planning-inspectorate/core/testing';
import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import type { ConsulteeAreaMatchRow } from '../../../../testing/ruleset-runner-stub.ts';
import { failingRulesetRunner, rulesetRunnerReturning } from '../../../../testing/ruleset-runner-stub.ts';
import { buildReportDownload } from './controller.ts';

const realProjectId = '44444444-4444-4444-4444-444444444444';
const ruleset = 'england-wales-post-20240430';

function realProjectRow() {
	return {
		id: realProjectId,
		geometryType: 'Point',
		caseReference: 'EN010099',
		caseName: 'Real Test Project',
		fileName: 'site.geojson',
		receivedDate: new Date('2026-07-06T00:00:00Z'),
		acceptance: null,
		metadata: '{}',
		geometryWkt: 'POINT(-1.5 52.5)'
	};
}

function matchRow(id: string, reasons: ConsulteeAreaMatchRow['reasons']): ConsulteeAreaMatchRow {
	return {
		id,
		geometryType: 'Point',
		consulteeCategory: 'Parish Council',
		consultee: `Parish ${id}`,
		region: 'East',
		caseReference: null,
		documentId: null,
		consulteeId: null,
		organisationId: null,
		currentVersion: 1,
		metadata: '{}',
		geometryWkt: 'POINT(-1.5 52.5)',
		distanceMetres: 100,
		reasons
	} as ConsulteeAreaMatchRow;
}

const identifiedReason = [{ type: 'condition' as const, conditionId: 'b_host_parish_town_community_councils' }];

function serviceWith(rulesetRunner: unknown, projectRows: unknown[] = [realProjectRow()]) {
	return {
		db: {
			$queryRaw: mock.fn(async () => projectRows),
			consulteeArea: {
				findMany: mock.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
					where.id.in.map((id) => ({
						id: id.toUpperCase(),
						geometryType: 'Point',
						consulteeCategory: 'Parish Council',
						consultee: `Parish ${id}`,
						region: 'East',
						caseReference: null,
						documentId: null,
						consulteeId: null,
						organisationId: null,
						currentVersion: 1,
						metadata: '{}',
						lastUpdated: new Date('2026-10-01T09:00:00Z')
					}))
				)
			}
		},
		logger: mockLogger(),
		nearbyConsulteeRadiusMetres: 20_000,
		rulesetRunner
	};
}

function response() {
	const res = {
		status: mock.fn(() => res),
		render: mock.fn(),
		redirect: mock.fn(),
		set: mock.fn(() => res),
		send: mock.fn()
	};
	return res;
}

describe('report download', () => {
	it('sends an Excel workbook of the identified consultees, less removals, with their stored rows', async () => {
		const service = serviceWith(
			rulesetRunnerReturning([
				matchRow('aaaaaaaa-0000-0000-0000-000000000001', identifiedReason),
				matchRow('aaaaaaaa-0000-0000-0000-000000000002', identifiedReason),
				// only the nearby search found it - not in the report
				matchRow('aaaaaaaa-0000-0000-0000-000000000003', [{ type: 'nearby', radiusMetres: 20_000 }])
			])
		);
		const removal = JSON.stringify({
			i: 'aaaaaaaa-0000-0000-0000-000000000002',
			c: 'Parish Council',
			n: 'Parish 2',
			r: 'Dissolved'
		});
		const res = response();
		await buildReportDownload(service as never)(
			{ params: { caseId: realProjectId }, query: { ruleset, exclude: removal } } as never,
			res as never
		);

		const [{ where }] = service.db.consulteeArea.findMany.mock.calls[0].arguments;
		assert.deepStrictEqual(where.id.in, ['aaaaaaaa-0000-0000-0000-000000000001']);
		const [headers] = res.set.mock.calls[0].arguments as [Record<string, string>];
		assert.equal(headers['Content-Type'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
		assert.match(
			headers['Content-Disposition'],
			/^attachment; filename="EN010099 England Wales post 30 April 2024 consultees \d{4}-\d{2}-\d{2}\.xlsx"$/
		);
		const [body] = res.send.mock.calls[0].arguments as [Buffer];
		// an .xlsx is a ZIP archive
		assert.equal(body.subarray(0, 2).toString(), 'PK');
	});

	it('fetches stored rows in batches SQL Server accepts, and uses the default ruleset when none is given', async () => {
		const rows = Array.from({ length: 1001 }, (_, i) =>
			matchRow(`aaaaaaaa-0000-0000-0000-${String(i).padStart(12, '0')}`, identifiedReason)
		);
		// a boundary loaded without a file name or received date
		const service = serviceWith(rulesetRunnerReturning(rows), [
			{ ...realProjectRow(), fileName: null, receivedDate: null }
		]);
		const res = response();
		await buildReportDownload(service as never)(
			{ params: { caseId: realProjectId }, query: {} } as never,
			res as never
		);

		assert.deepStrictEqual(
			service.db.consulteeArea.findMany.mock.calls.map((call) => call.arguments[0].where.id.in.length),
			[1000, 1]
		);
		assert.match(res.set.mock.calls[0].arguments[0]['Content-Disposition'], /England Wales post 30 April 2024/);
	});

	it('goes back to the Report created page, keeping the selection, when the ruleset cannot be run', async () => {
		const add = JSON.stringify({ c: 'Parish Council', n: 'Added', r: 'Asked' });
		const res = response();
		await buildReportDownload(serviceWith(failingRulesetRunner()) as never)(
			{ params: { caseId: realProjectId }, query: { ruleset, add } } as never,
			res as never
		);

		const [location] = res.redirect.mock.calls[0].arguments as [string];
		assert.match(location, new RegExp(`^/consultees/${realProjectId}/report/created\\?ruleset=${ruleset}&add=`));
		assert.equal(res.send.mock.callCount(), 0);
	});

	for (const [title, params, query, projectRows] of [
		['an unknown case', { caseId: realProjectId }, { ruleset }, []],
		['a malformed case id', { caseId: 'not-a-uuid' }, { ruleset }, [realProjectRow()]],
		['a missing case id', {}, { ruleset }, [realProjectRow()]],
		['an unknown ruleset', { caseId: realProjectId }, { ruleset: 'not-a-ruleset' }, [realProjectRow()]]
	] as const) {
		it(`404s for ${title}`, async () => {
			const res = response();
			await buildReportDownload(serviceWith(rulesetRunnerReturning([]), [...projectRows]) as never)(
				{ params, query } as never,
				res as never
			);
			assert.equal(res.status.mock.calls[0].arguments[0], 404);
		});
	}
});
