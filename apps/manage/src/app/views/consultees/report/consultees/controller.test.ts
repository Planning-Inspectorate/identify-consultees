import { mockLogger } from '@planning-inspectorate/core/testing';
import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import { configureNunjucks } from '../../../../nunjucks.ts';
import type { ConsulteeAreaMatchRow } from '../../../../testing/ruleset-runner-stub.ts';
import { failingRulesetRunner, rulesetRunnerReturning } from '../../../../testing/ruleset-runner-stub.ts';
import { buildReportConsulteeAddSubmit, buildReportConsulteesPage, comparableName } from './controller.ts';

const realProjectId = '44444444-4444-4444-4444-444444444444';
const matchId = '55555555-5555-5555-5555-555555555555';
const otherMatchId = '66666666-6666-6666-6666-666666666666';

function realProjectRow(overrides: Record<string, unknown> = {}) {
	return {
		id: realProjectId,
		geometryType: 'Point',
		caseReference: 'EN010099',
		caseName: 'Real Test Project',
		fileName: null,
		receivedDate: null,
		acceptance: null,
		metadata: '{}',
		geometryWkt: 'POINT(-1.5 52.5)',
		...overrides
	};
}

function parishMatchRow(id = matchId, consultee = 'Little Snoring Parish Council', distanceMetres = 0) {
	return {
		reasons: [{ type: 'condition' as const, conditionId: 'b_host_parish_town_community_councils' }],
		id,
		geometryType: 'MultiLineString',
		consulteeCategory: 'Parish Council',
		consultee,
		region: 'East of England',
		caseReference: null,
		documentId: null,
		consulteeId: null,
		organisationId: null,
		currentVersion: 1,
		metadata: '{}',
		geometryWkt: 'MULTILINESTRING((-1.5 52.5, -1.4 52.6))',
		distanceMetres
	};
}

// `query.add` holds the raw JSON param value (Express has already decoded it); expected URLs
// hold the encoded form
const addJson = (name: string, reason = '', category = 'Parish Council') =>
	JSON.stringify({ c: category, n: name, r: reason });
const addParam = (name: string, reason = '', category = 'Parish Council') =>
	encodeURIComponent(addJson(name, reason, category));

// rows[0] answers the project lookup; rows[1], if given, is what the ruleset matched - returned by
// the stand-in Python function (see rulesetRunnerFor), and by the database as the map's display geometry
function dbReturning(rows: unknown[][]) {
	let call = 0;
	return {
		matchRows: (rows[1] ?? []) as ConsulteeAreaMatchRow[],
		$queryRaw: mock.fn(async (sql: TemplateStringsArray) => {
			// the map's search area is a query on the site alone (no table) - answer it with the site
			if (!/\bFROM\b/.test(sql.join(''))) return [{ wkt: realProjectRow().geometryWkt }];
			return rows[Math.min(call++, rows.length - 1)] ?? [];
		})
	};
}

function rulesetRunnerFor(db: unknown) {
	return rulesetRunnerReturning((db as { matchRows?: ConsulteeAreaMatchRow[] }).matchRows ?? []);
}

function handlerFor(db: unknown) {
	return buildReportConsulteesPage({
		db,
		logger: mockLogger(),
		nearbyConsulteeRadiusMetres: 20_000,
		rulesetRunner: rulesetRunnerFor(db)
	});
}

describe('report consultees change page', () => {
	it('should render the category heading, map and consultee table with Remove links', async () => {
		const nunjucks = configureNunjucks();
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn((view, data) => nunjucks.render(view, data))
		};
		const db = dbReturning([[realProjectRow()], [parishMatchRow()]]);
		await handlerFor(db)(
			{
				params: { caseId: realProjectId },
				query: { ruleset: 'england-wales-post-20240430', category: 'Parish Council' }
			},
			mockRes
		);

		assert.strictEqual(mockRes.render.mock.calls[0].arguments[0], 'views/consultees/report/consultees/view.njk');
		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.pageHeading, 'Parish Council');
		assert.strictEqual(viewModel.pageCaption, 'Real Test Project');
		assert.strictEqual(
			viewModel.backLinkUrl,
			`/consultees/${realProjectId}/report?ruleset=england-wales-post-20240430`
		);
		assert.strictEqual(
			viewModel.saveAndReturnUrl,
			`/consultees/${realProjectId}/report?ruleset=england-wales-post-20240430`
		);
		assert.strictEqual(viewModel.rows.length, 1);
		assert.strictEqual(viewModel.rows[0].name, 'Little Snoring Parish Council');
		// the reason the function gave, as the ruleset condition's own description
		assert.deepStrictEqual(viewModel.rows[0].identified, [
			'"B" host Parish / Town / Community Councils: intersects the site'
		]);
		assert.strictEqual(
			viewModel.rows[0].removeUrl,
			`/consultees/${realProjectId}/report/consultees/remove?ruleset=england-wales-post-20240430&category=Parish%20Council&match=${matchId}`
		);
		assert.strictEqual(viewModel.removedRows.length, 0);
		assert.strictEqual(viewModel.removedOpen, false);
		// the add form posts back to this page
		assert.strictEqual(
			viewModel.addFormAction,
			`/consultees/${realProjectId}/report/consultees?ruleset=england-wales-post-20240430&category=Parish%20Council`
		);
		assert.deepStrictEqual(viewModel.addForm, { nameValue: '', reasonValue: '' });
		assert.strictEqual(viewModel.errorSummary, undefined);
		assert.ok(viewModel.mapConfigJson.includes('FeatureCollection'));

		const html = mockRes.render.mock.calls[0].result;
		assert.match(html, /Remove/);
		assert.match(html, /<h2[^>]*id="add-consultee"[^>]*>Add a consultee<\/h2>/);
		assert.match(html, /<form method="post" action="[^"]*\/report\/consultees\?[^"]*"/);
		// nothing nearby to suggest - a plain name input, no datalist
		assert.match(html, /<input[^>]*name="name"/);
		assert.doesNotMatch(html, /<datalist|data-consultee-autocomplete/);
		assert.match(html, /<textarea[^>]*name="reason"/);
		assert.match(html, /Save and return/);
		// nothing has been removed - the expandable Removed consultees section doesn't render
		assert.doesNotMatch(html, /Removed consultees/);
	});

	it('should list every condition a consultee met, but not the nearby search', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const hospitalRow = {
			...parishMatchRow(),
			consulteeCategory: 'Hospital',
			consultee: 'Norfolk Hospital',
			distanceMetres: 123.456,
			reasons: [
				{
					type: 'condition' as const,
					conditionId: 'hospitals_operated_by_nhs_trusts_and_nhs_foundation_trusts_england_10km'
				},
				{ type: 'nearby' as const, radiusMetres: 20_000 }
			]
		};
		const db = dbReturning([[realProjectRow()], [hospitalRow]]);
		await handlerFor(db)({ params: { caseId: realProjectId }, query: { category: 'Hospital' } }, mockRes);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.deepStrictEqual(viewModel.rows[0].identified, [
			'Hospitals operated by NHS Trusts and NHS Foundation Trusts (England): within 10km of the site'
		]);
	});

	it('should give a bordering condition its own description', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const borderingRow = {
			...parishMatchRow(matchId, 'Little Snoring Parish Council', 500),
			reasons: [
				{
					type: 'condition' as const,
					conditionId: 'a_bordering_community_councils_bordering_b_host_community_councils'
				}
			]
		};
		const db = dbReturning([[realProjectRow()], [borderingRow]]);
		await handlerFor(db)({ params: { caseId: realProjectId }, query: { category: 'Parish Council' } }, mockRes);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.deepStrictEqual(viewModel.rows[0].identified, [
			'"A" Community Councils bordering "B" host Community Councils'
		]);
	});

	it('should 404 a category only the nearby search found - it is not in the report', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		// no ruleset covers Corporate Joint Committee, so only the nearby search ever finds one
		const { geometryWkt: _noGeometry, ...committee } = {
			...parishMatchRow(),
			consulteeCategory: 'Corporate Joint Committee',
			consultee: 'South East Wales Corporate Joint Committee',
			distanceMetres: 4_000,
			reasons: [{ type: 'nearby' as const, radiusMetres: 20_000 }]
		};
		const db = dbReturning([[realProjectRow()], [committee]]);
		await handlerFor(db)(
			{ params: { caseId: realProjectId }, query: { category: 'Corporate Joint Committee' } },
			mockRes
		);

		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
	});

	it("should list only identified consultees, but map the category's nearby ones too, fainter", async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const nearbyParish = {
			...parishMatchRow('88888888-8888-8888-8888-888888888888', 'Nearby Parish Council', 9_000),
			reasons: [{ type: 'nearby' as const, radiusMetres: 20_000 }]
		};
		const db = dbReturning([[realProjectRow()], [parishMatchRow(), nearbyParish]]);
		await handlerFor(db)({ params: { caseId: realProjectId }, query: { category: 'Parish Council' } }, mockRes);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.deepStrictEqual(
			viewModel.rows.map((row: { name: string }) => row.name),
			['Little Snoring Parish Council']
		);
		const map = JSON.parse(viewModel.mapConfigJson);
		assert.deepStrictEqual(
			map.consulteeGeojson.features.map((feature: { properties: { name: string; identified: string } }) => [
				feature.properties.name,
				feature.properties.identified
			]),
			[
				['Nearby Parish Council', 'false'],
				['Little Snoring Parish Council', 'true']
			]
		);
	});

	it('should fall back to a condition id the ruleset does not have, rather than drop the reason', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const row = { ...parishMatchRow(), reasons: [{ type: 'condition' as const, conditionId: 'retired_condition' }] };
		const db = dbReturning([[realProjectRow()], [row]]);
		await handlerFor(db)({ params: { caseId: realProjectId }, query: { category: 'Parish Council' } }, mockRes);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.deepStrictEqual(viewModel.rows[0].identified, ['retired_condition']);
	});

	it('should hide excluded consultees from the rows and the remove links keep the rest', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const db = dbReturning([
			[realProjectRow()],
			[parishMatchRow(), parishMatchRow(otherMatchId, 'Great Snoring Parish Council')]
		]);
		await handlerFor(db)(
			{
				params: { caseId: realProjectId },
				query: { category: 'Parish Council', exclude: matchId }
			},
			mockRes
		);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.rows.length, 1);
		assert.strictEqual(viewModel.rows[0].name, 'Great Snoring Parish Council');
		// the remaining row's remove link opens the remove page, carrying the existing exclusion forward
		assert.strictEqual(
			viewModel.rows[0].removeUrl,
			`/consultees/${realProjectId}/report/consultees/remove?ruleset=england-wales-post-20240430&category=Parish%20Council&match=${otherMatchId}&exclude=${matchId}`
		);
		assert.strictEqual(
			viewModel.saveAndReturnUrl,
			`/consultees/${realProjectId}/report?ruleset=england-wales-post-20240430&exclude=${matchId}`
		);
	});

	it('should accept repeated exclude params and ignore blank or non-string values', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const unnamedRow = { ...parishMatchRow(otherMatchId, ''), consultee: null };
		const db = dbReturning([[realProjectRow()], [parishMatchRow(), unnamedRow]]);
		await handlerFor(db)(
			{
				params: { caseId: realProjectId },
				// ?exclude=a&exclude=b parses to an array; blanks and non-strings are ignored
				query: { category: 'Parish Council', exclude: [matchId, '', 42] }
			},
			mockRes
		);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.rows.length, 1);
		// a match with no consultee name still renders a usable row label
		assert.strictEqual(viewModel.rows[0].name, 'Unnamed consultee');
		// only the real exclusion is carried forward
		assert.strictEqual(
			viewModel.saveAndReturnUrl,
			`/consultees/${realProjectId}/report?ruleset=england-wales-post-20240430&exclude=${matchId}`
		);
	});

	it('should list hand-added consultees for the category after the ruleset matches', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const firstAdd = addJson('First Test Consultee', 'Bordering landowner');
		const secondAdd = addJson('Second Test Consultee');
		// an add recorded under a different category doesn't appear here
		const otherCategoryAdd = addJson('Hospital Test Consultee', 'r', 'Hospital');
		const db = dbReturning([[realProjectRow()], [parishMatchRow()]]);
		await handlerFor(db)(
			{
				params: { caseId: realProjectId },
				query: { category: 'Parish Council', add: [firstAdd, secondAdd, otherCategoryAdd] }
			},
			mockRes
		);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.rows.length, 3);
		assert.strictEqual(viewModel.rows[1].name, 'First Test Consultee');
		assert.deepStrictEqual(viewModel.rows[1].identified, ['Bordering landowner']);
		assert.strictEqual(viewModel.rows[2].name, 'Second Test Consultee');
		assert.deepStrictEqual(viewModel.rows[2].identified, ['Manually added']);

		// a hand-added row's remove link opens the remove page targeting that add's index - the
		// adds all ride along so the page can drop the right one on submit
		const addsParam = `&add=${encodeURIComponent(firstAdd)}&add=${encodeURIComponent(secondAdd)}&add=${encodeURIComponent(otherCategoryAdd)}`;
		assert.strictEqual(
			viewModel.rows[1].removeUrl,
			`/consultees/${realProjectId}/report/consultees/remove?ruleset=england-wales-post-20240430&category=Parish%20Council&added=0${addsParam}`
		);
		assert.strictEqual(
			viewModel.rows[2].removeUrl,
			`/consultees/${realProjectId}/report/consultees/remove?ruleset=england-wales-post-20240430&category=Parish%20Council&added=1${addsParam}`
		);
		// the adds ride along to the check page and the next add
		assert.ok(viewModel.saveAndReturnUrl.includes(`add=${encodeURIComponent(firstAdd)}`));
		assert.ok(viewModel.addFormAction.includes(`add=${encodeURIComponent(firstAdd)}`));
		// a ruleset match's remove link keeps the adds while targeting the match
		assert.match(viewModel.rows[0].removeUrl, /match=55555555/);
		assert.ok(viewModel.rows[0].removeUrl.includes(`add=${encodeURIComponent(firstAdd)}`));
	});

	it('should list this category’s recorded removals in the Removed consultees section, open when asked', async () => {
		const nunjucks = configureNunjucks();
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn((view, data) => nunjucks.render(view, data))
		};
		// the first match was removed with a reason; a removal recorded under another category
		// and a bare-id exclusion (a link predating reasons) don't belong in this page's section
		const removal = JSON.stringify({
			i: matchId,
			c: 'Parish Council',
			n: 'Little Snoring Parish Council',
			r: 'Out of area'
		});
		const otherCategoryRemoval = JSON.stringify({ c: 'Hospital', n: 'A Hospital', r: 'duplicate' });
		const db = dbReturning([
			[realProjectRow()],
			[parishMatchRow(), parishMatchRow(otherMatchId, 'Great Snoring Parish Council')]
		]);
		await handlerFor(db)(
			{
				params: { caseId: realProjectId },
				query: {
					category: 'Parish Council',
					exclude: [removal, otherCategoryRemoval, 'id-without-reason'],
					removed: 'open'
				}
			},
			mockRes
		);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		// the excluded match is gone from the rows; only this category's recorded removal is listed
		assert.strictEqual(viewModel.rows.length, 1);
		assert.deepStrictEqual(viewModel.removedRows, [{ name: 'Little Snoring Parish Council', reason: 'Out of area' }]);
		assert.strictEqual(viewModel.removedOpen, true);

		const html = mockRes.render.mock.calls[0].result;
		assert.match(html, /Removed consultees/);
		assert.match(html, /Out of area/);
		assert.match(html, /<details[^>]*open/);
		// the other category's removal isn't listed here (the reasonless exclusion still rides
		// along in the page's links - it just has nothing the section can list)
		assert.doesNotMatch(html, /A Hospital/);
		// but every removal rides along in the page's links
		assert.ok(viewModel.saveAndReturnUrl.includes(`exclude=${encodeURIComponent(removal)}`));
		assert.ok(viewModel.saveAndReturnUrl.includes(`exclude=${encodeURIComponent(otherCategoryRemoval)}`));
		assert.ok(viewModel.saveAndReturnUrl.includes('exclude=id-without-reason'));
	});

	it('should ignore malformed add params rather than fail the page', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const db = dbReturning([[realProjectRow()], [parishMatchRow()]]);
		await handlerFor(db)(
			{
				params: { caseId: realProjectId },
				query: {
					category: 'Parish Council',
					add: [
						'not-json',
						'{}',
						JSON.stringify({ c: '', n: 'empty category' }),
						addJson('', 'no name'),
						JSON.stringify({ c: 'Parish Council', n: 'Kept Consultee' }),
						42
					]
				}
			},
			mockRes
		);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.rows.length, 2);
		assert.strictEqual(viewModel.rows[1].name, 'Kept Consultee');
		// the dropped params aren't carried forward either
		assert.strictEqual((viewModel.saveAndReturnUrl.match(/add=/g) ?? []).length, 1);
	});

	it('should 404 for a category neither the ruleset covers nor the run found', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const db = dbReturning([[realProjectRow()]]);
		await handlerFor(db)({ params: { caseId: realProjectId }, query: { category: 'Not A Category' } }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
	});

	it('should 404 for a missing category', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const db = dbReturning([[realProjectRow()]]);
		await handlerFor(db)({ params: { caseId: realProjectId }, query: {} }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
	});

	it('should 404 for a present-but-unknown ruleset', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const db = dbReturning([[realProjectRow()]]);
		await handlerFor(db)(
			{ params: { caseId: realProjectId }, query: { ruleset: 'not-a-real-ruleset', category: 'Parish Council' } },
			mockRes
		);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
	});

	it('should 404 when caseId is missing or malformed', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const handler = handlerFor({ $queryRaw: mock.fn() });
		await handler({ params: {}, query: {} }, mockRes);
		await handler({ params: { caseId: 'not-a-uuid' }, query: {} }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
		assert.strictEqual(mockRes.status.mock.calls[1].arguments[0], 404);
	});

	it('should 404 for a well-formed id that matches no project', async () => {
		const mockRes = { status: mock.fn(() => mockRes), render: mock.fn() };
		const db = dbReturning([[]]);
		await handlerFor(db)({ params: { caseId: realProjectId }, query: { category: 'Parish Council' } }, mockRes);
		assert.strictEqual(mockRes.status.mock.calls[0].arguments[0], 404);
	});

	it('should flag the ruleset as failed if the run errors', async () => {
		const nunjucks = configureNunjucks();
		const mockRes = {
			status: mock.fn(() => mockRes),
			render: mock.fn((view, data) => nunjucks.render(view, data))
		};
		let call = 0;
		const db = {
			$queryRaw: mock.fn(async () => {
				call += 1;
				if (call === 1) return [realProjectRow()];
				throw new Error('query failed');
			})
		};
		const logger = mockLogger();
		const handler = buildReportConsulteesPage({
			db,
			logger,
			nearbyConsulteeRadiusMetres: 20_000,
			rulesetRunner: failingRulesetRunner()
		});
		await handler({ params: { caseId: realProjectId }, query: { category: 'Parish Council' } }, mockRes);

		const viewModel = mockRes.render.mock.calls[0].arguments[1];
		assert.strictEqual(viewModel.rulesetFailed, true);
		assert.strictEqual(viewModel.rows.length, 0);
		assert.strictEqual(logger.error.mock.callCount(), 1);
		assert.doesNotMatch(mockRes.render.mock.calls[0].result, />Consultees</);
	});
});

describe('report consultees change page add form', () => {
	const nearbyId = '77777777-7777-7777-7777-777777777777';
	const fartherNearbyId = '88888888-8888-8888-8888-888888888888';
	const nearby = [{ type: 'nearby' as const, radiusMetres: 20_000 }];
	// one identified parish; two nearby-only parishes sharing a name, and one more; a nearby-only
	// consultee in another category
	const RUN = [
		parishMatchRow(),
		{ ...parishMatchRow(nearbyId, 'Barton', 1_250), reasons: nearby },
		{ ...parishMatchRow(fartherNearbyId, 'Barton', 4_000), reasons: nearby },
		{ ...parishMatchRow('99999999-9999-9999-9999-999999999999', 'Christleton', 7_300), reasons: nearby },
		{
			...parishMatchRow('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Nearby Hospital', 900),
			consulteeCategory: 'Hospital',
			reasons: nearby
		}
	];
	const service = (rulesetRunner: unknown = rulesetRunnerReturning(RUN)) => ({
		db: dbReturning([[realProjectRow()], RUN]),
		logger: mockLogger(),
		nearbyConsulteeRadiusMetres: 20_000,
		rulesetRunner
	});
	const parishQuery = { ruleset: 'england-wales-post-20240430', category: 'Parish Council' };
	const categoryUrl = `/consultees/${realProjectId}/report/consultees?ruleset=england-wales-post-20240430&category=Parish%20Council`;
	const rendering = () => {
		const nunjucks = configureNunjucks();
		const res = {
			status: mock.fn(() => res),
			render: mock.fn((view: string, data: object) => nunjucks.render(view, data)),
			redirect: mock.fn()
		};
		return res;
	};
	const submit = async (body: unknown, query: Record<string, unknown> = parishQuery, rulesetRunner?: unknown) => {
		const res = rendering();
		await buildReportConsulteeAddSubmit(service(rulesetRunner) as never)(
			{ params: { caseId: realProjectId }, query, body } as never,
			res as never
		);
		return res;
	};
	const viewModelOf = (res: ReturnType<typeof rendering>) =>
		res.render.mock.calls[0].arguments[1] as unknown as Record<string, any>;

	it("suggests the category's nearby consultees as the name is typed, nearest first, once per name", async () => {
		const res = rendering();
		await buildReportConsulteesPage(service() as never)(
			{ params: { caseId: realProjectId }, query: parishQuery } as never,
			res as never
		);

		assert.deepStrictEqual(viewModelOf(res).nearbySuggestions, [
			{ name: 'Barton', hint: '1.3 km from the site' },
			{ name: 'Christleton', hint: '7.3 km from the site' }
		]);
		const html = res.render.mock.calls[0].result as string;
		assert.match(html, /<input[^>]*name="name"[^>]*list="nearby-consultees"[^>]*data-consultee-autocomplete/);
		assert.match(html, /<option value="Barton" label="1\.3 km from the site"><\/option>/);
		assert.doesNotMatch(html, /Nearby Hospital|value="Little Snoring/);
	});

	it('stops suggesting a nearby consultee once it has been added', async () => {
		const res = rendering();
		const added = JSON.stringify({ i: nearbyId, c: 'Parish Council', n: 'Barton', r: 'r' });
		await buildReportConsulteesPage(service() as never)(
			{ params: { caseId: realProjectId }, query: { ...parishQuery, add: added } } as never,
			res as never
		);
		// the farther Barton is still there to suggest
		assert.deepStrictEqual(
			viewModelOf(res).nearbySuggestions.map((suggestion: { name: string }) => suggestion.name),
			['Barton', 'Christleton']
		);
	});

	it('adds a typed name matching a nearby consultee by its id - the nearest of that name', async () => {
		const res = await submit({ name: '  barton ', reason: ' Borders the site ' });

		assert.strictEqual(
			res.redirect.mock.calls[0].arguments[0],
			`${categoryUrl}&add=${encodeURIComponent(JSON.stringify({ i: nearbyId, c: 'Parish Council', n: 'Barton', r: 'Borders the site' }))}#consultees`
		);
	});

	it('adds any other name as typed, with no area to map, after the earlier adds and keeping removals', async () => {
		const earlier = addJson('First Test Consultee', 'First reason');
		const res = await submit(
			{ name: 'Mr  Smith', reason: 'Owns the access road' },
			{ ...parishQuery, exclude: matchId, add: earlier }
		);

		const location = res.redirect.mock.calls[0].arguments[0] as string;
		assert.match(location, /exclude=55555555/);
		const newAdd = encodeURIComponent(addJson('Mr Smith', 'Owns the access road'));
		assert.ok(location.indexOf(encodeURIComponent(earlier)) > 0);
		assert.ok(location.indexOf(encodeURIComponent(earlier)) < location.indexOf(newAdd));
	});

	it('shows the page again with an error per missing field and the entered values', async () => {
		const res = await submit({ name: '  ', reason: '' });

		assert.strictEqual(res.redirect.mock.callCount(), 0);
		assert.strictEqual(res.status.mock.callCount(), 0);
		const viewModel = viewModelOf(res);
		assert.deepStrictEqual(viewModel.addForm, {
			nameValue: '  ',
			reasonValue: '',
			nameError: { text: 'Enter the consultee name' },
			reasonError: { text: 'Enter a reason for adding this consultee.' }
		});
		assert.deepStrictEqual(viewModel.errorSummary, [
			{ text: 'Enter the consultee name', href: '#consultee-name' },
			{ text: 'Enter a reason for adding this consultee.', href: '#consultee-reason' }
		]);
		const html = res.render.mock.calls[0].result as string;
		assert.match(html, /<title>\s*Error: Parish Council/);
		assert.match(html, /There is a problem/);
		assert.match(html, /govuk-input--error/);
		assert.match(html, /govuk-textarea--error/);
	});

	it('refuses a name already listed in the category, identified or added', async () => {
		const identified = await submit({ name: 'little snoring parish council', reason: 'r' });
		assert.strictEqual(
			viewModelOf(identified).addForm.nameError.text,
			'little snoring parish council is already listed in Parish Council'
		);

		const added = await submit(
			{ name: 'Mr Smith', reason: 'r' },
			{ ...parishQuery, add: addJson('MR SMITH', 'first time') }
		);
		assert.strictEqual(viewModelOf(added).addForm.nameError.text, 'Mr Smith is already listed in Parish Council');
	});

	it('treats a missing or non-string name, or no body at all, as no name', async () => {
		for (const body of [{ reason: 'r' }, { name: ['a'], reason: 'r' }, undefined]) {
			const res = await submit(body);
			assert.strictEqual(viewModelOf(res).addForm.nameError.text, 'Enter the consultee name');
			assert.strictEqual(viewModelOf(res).addForm.nameValue, '');
		}
	});

	it("still adds a typed name when the ruleset can't be run", async () => {
		const res = await submit({ name: 'Barton', reason: 'r' }, parishQuery, failingRulesetRunner());
		assert.ok(
			(res.redirect.mock.calls[0].arguments[0] as string).endsWith(
				`&add=${encodeURIComponent(addJson('Barton', 'r'))}#consultees`
			)
		);
	});

	it('404s a case, ruleset or category the page would', async () => {
		for (const query of [
			{ ...parishQuery, ruleset: 'not-a-real-ruleset' },
			{ ...parishQuery, category: 'Not A Category' }
		]) {
			const res = await submit({ name: 'n', reason: 'r' }, query);
			assert.strictEqual(res.status.mock.calls[0].arguments[0], 404);
			assert.strictEqual(res.redirect.mock.callCount(), 0);
		}
		const res = rendering();
		await buildReportConsulteeAddSubmit(service() as never)(
			{ params: { caseId: 'not-a-uuid' }, query: parishQuery, body: {} } as never,
			res as never
		);
		assert.strictEqual(res.status.mock.calls[0].arguments[0], 404);
	});

	it('compares names without case or extra spaces', () => {
		assert.strictEqual(comparableName('  Little   Snoring\tParish '), 'little snoring parish');
	});
});
