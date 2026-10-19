import { mockLogger } from '@planning-inspectorate/core/testing';
import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import { configureNunjucks } from '../../../../../nunjucks.ts';
import { failingRulesetRunner, rulesetRunnerReturning } from '../../../../../testing/ruleset-runner-stub.ts';
import { buildReportConsulteeAddPage, buildReportConsulteeAddSubmit, notAConsulteeError } from './controller.ts';

// a selection entry as the app's URLs carry it - base64url-encoded JSON (see urls.ts's ENCODED_JSON)
const urlParam = (json: string) => Buffer.from(json).toString('base64url');

const realProjectId = '44444444-4444-4444-4444-444444444444';
const matchId = '55555555-5555-5555-5555-555555555555';
const nearbyId = '77777777-7777-7777-7777-777777777777';
const fartherNearbyId = '88888888-8888-8888-8888-888888888888';

function realProjectRow() {
	return {
		id: realProjectId,
		geometryType: 'Point',
		caseReference: 'EN010099',
		caseName: 'Real Test Project',
		fileName: null,
		receivedDate: null,
		acceptance: null,
		metadata: '{}',
		geometryWkt: 'POINT(-1.5 52.5)'
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
		metadata: '{}',
		geometryWkt: 'MULTILINESTRING((-1.5 52.5, -1.4 52.6))',
		distanceMetres
	};
}

// `query.add`/`query.exclude` hold the raw param values (Express has already decoded them);
// expected URLs hold the encoded forms
const addJson = (name: string, reason = '', category = 'Parish Council') =>
	JSON.stringify({ c: category, n: name, r: reason });

const parishQuery = { ruleset: 'england-wales-post-20240430', category: 'Parish Council' };
const categoryUrl = `/consultees/${realProjectId}/report/consultees?ruleset=england-wales-post-20240430&category=Parish%20Council`;
const addUrl = `/consultees/${realProjectId}/report/consultees/add?ruleset=england-wales-post-20240430&category=Parish%20Council`;

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

// the reference data's consultees, as the name lookup finds them (ids as SQL Server returns them)
const storedId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const STORED = [
	{ id: storedId.toUpperCase(), consultee: 'Mr Smith', consulteeCategory: 'Parish Council', distanceMetres: 31_000 },
	{ id: nearbyId.toUpperCase(), consultee: 'Barton', consulteeCategory: 'Parish Council', distanceMetres: 1_250 },
	{
		id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
		consultee: 'Banana Hospital',
		consulteeCategory: 'Hospital',
		distanceMetres: 5
	}
];

// rows[0] answers the project lookup; the ruleset run is answered by the stand-in Python
// function (see rulesetRunnerReturning) rather than a query, and the name lookup from STORED
function dbReturning(rows: unknown[][]) {
	let call = 0;
	return {
		$queryRaw: mock.fn(async (sql: TemplateStringsArray, ...values: unknown[]) => {
			const text = sql.join('');
			// a query on the site alone (no table) - answer it with the site
			if (!/\bFROM\b/.test(text)) return [realProjectRow().geometryWkt];
			if (text.includes('LOWER(consultee)')) {
				const [, category, name] = values as string[];
				return STORED.filter(
					(row) => row.consulteeCategory === category && row.consultee.toLowerCase() === name.toLowerCase()
				).map(({ id, consultee, distanceMetres }) => ({ id, consultee, distanceMetres }));
			}
			return rows[Math.min(call++, rows.length - 1)] ?? [];
		})
	};
}

const service = (rulesetRunner: unknown = rulesetRunnerReturning(RUN)) => ({
	db: dbReturning([[realProjectRow()]]),
	logger: mockLogger(),
	nearbyConsulteeRadiusMetres: 20_000,
	rulesetRunner
});

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

describe('add a consultee page', () => {
	it('renders the form with the category as caption, back link, and a post back to itself', async () => {
		const res = rendering();
		await buildReportConsulteeAddPage(service() as never)(
			{ params: { caseId: realProjectId }, query: parishQuery } as never,
			res as never
		);

		assert.strictEqual(res.render.mock.calls[0].arguments[0], 'views/consultees/report/consultees/add/view.njk');
		const viewModel = viewModelOf(res);
		assert.strictEqual(viewModel.pageHeading, 'Add a consultee');
		assert.strictEqual(viewModel.pageCaption, 'Parish Council');
		assert.strictEqual(viewModel.backLinkUrl, categoryUrl);
		assert.strictEqual(viewModel.formAction, addUrl);
		assert.deepStrictEqual(viewModel.addForm, { nameValue: '', reasonValue: '' });
		assert.strictEqual(viewModel.errorSummary, undefined);

		const html = res.render.mock.calls[0].result as string;
		assert.match(html, /<form method="post" action="[^"]*\/report\/consultees\/add\?[^"]*"/);
		assert.match(html, /<input[^>]*name="name"/);
		assert.match(html, /<textarea[^>]*name="reason"/);
		assert.match(html, /Add consultee/);
		// the reviewed layout: a two-thirds column, a large (not extra-large) heading, bold labels
		assert.match(html, /govuk-grid-column-two-thirds/);
		assert.match(html, /govuk-heading-l/);
		assert.match(html, /govuk-label--m/);
	});

	it("suggests the category's nearby consultees as the name is typed, nearest first, once per name", async () => {
		const res = rendering();
		await buildReportConsulteeAddPage(service() as never)(
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
		await buildReportConsulteeAddPage(service() as never)(
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
			`${categoryUrl}&add=${urlParam(JSON.stringify({ i: nearbyId, c: 'Parish Council', n: 'Barton', r: 'Borders the site' }))}#consultees`
		);
	});

	it('adds a consultee from the reference data that is not nearby, by its id, after the earlier adds', async () => {
		const earlier = addJson('First Test Consultee', 'First reason');
		const res = await submit(
			{ name: 'mr  smith', reason: 'Owns the access road' },
			{ ...parishQuery, exclude: matchId, add: earlier }
		);

		const location = res.redirect.mock.calls[0].arguments[0] as string;
		assert.match(location, /exclude=55555555/);
		// the stored spelling and its id, lowercase as the report's ids are
		const newAdd = urlParam(
			JSON.stringify({ i: storedId, c: 'Parish Council', n: 'Mr Smith', r: 'Owns the access road' })
		);
		assert.ok(location.indexOf(urlParam(earlier)) > 0);
		assert.ok(location.indexOf(urlParam(earlier)) < location.indexOf(newAdd));
	});

	it('refuses a name that is not a consultee of the category, saying so above the form', async () => {
		const res = await submit({ name: 'Banana', reason: 'Looks important' });

		assert.strictEqual(res.redirect.mock.callCount(), 0);
		const viewModel = viewModelOf(res);
		assert.strictEqual(
			viewModel.addForm.nameError.text,
			'Banana does not exist as a Parish Council consultee. Enter a valid consultee.'
		);
		assert.strictEqual(viewModel.addForm.nameValue, 'Banana');
		assert.strictEqual(viewModel.addForm.reasonValue, 'Looks important');
		assert.deepStrictEqual(viewModel.errorSummary, [
			{ text: notAConsulteeError('Banana', 'Parish Council'), href: '#consultee-name' }
		]);
		const html = res.render.mock.calls[0].result as string;
		assert.match(html, /There is a problem/);
		assert.match(html, /Banana does not exist as a Parish Council consultee/);

		// a consultee of another category isn't one of this one's - and a missing reason is said too
		const otherCategory = await submit({ name: 'Banana Hospital', reason: '' });
		assert.deepStrictEqual(
			viewModelOf(otherCategory).errorSummary.map((error: { text: string }) => error.text),
			[notAConsulteeError('Banana Hospital', 'Parish Council'), 'Enter a reason for adding this consultee.']
		);
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
		assert.match(html, /<title>\s*Error: Add a consultee/);
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

	it("still adds a consultee, from the reference data, when the ruleset can't be run", async () => {
		const res = await submit({ name: 'Barton', reason: 'r' }, parishQuery, failingRulesetRunner());
		assert.ok(
			(res.redirect.mock.calls[0].arguments[0] as string).endsWith(
				`&add=${urlParam(JSON.stringify({ i: nearbyId, c: 'Parish Council', n: 'Barton', r: 'r' }))}#consultees`
			)
		);
	});

	it('404s a case, ruleset or category the category page would', async () => {
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
});
