import { mockLogger } from '@planning-inspectorate/core/testing';
import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import type { ScheduledImportDependencies } from './scheduled-import.ts';
import { dueImport, startScheduledCbosImport, ukTime } from './scheduled-import.ts';

const RESULT = { filesFound: 3, imported: 3, casesImported: 2, failures: [] };

describe('scheduled CBOS import', () => {
	it('reads the clock in UK time, in British Summer Time or not', () => {
		assert.deepStrictEqual(ukTime(new Date('2026-07-01T09:05:00Z')), { date: '2026-07-01', hour: 10, minute: 5 });
		assert.deepStrictEqual(ukTime(new Date('2026-12-01T23:30:00Z')), { date: '2026-12-01', hour: 23, minute: 30 });
		assert.deepStrictEqual(ukTime(new Date('2026-06-30T23:30:00Z')), { date: '2026-07-01', hour: 0, minute: 30 });
	});

	it('is due in the first quarter of an import hour only', () => {
		const hours = [7, 10];
		assert.strictEqual(dueImport(hours, new Date('2026-12-01T10:00:00Z')), '2026-12-01 10');
		assert.strictEqual(dueImport(hours, new Date('2026-12-01T07:14:00Z')), '2026-12-01 07');
		assert.strictEqual(dueImport(hours, new Date('2026-12-01T10:15:00Z')), undefined);
		assert.strictEqual(dueImport(hours, new Date('2026-12-01T11:00:00Z')), undefined);
	});

	function start(options: { hours: number[]; runImport?: ScheduledImportDependencies['runImport'] }) {
		let now = new Date('2026-12-01T06:59:00Z');
		let tick: () => void = () => undefined;
		const timer = { unref: mock.fn() };
		const service = {
			db: {},
			logger: mockLogger(),
			pythonFunctionUrl: 'http://localhost:7071/api/consultee-areas',
			pythonFunctionApiKey: 'test-key',
			cbosImportHours: options.hours
		};
		const dependencies = {
			runImport: mock.fn(options.runImport ?? (async () => RESULT)),
			now: () => now,
			setInterval: mock.fn((callback: () => void) => {
				tick = callback;
				return timer;
			}),
			clearInterval: mock.fn()
		};
		const stop = startScheduledCbosImport(service as never, dependencies as never);
		const at = async (iso: string) => {
			now = new Date(iso);
			tick();
			// let the import's promise settle
			await new Promise((resolve) => setImmediate(resolve));
		};
		return { stop, service, dependencies, timer, at };
	}

	it('reads the real clock every minute by default', (t) => {
		t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: new Date('2026-12-01T12:30:00Z') });
		const service = { db: {}, logger: mockLogger(), cbosImportHours: [7], pythonFunctionUrl: undefined };
		const stop = startScheduledCbosImport(service as never);
		// 12:31 isn't an import hour, so nothing is imported
		t.mock.timers.tick(60_000);
		stop!();
		assert.strictEqual(service.logger.error.mock.callCount(), 0);
	});

	it('is off with no hours', () => {
		const { stop, dependencies } = start({ hours: [] });
		assert.strictEqual(stop, undefined);
		assert.strictEqual(dependencies.setInterval.mock.callCount(), 0);
	});

	it('imports once in each import hour, through the function', async () => {
		const { stop, service, dependencies, timer, at } = start({ hours: [7, 10] });
		assert.strictEqual(timer.unref.mock.callCount(), 1);

		await at('2026-12-01T06:59:00Z');
		assert.strictEqual(dependencies.runImport.mock.callCount(), 0);
		await at('2026-12-01T07:00:00Z');
		await at('2026-12-01T07:01:00Z');
		assert.strictEqual(dependencies.runImport.mock.callCount(), 1);
		assert.deepStrictEqual(dependencies.runImport.mock.calls[0].arguments[1], {
			pythonFunctionUrl: 'http://localhost:7071/api/consultee-areas',
			apiKey: 'test-key'
		});
		await at('2026-12-01T10:00:00Z');
		assert.strictEqual(dependencies.runImport.mock.callCount(), 2);
		assert.strictEqual(service.logger.warn.mock.callCount(), 0);

		stop!();
		assert.strictEqual(dependencies.clearInterval.mock.calls[0].arguments[0], timer);
	});

	it("doesn't start an import while the last is still running", async () => {
		let finish: () => void = () => undefined;
		const runImport = async () => {
			await new Promise<void>((resolve) => (finish = resolve));
			return RESULT;
		};
		const { dependencies, at } = start({ hours: [7, 8], runImport });

		await at('2026-12-01T07:00:00Z');
		await at('2026-12-01T08:00:00Z');
		assert.strictEqual(dependencies.runImport.mock.callCount(), 1);
		finish();
		await new Promise((resolve) => setImmediate(resolve));
		// the hour's import starts late, once the last has finished
		await at('2026-12-01T08:01:00Z');
		assert.strictEqual(dependencies.runImport.mock.callCount(), 2);
	});

	it('logs files it could not import, and a failed import, and tries again next hour', async () => {
		const failures = [{ caseReference: 'EN010001', fileName: 'broken.geojson', reason: 'status 500' }];
		let fail = false;
		const runImport = async () => {
			if (fail) throw new Error('CBOS unreachable');
			return { ...RESULT, failures };
		};
		const { service, dependencies, at } = start({ hours: [7, 10], runImport });

		await at('2026-12-01T07:00:00Z');
		assert.deepStrictEqual(service.logger.warn.mock.calls[0].arguments[0], { failures });
		fail = true;
		await at('2026-12-01T10:00:00Z');
		assert.strictEqual(service.logger.error.mock.callCount(), 1);
		assert.strictEqual(dependencies.runImport.mock.callCount(), 2);
	});
});
