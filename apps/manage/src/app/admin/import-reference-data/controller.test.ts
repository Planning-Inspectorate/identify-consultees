import { GroupLoadError } from '@pins/identify-consultees-database/src/seed/consultee-area-groups.ts';
import { UnknownDatasetError } from '@pins/identify-consultees-database/src/seed/reference-data.ts';
import { mockLogger } from '@planning-inspectorate/core/testing';
import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import { configureNunjucks } from '../../nunjucks.ts';
import {
	buildClearConsulteeAreas,
	buildImportReferenceDataPage,
	buildRunImportCaseBoundaries,
	buildRunImportConsulteeAreaGroup,
	CASE_BOUNDARIES_BLOB_NAME,
	formatSize,
	loadOutcome
} from './controller.ts';

const lastModified = new Date('2026-10-21T09:00:00Z');
const blob = (name: string, size = 250 * 1024 * 1024) => ({ name, size, lastModified });

/**
 * A database answering the page's queries: the two tables' counts, the dataset in use and every
 * quarter's table, each group's rows in a table (by the first category it counts) and the load log.
 */
function databaseWith({
	consulteeAreas = 15_605,
	caseBoundaries = 283,
	inUse = '2026Q4',
	datasets = [{ name: 'consultee_area_2026Q4', rows: 15_605 }] as { name: string; rows: number }[],
	groupRows = {} as Record<string, number>,
	pendingGroupRows = {} as Record<string, number>,
	loads = [] as Record<string, unknown>[]
} = {}) {
	return {
		$queryRaw: mock.fn(async (sql: TemplateStringsArray, ...values: unknown[]) => {
			const text = sql.join('');
			if (text.includes('AS consulteeAreas')) return [{ consulteeAreas, caseBoundaries }];
			if (text.includes('sys.synonyms')) return [{ baseObjectName: `[dbo].[consultee_area_${inUse}]` }];
			if (text.includes('sys.tables')) return datasets;
			if (text.includes('FROM reference_data_load')) return loads;
			// a group's count in a table - the table, then its categories joined as one Prisma.Sql value
			const table = (values[0] as { sql: string }).sql;
			const [firstCategory] = (values[1] as { values: string[] }).values;
			return [{ count: (table === 'consultee_area' ? groupRows : pendingGroupRows)[firstCategory] ?? 0 }];
		})
	};
}

const files = (blobs = [blob('20261020_public_bodies.geojson')], filePath = '/tmp/import-reference-data-test') => ({
	list: mock.fn(async () => blobs),
	download: mock.fn(async () => ({ filePath, cleanup: mock.fn(async () => undefined) }))
});

describe('admin import reference data', () => {
	const nunjucks = configureNunjucks();
	const newRes = () => ({ render: mock.fn((view: string, data: object) => nunjucks.render(view, data)) });
	const viewModelOf = (res: ReturnType<typeof newRes>) =>
		res.render.mock.calls[0].arguments[1] as Record<string, never>;
	const htmlOf = (res: ReturnType<typeof newRes>) => res.render.mock.calls[0].result as string;

	it("shows each group's newest file, its rows and its last load, and the tables' counts", async () => {
		const res = newRes();
		const db = databaseWith({
			groupRows: { 'Ambulance Trust': 12_000, 'Parish Council': 11_548 },
			loads: [
				{
					dataGroup: 'public_bodies',
					blobName: '20261001_public_bodies.geojson',
					dataDate: new Date('2026-10-01T00:00:00Z'),
					quarter: '2026Q4',
					rowsLoaded: 12_000,
					loadedAt: new Date('2026-10-02T09:30:00Z')
				}
			]
		});
		const blobs = files([
			blob('20260801_public_bodies.geojson'),
			blob('20261020_public_bodies.geojson'),
			blob('20260901_public_bodies.geojson', 512),
			blob('combined_reference_data_v1.geojson'),
			blob('20261020_energy.geojson', 1_500_000)
		]);
		await buildImportReferenceDataPage({ db, logger: mockLogger() } as never, blobs)({}, res);

		assert.strictEqual(res.render.mock.calls[0].arguments[0], 'admin/import-reference-data/view.njk');
		const { groups, loadedConsulteeAreas, loadedCaseBoundaries, blobStorageRead } = viewModelOf(res);
		assert.strictEqual(loadedConsulteeAreas, 15_605);
		assert.strictEqual(loadedCaseBoundaries, 283);
		assert.strictEqual(blobStorageRead, true);
		const [administrative, publicBodies, energy, transport] = groups as Record<string, never>[];
		assert.deepStrictEqual(publicBodies, {
			name: 'Public bodies',
			slug: 'public_bodies',
			categories:
				'Ambulance Trust, Fire and Rescue Authority, Hospital, ICB, Internal Drainage Board, Internal Drainage District, Local Health Board, Local Resilience Forum, National Landscape, Police',
			// the newest by the date its data is from, whatever order they're listed in
			file: { name: '20261020_public_bodies.geojson', dataDate: '20 October 2026', quarter: '2026Q4', size: '250MB' },
			rows: 12_000,
			load: {
				blobName: '20261001_public_bodies.geojson',
				quarter: '2026Q4',
				loadedAt: '2 October 2026 at 10:30',
				rowsLoaded: 12_000
			}
		});
		assert.strictEqual((energy as { file: { size: string } }).file.size, '1.4MB');
		assert.strictEqual('file' in transport, false);
		assert.strictEqual((administrative as { rows: number }).rows, 11_548);

		const html = htmlOf(res);
		assert.match(html, /Consultee areas, by group/);
		assert.match(html, /aria-label="Load Public bodies"/);
		// a group with no file has nothing to load
		assert.doesNotMatch(html, /aria-label="Load Transport"/);
		assert.match(html, /Quarter not known - loaded before loads were logged/);
		// the one dataset, in use
		assert.strictEqual(viewModelOf(res).datasetInUse, '2026Q4');
		assert.deepStrictEqual(viewModelOf(res).datasets, [{ quarter: '2026Q4', rows: 15_605, status: 'In use' }]);
		assert.strictEqual(viewModelOf(res).pending, undefined);
		assert.match(html, /11548 consultee areas in 2026Q4/);
		assert.match(html, /Clear consultee areas/);
		assert.match(html, /Import case boundaries/);
	});

	it('still renders the page with what it could read, logging what it could not', async () => {
		const res = newRes();
		const logger = mockLogger();
		const db = {
			$queryRaw: mock.fn(async () => {
				throw new Error('database unavailable');
			})
		};
		const blobs = {
			list: mock.fn(async () => {
				throw new Error('BLOB_STORE_HOST and BLOB_STORE_CONTAINER are required');
			}),
			download: mock.fn()
		};
		await buildImportReferenceDataPage({ db, logger } as never, blobs)({}, res);

		const { loadedConsulteeAreas, blobStorageRead, groups } = viewModelOf(res);
		assert.strictEqual(loadedConsulteeAreas, undefined);
		assert.strictEqual(blobStorageRead, false);
		assert.strictEqual((groups as unknown[]).length, 5);
		assert.ok((groups as Record<string, unknown>[]).every((group) => !('rows' in group) && !('file' in group)));
		assert.doesNotMatch(htmlOf(res), /Currently loaded/);
		assert.match(htmlOf(res), /Blob storage couldn&#39;t be read/);
		// the counts, each group's rows, the dataset in use, the datasets and blob storage
		assert.strictEqual((logger.warn as ReturnType<typeof mock.fn>).mock.callCount(), 5);
		assert.strictEqual(viewModelOf(res).datasetInUse, undefined);
	});

	it('lists every quarter, and says what a newer one being loaded is still waiting for', async () => {
		const res = newRes();
		const db = databaseWith({
			datasets: [
				{ name: 'consultee_area_2026Q3', rows: 15_000 },
				{ name: 'consultee_area_2027Q1', rows: 1_929 },
				{ name: 'consultee_area_2026Q4', rows: 15_605 }
			],
			groupRows: { 'Parish Council': 11_901, 'Ambulance Trust': 316, DNO: 1_929, Canal: 1_459 },
			pendingGroupRows: { DNO: 1_929 }
		});
		await buildImportReferenceDataPage({ db, logger: mockLogger() } as never, files())({}, res);

		const { datasets, pending, groups } = viewModelOf(res);
		assert.deepStrictEqual(datasets, [
			{ quarter: '2027Q1', rows: 1_929, status: 'Loading' },
			{ quarter: '2026Q4', rows: 15_605, status: 'In use' },
			{ quarter: '2026Q3', rows: 15_000, status: 'Archive' }
		]);
		assert.deepStrictEqual(pending, {
			quarter: '2027Q1',
			waitingFor: ['Administrative boundaries', 'Public bodies', 'Transport']
		});
		assert.strictEqual((groups as { slug: string; pendingRows: number }[])[2].pendingRows, 1_929);
		assert.match(
			htmlOf(res),
			/2027Q1 is being loaded\. The tool keeps using 2026Q4 until Administrative boundaries, Public bodies, Transport are loaded for 2027Q1\./
		);
		assert.match(htmlOf(res), /1929 in 2027Q1/);
	});

	it('words what a load means for the dataset in use', () => {
		const group = (name: string) => ({ name, slug: name, categories: new Set<string>() });
		assert.strictEqual(
			loadOutcome({ quarter: '2026Q4', datasetInUse: '2026Q4', waitingFor: [] }),
			'2026Q4 is the dataset in use.'
		);
		assert.strictEqual(
			loadOutcome({ quarter: '2027Q1', datasetInUse: '2026Q4', waitingFor: [group('Transport')] }),
			'The tool keeps using 2026Q4 until Transport is loaded for 2027Q1.'
		);
		assert.strictEqual(
			loadOutcome({
				quarter: '2027Q1',
				datasetInUse: '2026Q4',
				waitingFor: [group('Energy'), group('Transport'), group('Other')]
			}),
			'The tool keeps using 2026Q4 until Energy, Transport and Other are loaded for 2027Q1.'
		);
	});

	describe('loading a group', () => {
		it("loads the group's newest file, and says what it did", async () => {
			const res = newRes();
			const blobs = files(
				[blob('20260801_public_bodies.geojson'), blob('20261020_public_bodies.geojson')],
				'/tmp/public-bodies.geojson'
			);
			const runImport = mock.fn(async () => ({
				group: {} as never,
				quarter: '2027Q1',
				rowsLoaded: 1_100,
				datasetInUse: '2026Q4',
				waitingFor: [{ name: 'Energy', slug: 'energy', categories: new Set<string>() }]
			}));
			const run = buildRunImportConsulteeAreaGroup(
				{ db: databaseWith(), logger: mockLogger() } as never,
				blobs,
				runImport
			);
			await run({ body: { group: 'public_bodies' } } as never, res);

			assert.strictEqual(blobs.download.mock.calls[0].arguments[0], '20261020_public_bodies.geojson');
			assert.deepStrictEqual(runImport.mock.calls[0].arguments.slice(1), [
				'/tmp/public-bodies.geojson',
				'20261020_public_bodies.geojson'
			]);
			const { groupLoaded, error } = viewModelOf(res);
			assert.strictEqual(error, undefined);
			assert.strictEqual(
				groupLoaded,
				'Loaded Public bodies from 20261020_public_bodies.geojson into 2027Q1: 1100 consultee areas. The tool keeps using 2026Q4 until Energy is loaded for 2027Q1.'
			);
			assert.match(htmlOf(res), /Loaded Public bodies from 20261020_public_bodies\.geojson/);
		});

		it('loads on the bulk client, whose statements can run for minutes, when there is one', async () => {
			const bulkDb = databaseWith();
			const runImport = mock.fn(async () => ({
				group: {} as never,
				quarter: '2026Q4',
				rowsLoaded: 5,
				datasetInUse: '2026Q4',
				waitingFor: []
			}));
			const clear = mock.fn(async () => 1);
			const importBoundaries = mock.fn(async () => 1);
			const service = { db: databaseWith(), bulkDb, logger: mockLogger() } as never;
			await buildRunImportConsulteeAreaGroup(
				service,
				files(),
				runImport
			)({ body: { group: 'public_bodies' } } as never, newRes());
			await buildClearConsulteeAreas(service, files(), clear)({ body: { quarter: '2026Q4' } } as never, newRes());
			await buildRunImportCaseBoundaries(service, files(), importBoundaries)({}, newRes());
			assert.strictEqual(runImport.mock.calls[0].arguments[0], bulkDb);
			assert.strictEqual(clear.mock.calls[0].arguments[0], bulkDb);
			assert.strictEqual(importBoundaries.mock.calls[0].arguments[0], bulkDb);
		});

		it('says when the load is into the dataset in use', async () => {
			const res = newRes();
			const runImport = mock.fn(async () => ({
				group: {} as never,
				quarter: '2026Q4',
				rowsLoaded: 5,
				datasetInUse: '2026Q4',
				waitingFor: []
			}));
			await buildRunImportConsulteeAreaGroup(
				{ db: databaseWith(), logger: mockLogger() } as never,
				files(),
				runImport
			)({ body: { group: 'public_bodies' } } as never, res);
			assert.strictEqual(
				viewModelOf(res).groupLoaded,
				'Loaded Public bodies from 20261020_public_bodies.geojson into 2026Q4: 5 consultee areas. 2026Q4 is the dataset in use.'
			);
		});

		for (const [title, body, blobs, message] of [
			['an unknown group', { group: 'nope' }, [], 'Could not load the group. Choose a group to load.'],
			['no group at all', undefined, [], 'Could not load the group. Choose a group to load.'],
			[
				'a group with no file',
				{ group: 'transport' },
				[blob('20261020_public_bodies.geojson')],
				"Could not load Transport. There's no Transport file in blob storage - upload one first."
			]
		] as const) {
			it(`refuses ${title}, without downloading anything`, async () => {
				const res = newRes();
				const blobFiles = files([...blobs]);
				const runImport = mock.fn();
				await buildRunImportConsulteeAreaGroup(
					{ db: databaseWith(), logger: mockLogger() } as never,
					blobFiles,
					runImport as never
				)({ body } as never, res);
				assert.strictEqual(viewModelOf(res).error, message);
				assert.strictEqual(blobFiles.download.mock.callCount(), 0);
			});
		}

		it("says why the load refused the file - another group's category, an earlier quarter, an unknown dataset", async () => {
			for (const error of [
				new GroupLoadError(
					'20261020_public_bodies.geojson is from 2026Q3, earlier than the dataset in use, 2026Q4. Nothing was changed'
				),
				new UnknownDatasetError(
					"Feature other_HOS_EW_00001 is from dataset HOS_EW, which config/reference-data.yaml doesn't list"
				)
			]) {
				const res = newRes();
				const blobFiles = files();
				const runImport = mock.fn(async () => {
					throw error;
				});
				await buildRunImportConsulteeAreaGroup(
					{ db: databaseWith(), logger: mockLogger() } as never,
					blobFiles,
					runImport
				)({ body: { group: 'public_bodies' } } as never, res);
				assert.strictEqual(viewModelOf(res).error, `Could not load Public bodies. ${error.message}.`);
				// the downloaded file is cleaned up either way
				const { cleanup } = await (blobFiles.download.mock.calls[0].result as unknown as Promise<{
					cleanup: ReturnType<typeof mock.fn>;
				}>);
				assert.strictEqual(cleanup.mock.callCount(), 1);
			}
		});

		it('says it could not load the group from blob storage when anything else fails', async () => {
			const res = newRes();
			const blobFiles = files();
			blobFiles.download = mock.fn(async () => {
				throw new Error('AuthorizationPermissionMismatch');
			});
			await buildRunImportConsulteeAreaGroup({ db: databaseWith(), logger: mockLogger() } as never, blobFiles)(
				{ body: { group: 'public_bodies' } } as never,
				res
			);
			assert.strictEqual(viewModelOf(res).error, 'Could not load Public bodies from blob storage.');
		});
	});

	describe('clearing consultee areas', () => {
		it("deletes the chosen quarter's consultee areas and says how many", async () => {
			const res = newRes();
			const clear = mock.fn(async () => 15_605);
			await buildClearConsulteeAreas(
				{ db: databaseWith(), logger: mockLogger() } as never,
				files(),
				clear
			)({ body: { quarter: '2026Q4' } } as never, res);
			assert.deepStrictEqual(clear.mock.calls[0].arguments.slice(1), ['2026Q4']);
			assert.deepStrictEqual(viewModelOf(res).consulteeAreasCleared, { quarter: '2026Q4', deleted: 15_605 });
			assert.match(htmlOf(res), /Cleared the 2026Q4 dataset: deleted 15605 consultee areas/);
		});

		it('offers each quarter with a dataset, the one in use chosen', async () => {
			const res = newRes();
			const db = databaseWith({
				datasets: [
					{ name: 'consultee_area_2026Q4', rows: 15_605 },
					{ name: 'consultee_area_2027Q1', rows: 1_929 }
				]
			});
			await buildImportReferenceDataPage({ db, logger: mockLogger() } as never, files())({}, res);
			const html = htmlOf(res);
			assert.match(html, /<select class="govuk-select" id="quarter" name="quarter">/);
			assert.match(html, /<option value="2026Q4" selected>2026Q4 - in use, 15605 consultee areas<\/option>/);
			assert.match(html, /<option value="2027Q1">2027Q1 - loading, 1929 consultee areas<\/option>/);
		});

		it('says there is nothing to clear with no dataset', async () => {
			const res = newRes();
			await buildImportReferenceDataPage(
				{ db: databaseWith({ datasets: [] }), logger: mockLogger() } as never,
				files()
			)({}, res);
			assert.match(htmlOf(res), /There's no dataset to clear\./);
		});

		for (const [title, body] of [
			['no quarter', undefined],
			['a quarter with no dataset', { quarter: '2025Q1' }],
			['something that is not a quarter', { quarter: ['2026Q4'] }]
		] as const) {
			it(`refuses ${title}, deleting nothing`, async () => {
				const res = newRes();
				const clear = mock.fn(async () => 0);
				await buildClearConsulteeAreas(
					{ db: databaseWith(), logger: mockLogger() } as never,
					files(),
					clear
				)({ body } as never, res);
				assert.strictEqual(clear.mock.callCount(), 0);
				assert.strictEqual(viewModelOf(res).error, 'Choose a dataset to clear.');
			});
		}

		it('says it could not when the delete fails', async () => {
			const res = newRes();
			const clear = mock.fn(async () => {
				throw new Error('deadlock');
			});
			await buildClearConsulteeAreas(
				{ db: databaseWith(), logger: mockLogger() } as never,
				files(),
				clear
			)({ body: { quarter: '2026Q4' } } as never, res);
			assert.strictEqual(viewModelOf(res).error, 'Could not clear the consultee areas.');
		});
	});

	describe('buildRunImportCaseBoundaries', () => {
		it('downloads the known blob and reports the imported count on success', async () => {
			const res = newRes();
			const blobFiles = files([], '/tmp/case-boundaries.geojson');
			const runImport = mock.fn(async () => 433);
			const run = buildRunImportCaseBoundaries(
				{ db: databaseWith(), logger: mockLogger() } as never,
				blobFiles,
				runImport
			);
			await run({}, res);

			assert.strictEqual(blobFiles.download.mock.calls[0].arguments[0], CASE_BOUNDARIES_BLOB_NAME);
			// merged, never replacing the table - that would delete the boundaries CBOS imported
			assert.deepStrictEqual(runImport.mock.calls[0].arguments.slice(1), ['/tmp/case-boundaries.geojson']);
			const { error, caseBoundariesImported } = viewModelOf(res);
			assert.strictEqual(error, undefined);
			assert.strictEqual(caseBoundariesImported, 433);
			assert.match(htmlOf(res), /Imported case boundaries: 433/);
		});

		it('renders an error when the download fails, without throwing', async () => {
			const res = newRes();
			const blobFiles = files();
			blobFiles.download = mock.fn(async () => {
				throw new Error('AuthorizationPermissionMismatch');
			});
			const runImport = mock.fn(async () => 0);
			await buildRunImportCaseBoundaries(
				{ db: databaseWith(), logger: mockLogger() } as never,
				blobFiles,
				runImport
			)({}, res);
			assert.strictEqual(runImport.mock.callCount(), 0);
			assert.match(viewModelOf(res).error, /Could not import case boundaries/);
		});
	});

	it('gives file sizes in KB under a megabyte, else MB', () => {
		assert.strictEqual(formatSize(10), '1KB');
		assert.strictEqual(formatSize(512 * 1024), '512KB');
		assert.strictEqual(formatSize(1_500_000), '1.4MB');
	});
});
