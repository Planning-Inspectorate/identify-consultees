import { mockLogger } from '@planning-inspectorate/core/testing';
import { strFromU8, unzipSync } from 'fflate';
import assert from 'node:assert';
import { after, before, describe, it, mock } from 'node:test';
import { ONE_PIXEL_PNG, pdfTextLines } from '../../../../testing/pdf-text.ts';
import type { ConsulteeAreaMatchRow } from '../../../../testing/ruleset-runner-stub.ts';
import { failingRulesetRunner, rulesetRunnerReturning } from '../../../../testing/ruleset-runner-stub.ts';
import { consulteeSelection, reportDownloadUrl } from '../urls.ts';
import { buildReportDownload } from './controller.ts';
import { rememberReportZip } from './report-zip.ts';

const realProjectId = '44444444-4444-4444-4444-444444444444';
const ruleset = 'england-wales-post-20240430';

const identifiedParish = 'aaaaaaaa-0000-0000-0000-000000000001';
const removedParish = 'aaaaaaaa-0000-0000-0000-000000000002';
const pickedParish = 'aaaaaaaa-0000-0000-0000-000000000003';
const nearbyParish = 'aaaaaaaa-0000-0000-0000-000000000004';

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

const identifiedReason = [{ type: 'condition' as const, conditionId: 'b_host_parish_town_community_councils' }];
const nearbyReason = [{ type: 'nearby' as const, radiusMetres: 20_000 }];

function matchRow(
	id: string,
	reasons: ConsulteeAreaMatchRow['reasons'],
	geometryWkt: string | undefined = 'POINT(-1.5 52.5)'
): ConsulteeAreaMatchRow {
	return {
		id,
		consulteeCategory: 'Parish Council',
		consultee: `Parish ${id.slice(-1)}`,
		region: 'East',
		...(geometryWkt ? { geometryWkt } : {}),
		distanceMetres: 1_500,
		reasons
	};
}

const SEARCH_AREA_WKT = 'POLYGON((-1.6 52.4, -1.4 52.4, -1.4 52.6, -1.6 52.6, -1.6 52.4))';

function serviceWith(
	rulesetRunner: unknown,
	{ projectRows = [realProjectRow()] as unknown[], searchAreaFails = false } = {}
) {
	return {
		db: {
			$queryRaw: mock.fn(async (sql: TemplateStringsArray) => {
				const text = sql.join('');
				// the maps' search area is a query on the site alone (no table)
				if (!/\bFROM\b/.test(text)) {
					if (searchAreaFails) {
						throw new Error('Unrecognised WKT: FULLGLOBE');
					}
					return [{ wkt: SEARCH_AREA_WKT }];
				}
				// each consultee's display geometry
				if (text.includes('AS tolerance')) {
					return [identifiedParish, pickedParish, nearbyParish].map((id) => ({ id, geometryWkt: 'POINT(-1.5 52.5)' }));
				}
				return projectRows;
			}),
			consulteeArea: {
				findMany: mock.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
					where.id.in.map((id) => ({
						id: id.toUpperCase(),
						geometryType: 'Point',
						consulteeCategory: 'Parish Council',
						consultee: `Parish ${id}`,
						region: 'East',
						metadata: '{}',
						lastUpdated: new Date('2026-10-01T09:00:00Z')
					}))
				)
			}
		},
		logger: mockLogger(),
		nearbyConsulteeRadiusMetres: 20_000,
		nearbySearchRadiusMetres: 20_000,
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

function zipOf(res: ReturnType<typeof response>) {
	return unzipSync(new Uint8Array(res.send.mock.calls[0].arguments[0] as unknown as Buffer));
}

const removal = JSON.stringify({ i: removedParish, c: 'Parish Council', n: 'Parish 2', r: 'Dissolved' });
const pickedAdd = JSON.stringify({ i: pickedParish, c: 'Parish Council', n: 'Parish 3', r: 'Borders the site' });
const typedAdd = JSON.stringify({ c: 'Landowner', n: 'Typed Landowner', r: 'Owns the access road' });

describe('report download', () => {
	// the maps' basemap tiles - never the real tile server from a test
	const originalFetch = globalThis.fetch;
	before(() => {
		globalThis.fetch = async () =>
			new Response(ONE_PIXEL_PNG, { status: 200, headers: { 'content-type': 'image/png' } });
	});
	after(() => {
		globalThis.fetch = originalFetch;
	});

	it('sends a ZIP of the workbook and a map PDF per report category, as the category pages left them', async () => {
		const service = serviceWith(
			rulesetRunnerReturning([
				matchRow(identifiedParish, identifiedReason),
				matchRow(removedParish, identifiedReason),
				matchRow(pickedParish, nearbyReason),
				// only the nearby search found it, and no one added it - on the map, not in the report
				matchRow(nearbyParish, nearbyReason)
			])
		);
		const res = response();
		await buildReportDownload(service as never)(
			{ params: { caseId: realProjectId }, query: { ruleset, exclude: removal, add: [pickedAdd, typedAdd] } } as never,
			res as never
		);

		// the stored rows of what's in the report: the identified parish, and the picked nearby one
		const [{ where }] = service.db.consulteeArea.findMany.mock.calls[0].arguments;
		assert.deepStrictEqual(where.id.in, [identifiedParish, pickedParish]);

		const [headers] = res.set.mock.calls[0].arguments as unknown as [Record<string, string>];
		assert.equal(headers['Content-Type'], 'application/zip');
		assert.match(
			headers['Content-Disposition'],
			/^attachment; filename="EN010099 England Wales post 30 April 2024 consultee report \d{4}-\d{2}-\d{2}\.zip"$/
		);
		const files = zipOf(res);
		const names = Object.keys(files);
		assert.deepStrictEqual(names.slice(1), ['maps/01 Parish Council.pdf', 'maps/02 Landowner.pdf']);
		assert.match(names[0], /^EN010099 England Wales post 30 April 2024 consultees \d{4}-\d{2}-\d{2}\.xlsx$/);
		// the workbook lists the picked parish, manually added, with the reason given - and none of
		// the columns the report leaves out
		const workbook = unzipSync(files[names[0]]);
		const sheets = Object.entries(workbook)
			.filter(([name]) => name.startsWith('xl/'))
			.map(([, data]) => strFromU8(data))
			.join('');
		assert.ok(sheets.includes('Borders the site'));
		assert.ok(sheets.includes('Manually added'));
		assert.ok(!sheets.includes(pickedParish) && !sheets.includes('Consultee area id'));

		const parish = pdfTextLines(Buffer.from(files['maps/01 Parish Council.pdf']));
		assert.ok(parish.includes('Parish Council: 2 in the report'));
		assert.ok(parish.includes('Parish 1'));
		assert.ok(parish.includes('Parish 3'));
		assert.ok(parish.includes('Borders the site'));
		assert.ok(!parish.includes('Parish 2') && !parish.includes('Parish 4'));
		assert.ok(!parish.some((line) => line.startsWith('The consultee areas could not be drawn')));
		const landowner = pdfTextLines(Buffer.from(files['maps/02 Landowner.pdf']));
		assert.ok(landowner.includes('Manually added - not on the map'));
	});

	it("puts Nearby NSIPs in the report like any category - their own tab, with their case's details, and a map", async () => {
		const nearbyNsip = 'bbbbbbbb-0000-0000-0000-000000000001';
		const undatedNsip = 'bbbbbbbb-0000-0000-0000-000000000002';
		const base = serviceWith(rulesetRunnerReturning([matchRow(identifiedParish, identifiedReason)]));
		const parishQueries = base.db.$queryRaw;
		const nearbyCase = (id: string, caseReference: string, caseName: string, distanceMetres: number) => ({
			id: id.toUpperCase(),
			caseReference,
			caseName,
			fileName: `${caseReference}.geojson`,
			receivedDate: new Date('2026-09-01T09:00:00Z'),
			distanceMetres
		});
		const service = {
			...base,
			nearbyNsipRadiusMetres: 10_000,
			db: {
				...base.db,
				$queryRaw: mock.fn(async (sql: TemplateStringsArray, ...values: unknown[]) => {
					const text = sql.join('');
					// the cases near the site, and their boundaries for the map
					if (text.includes('PARTITION BY caseReference')) {
						return [
							nearbyCase(nearbyNsip, 'EN010200', 'Neighbouring Solar Farm', 2_345),
							nearbyCase(undatedNsip, 'EN010201', 'Undated Wind Farm', 0)
						];
					}
					if (text.includes('FROM case_boundary') && text.includes('AS tolerance')) {
						return [{ id: nearbyNsip.toUpperCase(), geometryWkt: 'POINT(-1.45 52.5)' }];
					}
					return parishQueries(sql, ...(values as []));
				}),
				caseBoundary: {
					findMany: mock.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
						where.id.in.map((id) => ({
							id: id.toUpperCase(),
							geometryType: 'Polygon',
							caseReference: id === nearbyNsip ? 'EN010200' : 'EN010201',
							caseName: id === nearbyNsip ? 'Neighbouring Solar Farm' : 'Undated Wind Farm',
							fileName: id === nearbyNsip ? 'neighbour.geojson' : null,
							receivedDate: id === nearbyNsip ? new Date('2026-09-01T09:00:00Z') : null,
							lastUpdated: new Date('2026-10-01T09:00:00Z')
						}))
					)
				}
			}
		};
		const res = response();
		await buildReportDownload(service as never)(
			{ params: { caseId: realProjectId }, query: { ruleset } } as never,
			res as never
		);

		// their rows come from case_boundary, not consultee_area
		assert.deepStrictEqual(service.db.consulteeArea.findMany.mock.calls[0].arguments[0].where.id.in, [
			identifiedParish
		]);
		assert.deepStrictEqual(service.db.caseBoundary.findMany.mock.calls[0].arguments[0].where.id.in, [
			nearbyNsip,
			undatedNsip
		]);
		const files = zipOf(res);
		const names = Object.keys(files);
		assert.deepStrictEqual(names.slice(1), ['maps/01 Parish Council.pdf', 'maps/02 Nearby NSIPs.pdf']);
		const workbook = unzipSync(files[names[0]]);
		const xml = Object.entries(workbook)
			.filter(([name]) => name.startsWith('xl/'))
			.map(([, data]) => strFromU8(data))
			.join('');
		for (const text of [
			'name="Nearby NSIPs"',
			'Neighbouring Solar Farm (EN010200)',
			'Another NSIP within 10km of the site',
			'neighbour.geojson',
			'1 September 2026',
			'Distance from site (km)'
		]) {
			assert.ok(xml.includes(text), text);
		}
		const nsips = pdfTextLines(Buffer.from(files['maps/02 Nearby NSIPs.pdf']));
		assert.ok(nsips.includes('Nearby NSIPs: 2 in the report'));
		assert.ok(nsips.includes('Neighbouring Solar Farm (EN010200)'));
		assert.ok(nsips.includes('Undated Wind Farm (EN010201)'));
	});

	it('uses the run the session keeps, and notes a map that then has no areas to draw', async () => {
		const runner = rulesetRunnerReturning([matchRow(identifiedParish, identifiedReason)]);
		// the search area fails, and a kept run has no geometry - nothing to draw the parish from
		const service = serviceWith(runner, { searchAreaFails: true });
		const session = {};
		const request = { params: { caseId: realProjectId }, query: { ruleset }, session } as never;
		await buildReportDownload(service as never)(request, response() as never);
		const res = response();
		await buildReportDownload(service as never)(request, res as never);

		assert.equal(runner.mock.callCount(), 1);
		const parish = pdfTextLines(Buffer.from(zipOf(res)['maps/01 Parish Council.pdf']));
		assert.ok(parish.includes('The consultee areas could not be drawn on this map. They are listed on the next page.'));
	});

	it('says there are no maps when nothing is in the report', async () => {
		const res = response();
		await buildReportDownload(serviceWith(rulesetRunnerReturning([matchRow(nearbyParish, nearbyReason)])) as never)(
			{ params: { caseId: realProjectId }, query: { ruleset } } as never,
			res as never
		);
		const files = zipOf(res);
		assert.equal(Object.keys(files).length, 2);
		assert.equal(strFromU8(files['maps/README.txt']), 'No consultees are in the report, so there are no maps.\n');
	});

	it('fetches stored rows in batches SQL Server accepts, and uses the default ruleset when none is given', async () => {
		const rows = Array.from({ length: 1001 }, (_, i) =>
			matchRow(`aaaaaaaa-0000-0000-0000-${String(i).padStart(12, '0')}`, identifiedReason, undefined)
		);
		// a boundary loaded without a file name or received date
		const service = serviceWith(rulesetRunnerReturning(rows), {
			projectRows: [{ ...realProjectRow(), fileName: null, receivedDate: null }]
		});
		const res = response();
		await buildReportDownload(service as never)(
			{ params: { caseId: realProjectId }, query: {} } as never,
			res as never
		);

		assert.deepStrictEqual(
			service.db.consulteeArea.findMany.mock.calls.map((call) => call.arguments[0].where.id.in.length),
			[1000, 1]
		);
		assert.match(
			(res.set.mock.calls[0].arguments as unknown as [Record<string, string>])[0]['Content-Disposition'],
			/England Wales post 30 April 2024/
		);
	});

	it('serves the report the created page remembered, without running the ruleset again', async () => {
		const query = { ruleset, add: JSON.stringify({ c: 'Landowner', n: 'Kept Report Landowner', r: '' }) };
		const downloadUrl = reportDownloadUrl(realProjectId, ruleset, consulteeSelection(query));
		rememberReportZip(downloadUrl, { fileName: 'kept.zip', contents: Buffer.from('the kept report') });

		const runner = rulesetRunnerReturning([]);
		const service = serviceWith(runner);
		const res = response();
		await buildReportDownload(service as never)({ params: { caseId: realProjectId }, query } as never, res as never);

		assert.equal(runner.mock.callCount(), 0);
		assert.equal(service.db.consulteeArea.findMany.mock.callCount(), 0);
		assert.match(
			(res.set.mock.calls[0].arguments as unknown as [Record<string, string>])[0]['Content-Disposition'],
			/filename="kept\.zip"/
		);
		assert.deepStrictEqual(res.send.mock.calls[0].arguments[0], Buffer.from('the kept report'));
	});

	it('goes back to the Report created page, keeping the selection, when the ruleset cannot be run', async () => {
		const res = response();
		await buildReportDownload(serviceWith(failingRulesetRunner()) as never)(
			{ params: { caseId: realProjectId }, query: { ruleset, add: typedAdd } } as never,
			res as never
		);

		const [location] = res.redirect.mock.calls[0].arguments as unknown as [string];
		assert.match(location, new RegExp(`^/consultees/${realProjectId}/report/created\\?ruleset=${ruleset}&add=`));
		assert.equal(res.send.mock.callCount(), 0);
	});

	it('goes back to the Report created page with a download-failed flag when the report cannot be built', async () => {
		const service = serviceWith(rulesetRunnerReturning([matchRow(identifiedParish, identifiedReason)]));
		service.db.consulteeArea.findMany = mock.fn(async () => {
			throw new Error('db down');
		});
		const res = response();
		await buildReportDownload(service as never)(
			{
				params: { caseId: realProjectId },
				// a URL no other test uses - a kept copy would serve instead of rebuilding
				query: { ruleset, exclude: 'eeeeeeee-0000-0000-0000-000000000042' }
			} as never,
			res as never
		);

		assert.equal(res.send.mock.callCount(), 0);
		const [location] = res.redirect.mock.calls[0].arguments as unknown as [string];
		assert.match(location, new RegExp(`^/consultees/${realProjectId}/report/created\\?ruleset=${ruleset}`));
		assert.match(location, /download=failed/);
		assert.match(location, /exclude=/);
	});

	for (const [title, params, query, projectRows] of [
		['an unknown case', { caseId: realProjectId }, { ruleset }, []],
		['a malformed case id', { caseId: 'not-a-uuid' }, { ruleset }, [realProjectRow()]],
		['a missing case id', {}, { ruleset }, [realProjectRow()]],
		['an unknown ruleset', { caseId: realProjectId }, { ruleset: 'not-a-ruleset' }, [realProjectRow()]]
	] as const) {
		it(`404s for ${title}`, async () => {
			const res = response();
			await buildReportDownload(serviceWith(rulesetRunnerReturning([]), { projectRows: [...projectRows] }) as never)(
				{ params, query } as never,
				res as never
			);
			assert.equal(res.status.mock.calls[0].arguments[0], 404);
		});
	}
});
