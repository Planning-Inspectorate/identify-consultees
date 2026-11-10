import express from 'express';
import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import request from 'supertest';
import {
	createOsMapRoutes,
	fetchOsTile,
	interactiveBasemap,
	OS_BOUNDS,
	osCoversView,
	osCredit,
	osMapsApiKeyFromEnv,
	osStyle
} from './os-maps.ts';

const KEY = 'test-os-key';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const LONDON: [number, number] = [-0.1276, 51.5072];
const LONDON_VIEW = { center: LONDON, zoom: 12, width: 960, height: 516 };

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

describe('osMapsApiKeyFromEnv', () => {
	test('reads a real key, trimmed', () => {
		assert.equal(osMapsApiKeyFromEnv({ OS_MAPS_API_KEY: ` ${KEY} ` }), KEY);
	});

	test("has none while it's unset, blank, Terraform's placeholder or an unresolved Key Vault reference", () => {
		for (const value of [
			undefined,
			' ',
			'<terraform_placeholder>',
			'@Microsoft.KeyVault(SecretUri=https://vault/secrets/os)'
		]) {
			assert.equal(osMapsApiKeyFromEnv({ OS_MAPS_API_KEY: value }), undefined, String(value));
		}
	});
});

describe('osCredit', () => {
	test("credits OS's Crown copyright for the year, with PINS's licence number once it's set", () => {
		assert.equal(osCredit({}, 2026), '© Crown copyright and database rights 2026 OS');
		assert.equal(
			osCredit({ OS_LICENCE_NUMBER: ' AC0000000000 ' }, 2026),
			'© Crown copyright and database rights 2026 OS AC0000000000'
		);
		assert.match(osCredit({}), new RegExp(`rights ${new Date().getFullYear()} OS$`));
	});
});

describe('osCoversView', () => {
	const view = (center: [number, number], zoom: number) => ({ center, zoom, width: 960, height: 516 });

	test("covers a map wholly inside Great Britain's extent, at OS's zooms, 7 to 20", () => {
		// zoomed out to 7 a map is 10° wide: one centred on the Isle of Man fits, London's reaches the sea
		assert.equal(osCoversView(view([-4.5, 54.2], 7)), true);
		assert.equal(osCoversView(view(LONDON, 7)), false);
		assert.equal(osCoversView(view(LONDON, 9)), true);
		assert.equal(osCoversView(view(LONDON, 20)), true);
		assert.equal(osCoversView(view(LONDON, 6)), false);
		assert.equal(osCoversView(view(LONDON, 21)), false);
	});

	test('not a map reaching past it - an offshore site in the North Sea, or abroad', () => {
		// East Anglia ONE, off Suffolk: past OS's 1.9°E
		assert.equal(osCoversView(view([2.1, 52.2], 10)), false);
		// near the edge, the view decides: inland it fits, at the coast it doesn't
		assert.equal(osCoversView(view([1.5, 52.6], 12)), true);
		assert.equal(osCoversView(view([1.85, 52.6], 12)), false);
		for (const center of [
			[2.35, 48.86],
			[-11, 53],
			[0, 62],
			[0, 49]
		] as [number, number][]) {
			assert.equal(osCoversView(view(center, 10)), false, String(center));
		}
	});
});

describe('fetchOsTile', () => {
	test("fetches Light_3857's tile with the key in a header, not the URL", async () => {
		const calls: { url: string; headers: Record<string, string> }[] = [];
		globalThis.fetch = async (url, init) => {
			calls.push({ url: String(url), headers: init?.headers as Record<string, string> });
			return new Response(PNG, { status: 200 });
		};

		assert.deepEqual(await fetchOsTile(KEY, 14, 8186, 5448), PNG);
		assert.equal(calls[0].url, 'https://api.os.uk/maps/raster/v1/zxy/Light_3857/14/8186/5448.png');
		assert.equal(calls[0].headers.key, KEY);
	});

	test('has nothing for a tile OS refuses, or when OS is unreachable', async () => {
		globalThis.fetch = async () => new Response('no', { status: 400 });
		assert.equal(await fetchOsTile(KEY, 14, 0, 0), undefined);
		globalThis.fetch = async () => {
			throw new Error('offline');
		};
		assert.equal(await fetchOsTile(KEY, 14, 0, 0), undefined);
	});
});

describe('interactiveBasemap', () => {
	test("is OS's Light style, through the app, with the zooms and area OS covers", () => {
		assert.deepEqual(interactiveBasemap(LONDON_VIEW, { OS_MAPS_API_KEY: KEY, OS_LICENCE_NUMBER: 'AC0000000000' }), {
			interactiveBasemap: {
				url: '/maps/os/style.json',
				attribution: osCredit({ OS_LICENCE_NUMBER: 'AC0000000000' }),
				backgroundColor: '#f5f5f5',
				minZoom: 6,
				maxZoom: 19,
				maxExtent: OS_BOUNDS
			}
		});
	});

	test("is nothing without a key, or for a map OS doesn't cover, so it keeps OpenFreeMap", () => {
		assert.deepEqual(interactiveBasemap(LONDON_VIEW, {}), {});
		assert.deepEqual(interactiveBasemap({ ...LONDON_VIEW, center: [2.1, 52.2] }, { OS_MAPS_API_KEY: KEY }), {});
	});

	test('reads the key from the environment by default', () => {
		const original = process.env.OS_MAPS_API_KEY;
		delete process.env.OS_MAPS_API_KEY;
		try {
			assert.deepEqual(interactiveBasemap(LONDON_VIEW), {});
		} finally {
			if (original !== undefined) process.env.OS_MAPS_API_KEY = original;
		}
	});
});

describe('createOsMapRoutes', () => {
	function appWith(fetchTile: Parameters<typeof createOsMapRoutes>[1]) {
		const app = express();
		app.use('/maps/os', createOsMapRoutes(KEY, fetchTile));
		return app;
	}

	test("serves the style, its one source OS's tiles through the app", async () => {
		const response = await request(appWith(async () => PNG)).get('/maps/os/style.json');
		assert.equal(response.status, 200);
		assert.deepEqual(response.body, JSON.parse(JSON.stringify(osStyle())));
		assert.deepEqual(response.body.sources.os.tiles, ['/maps/os/tiles/{z}/{x}/{y}.png']);
		assert.equal(response.headers['cache-control'], 'private, max-age=3600');
	});

	test('serves a tile from OS with its key, for the browser to keep a day', async () => {
		const asked: unknown[] = [];
		const response = await request(
			appWith(async (...args) => {
				asked.push(args);
				return PNG;
			})
		).get('/maps/os/tiles/14/8186/5448.png');
		assert.equal(response.status, 200);
		assert.equal(response.headers['content-type'], 'image/png');
		assert.equal(response.headers['cache-control'], 'private, max-age=86400');
		assert.deepEqual(response.body, PNG);
		assert.deepEqual(asked, [[KEY, 14, 8186, 5448]]);
	});

	test("refuses a tile OS doesn't have, without asking it", async () => {
		let asked = 0;
		const app = appWith(async () => {
			asked++;
			return PNG;
		});
		for (const path of ['6/31/21', '21/0/0', '7/128/0', '7/0/128', 'x/0/0', '7/-1/0', '7/0/1.5']) {
			assert.equal((await request(app).get(`/maps/os/tiles/${path}.png`)).status, 404, path);
		}
		assert.equal(asked, 0);
	});

	test("is a 502 when OS can't send the tile", async () => {
		const response = await request(appWith(async () => undefined)).get('/maps/os/tiles/14/8186/5448.png');
		assert.equal(response.status, 502);
	});
});
