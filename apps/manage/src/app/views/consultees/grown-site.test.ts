import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import { grownSite } from './grown-site.ts';

const SITE = { type: 'Point' as const, coordinates: [-1.5, 52.5] };
const GROWN = 'POLYGON((-1.6 52.4, -1.4 52.4, -1.4 52.6, -1.6 52.6, -1.6 52.4))';

function db(...replies: (string | Error)[]) {
	return {
		$queryRaw: mock.fn(async () => {
			const reply = replies.shift() ?? GROWN;
			if (reply instanceof Error) {
				throw reply;
			}
			return [{ wkt: reply }];
		})
	};
}

describe('grownSite', () => {
	it('grows a site by a distance once, then serves it again from memory', async () => {
		const client = db();
		const first = await grownSite(client as never, SITE, 20_000);
		const again = await grownSite(client as never, { ...SITE, coordinates: [-1.5, 52.5] }, 20_000);
		assert.deepStrictEqual(again, first);
		assert.strictEqual(client.$queryRaw.mock.callCount(), 1);
	});

	it('grows it afresh for another distance, or another site under the same id', async () => {
		const client = db();
		await grownSite(client as never, SITE, 500);
		await grownSite(client as never, SITE, 2_000);
		await grownSite(client as never, { ...SITE, coordinates: [-1.4, 52.5] }, 500);
		assert.strictEqual(client.$queryRaw.mock.callCount(), 3);
	});

	it("doesn't keep a failure - the next request tries again", async () => {
		const client = db(new Error('Timeout'));
		await assert.rejects(grownSite(client as never, SITE, 5_000), /Timeout/);
		await grownSite(client as never, SITE, 5_000);
		assert.strictEqual(client.$queryRaw.mock.callCount(), 2);
	});

	it("keeps each database client's apart", async () => {
		const one = db();
		const other = db();
		await grownSite(one as never, SITE, 10_000);
		await grownSite(other as never, SITE, 10_000);
		assert.strictEqual(one.$queryRaw.mock.callCount(), 1);
		assert.strictEqual(other.$queryRaw.mock.callCount(), 1);
	});
});
