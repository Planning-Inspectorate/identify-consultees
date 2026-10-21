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
	formatSize
} from './controller.ts';

const lastModified = new Date('2026-10-21T09:00:00Z');
const blob = (name: string, size = 250 * 1024 * 1024) => ({ name, size, lastModified });

/**
 * A database answering the page's queries: the two tables' counts, each group's rows (by the
 * first category it counts) and the load log.
 */
function databaseWith({
	consulteeAreas = 15_605,
	caseBoundaries = 283,
	groupRows = {} as Record<string, number>,
	loads = [] as Record<string, unknown>[]
} = {}) {
	return {
		$queryRaw: mock.fn(async (sql: TemplateStringsArray, ...values: unknown[]) => {
			const text = sql.join('');
			if (text.includes('AS consulteeAreas')) return [{ consulteeAreas, caseBoundaries }];
			if (text.includes('FROM reference_data_load')) return loads;
			// a group's count - its categories arrive joined, as one Prisma.Sql value
			const [firstCategory] = (values[0] as { values: string[] }).values;
			return [{ count: groupRows[firstCategory] ?? 0 }];
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
					blobName: '20260801_public_bodies.geojson',
					dataDate: new Date('2026-08-01T00:00:00Z'),
					quarter: '2026-Q3',
					rowsLoaded: 12_000,
					rowsArchived: 0,
					loadedAt: new Date('2026-08-02T09:30:00Z')
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
			file: { name: '20261020_public_bodies.geojson', dataDate: '20 October 2026', quarter: '2026-Q4', size: '250MB' },
			rows: 12_000,
			load: {
				blobName: '20260801_public_bodies.geojson',
				quarter: '2026-Q3',
				loadedAt: '2 August 2026 at 10:30',
				rowsLoaded: 12_000,
				rowsArchived: 0
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
		assert.match(html, /Clear consultee areas/);
		assert.match(html, /Replace case boundaries/);
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
		assert.strictEqual((logger.warn as ReturnType<typeof mock.fn>).mock.callCount(), 4);
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
				quarter: '2026-Q4',
				rowsLoaded: 1_100,
				rowsArchived: 900,
				archivedQuarter: '2026-Q3'
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
				'Loaded Public bodies from 20261020_public_bodies.geojson: 1100 consultee areas, 2026-Q4. Archived its 900 2026-Q3 consultee areas.'
			);
			assert.match(htmlOf(res), /Loaded Public bodies from 20261020_public_bodies\.geojson/);
		});

		it('loads on the bulk client, whose statements can run for minutes, when there is one', async () => {
			const bulkDb = databaseWith();
			const runImport = mock.fn(async () => ({
				group: {} as never,
				quarter: '2026-Q4',
				rowsLoaded: 5,
				rowsArchived: 0
			}));
			const clear = mock.fn(async () => 1);
			const importBoundaries = mock.fn(async () => 1);
			const service = { db: databaseWith(), bulkDb, logger: mockLogger() } as never;
			await buildRunImportConsulteeAreaGroup(
				service,
				files(),
				runImport
			)({ body: { group: 'public_bodies' } } as never, newRes());
			await buildClearConsulteeAreas(service, files(), clear)({}, newRes());
			await buildRunImportCaseBoundaries(service, files(), importBoundaries)({}, newRes());
			assert.strictEqual(runImport.mock.calls[0].arguments[0], bulkDb);
			assert.strictEqual(clear.mock.calls[0].arguments[0], bulkDb);
			assert.strictEqual(importBoundaries.mock.calls[0].arguments[0], bulkDb);
		});

		it('says only what was loaded when nothing was archived', async () => {
			const res = newRes();
			const runImport = mock.fn(async () => ({
				group: {} as never,
				quarter: '2026-Q4',
				rowsLoaded: 5,
				rowsArchived: 0
			}));
			await buildRunImportConsulteeAreaGroup(
				{ db: databaseWith(), logger: mockLogger() } as never,
				files(),
				runImport
			)({ body: { group: 'public_bodies' } } as never, res);
			assert.strictEqual(
				viewModelOf(res).groupLoaded,
				'Loaded Public bodies from 20261020_public_bodies.geojson: 5 consultee areas, 2026-Q4.'
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
				new GroupLoadError('20261020_public_bodies.geojson holds 2026-Q4 data. Nothing was changed'),
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
		it('deletes every consultee area and says how many', async () => {
			const res = newRes();
			const clear = mock.fn(async () => 15_605);
			await buildClearConsulteeAreas({ db: databaseWith(), logger: mockLogger() } as never, files(), clear)({}, res);
			assert.strictEqual(clear.mock.callCount(), 1);
			assert.strictEqual(viewModelOf(res).consulteeAreasCleared, 15_605);
			assert.match(htmlOf(res), /Cleared the consultee areas: deleted 15605/);
		});

		it('says it could not when the delete fails', async () => {
			const res = newRes();
			const clear = mock.fn(async () => {
				throw new Error('deadlock');
			});
			await buildClearConsulteeAreas({ db: databaseWith(), logger: mockLogger() } as never, files(), clear)({}, res);
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
			assert.deepStrictEqual(runImport.mock.calls[0].arguments.slice(1), [
				'/tmp/case-boundaries.geojson',
				{ replace: true }
			]);
			const { error, caseBoundariesImported } = viewModelOf(res);
			assert.strictEqual(error, undefined);
			assert.strictEqual(caseBoundariesImported, 433);
			assert.match(htmlOf(res), /Replaced case boundaries: imported 433/);
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
