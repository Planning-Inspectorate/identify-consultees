import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';
import { INTERACTIVE_MAP_EXAMPLES } from '../../maps/interactive-map-examples.ts';
import {
	buildInteractiveMapExamplePage,
	buildInteractiveMapExamplesIndexPage,
	buildInteractiveMapStaticMap
} from './controller.ts';
import type { InteractiveMapExampleViewModel, InteractiveMapExamplesIndexViewModel } from './view-model.ts';

function mockRequest(
	params: Record<string, string> = {},
	query: Record<string, string> = {},
	headers: Record<string, string> = {}
) {
	return { params, query, headers } as never;
}

function mockResponse() {
	const res = {
		locals: {
			config: {
				vendorDatasetsPluginJs: 'vendor/datasets-plugin/js/index.js',
				vendorDatasetsPluginCss: 'vendor/datasets-plugin/css/index.css',
				vendorMapKeyPluginJs: 'vendor/map-key-plugin/js/index.js',
				vendorMapKeyPluginCss: 'vendor/map-key-plugin/css/index.css',
				vendorInteractPluginJs: 'vendor/interact-plugin/js/index.js',
				vendorDrawPluginJs: 'vendor/draw-plugin/js/index.js',
				vendorMapStylesPluginJs: 'vendor/map-styles-plugin/js/index.js',
				vendorMapStylesPluginCss: 'vendor/map-styles-plugin/css/index.css'
			}
		},
		status: mock.fn(() => res),
		type: mock.fn(() => res),
		set: mock.fn(() => res),
		render: mock.fn(),
		send: mock.fn(),
		end: mock.fn()
	};
	return res;
}

const tinyPng = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64'
);

function stubTileFetch() {
	const calls: string[] = [];
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async (input: unknown) => {
		calls.push(String(input));
		return new Response(tinyPng, { status: 200, headers: { 'content-type': 'image/png' } });
	}) as typeof fetch;
	return {
		calls,
		restore() {
			globalThis.fetch = originalFetch;
		}
	};
}

describe('interactive map examples index page', () => {
	test('lists every registered example with a detail link', async () => {
		const res = mockResponse();
		await buildInteractiveMapExamplesIndexPage()(mockRequest(), res as never);

		assert.equal(res.render.mock.callCount(), 1);
		const [view, model] = res.render.mock.calls[0].arguments as [string, InteractiveMapExamplesIndexViewModel];
		assert.equal(view, 'views/interactive-map-examples/view.njk');
		assert.equal(model.pageHeading, 'Interactive map');
		assert.equal(model.backLinkUrl, '/components');
		assert.equal(model.examples.length, INTERACTIVE_MAP_EXAMPLES.length);

		const basic = model.examples.find((example) => example.id === 'basic');
		assert.equal(basic?.title, 'Basic map');
		assert.equal(basic?.href, '/components/interactive-map/basic');
		assert.equal(basic?.pluginsLabel, 'None');
		assert.ok(model.examples.every((example) => example.summary.length > 0));
	});

	test('links keep ?components=true when the nav flag is on', async () => {
		const res = mockResponse();
		await buildInteractiveMapExamplesIndexPage()(mockRequest({}, { components: 'true' }), res as never);

		const [, model] = res.render.mock.calls[0].arguments as [string, InteractiveMapExamplesIndexViewModel];
		assert.equal(model.backLinkUrl, '/components?components=true');
		assert.ok(model.examples.every((example) => example.href.endsWith('?components=true')));
	});
});

describe('interactive map example page', () => {
	test('renders the basic example with no plugin assets and a static fallback', async () => {
		const res = mockResponse();
		await buildInteractiveMapExamplePage()(mockRequest({ example: 'basic' }), res as never);

		const [view, model] = res.render.mock.calls[0].arguments as [string, InteractiveMapExampleViewModel];
		assert.equal(view, 'views/interactive-map-examples/example.njk');
		assert.equal(model.pageHeading, 'Basic map');
		assert.equal(model.mapId, 'interactive-map-example-basic');
		assert.equal(model.staticMapSrc, '/components/interactive-map/basic/static-map');
		assert.equal(model.staticMapAlt.length > 0, true);
		assert.equal(model.pluginScripts.length, 0);
		assert.equal(model.pluginStylesheets.length, 0);
	});

	test('loads only the plugin assets an example uses', async () => {
		const res = mockResponse();
		await buildInteractiveMapExamplePage()(mockRequest({ example: 'polygons' }), res as never);

		const [, model] = res.render.mock.calls[0].arguments as [string, InteractiveMapExampleViewModel];
		assert.deepEqual(model.pluginScripts, ['vendor/datasets-plugin/js/index.js', 'vendor/map-key-plugin/js/index.js']);
		assert.deepEqual(model.pluginStylesheets, [
			'vendor/datasets-plugin/css/index.css',
			'vendor/map-key-plugin/css/index.css'
		]);

		const config = JSON.parse(model.mapConfigJson);
		assert.equal(config.kind, 'polygons');
		assert.equal(config.mapKey, true);
		assert.equal(config.datasets[0].id, 'field-parcels');
		assert.equal(config.mapStyle.attribution.length > 0, true);
		// fallback details live in the JSON block — data-* attributes would be
		// JSON.parsed by the InteractiveMap constructor and log console errors
		assert.deepEqual(config.fallback, {
			src: '/components/interactive-map/polygons/static-map',
			alt: model.staticMapAlt,
			width: 960,
			height: 516
		});
	});

	test('draw-tools wires interact and draw plugins', async () => {
		const res = mockResponse();
		await buildInteractiveMapExamplePage()(mockRequest({ example: 'draw-tools' }), res as never);

		const [, model] = res.render.mock.calls[0].arguments as [string, InteractiveMapExampleViewModel];
		assert.ok(model.pluginScripts.includes('vendor/interact-plugin/js/index.js'));
		assert.ok(model.pluginScripts.includes('vendor/draw-plugin/js/index.js'));
		assert.ok(!model.pluginScripts.includes('vendor/map-styles-plugin/js/index.js'));
	});

	test('back link keeps ?components=true when the nav flag is on', async () => {
		const res = mockResponse();
		await buildInteractiveMapExamplePage()(mockRequest({ example: 'basic' }, { components: 'true' }), res as never);

		const [, model] = res.render.mock.calls[0].arguments as [string, InteractiveMapExampleViewModel];
		assert.equal(model.backLinkUrl, '/components/interactive-map?components=true');
	});

	test('renders without plugin asset URLs when config locals are absent', async () => {
		const res = mockResponse();
		res.locals = {};
		await buildInteractiveMapExamplePage()(mockRequest({ example: 'polygons' }), res as never);

		const [, model] = res.render.mock.calls[0].arguments as [string, InteractiveMapExampleViewModel];
		assert.deepEqual(model.pluginScripts, []);
		assert.deepEqual(model.pluginStylesheets, []);
	});

	test('404s for an unknown or missing example', async () => {
		const res = mockResponse();
		await buildInteractiveMapExamplePage()(mockRequest({ example: 'not-an-example' }), res as never);

		assert.equal(res.status.mock.calls[0].arguments[0], 404);
		assert.equal(res.render.mock.calls[0].arguments[0], 'views/errors/404.njk');

		const res2 = mockResponse();
		await buildInteractiveMapExamplePage()(mockRequest(), res2 as never);
		assert.equal(res2.status.mock.calls[0].arguments[0], 404);
	});
});

describe('interactive map static fallback', () => {
	test('negotiates AVIF for clients that accept it', async () => {
		const fetchStub = stubTileFetch();
		const res = mockResponse();
		try {
			await buildInteractiveMapStaticMap()(
				mockRequest({ example: 'polygons' }, {}, { accept: 'image/avif,image/webp,*/*' }),
				res as never
			);

			assert.equal(res.status.mock.calls[0].arguments[0], 200);
			assert.match(String(res.type.mock.calls[0].arguments[0]), /image\/avif/);
			const headers = res.set.mock.calls[0].arguments[0];
			assert.match(headers['Cache-Control'], /max-age=/);
			assert.equal(headers.Vary, 'Accept');
			assert.ok(headers.ETag);
			// avif magic: ftyp box
			const body = res.send.mock.calls[0].arguments[0] as Buffer;
			assert.ok(body.subarray(4, 8).toString() === 'ftyp');
			assert.ok(fetchStub.calls.length > 0, 'expected OSM tile fetches');
		} finally {
			fetchStub.restore();
		}
	});

	test('serves PNG to clients without modern image formats', async () => {
		const fetchStub = stubTileFetch();
		const res = mockResponse();
		try {
			await buildInteractiveMapStaticMap()(mockRequest({ example: 'basic' }), res as never);

			assert.match(String(res.type.mock.calls[0].arguments[0]), /image\/png/);
			const body = res.send.mock.calls[0].arguments[0] as Buffer;
			assert.deepEqual([...body.subarray(1, 4)], [...Buffer.from('PNG')]);
		} finally {
			fetchStub.restore();
		}
	});

	test('the .svg route always serves the vector variant', async () => {
		const fetchStub = stubTileFetch();
		const res = mockResponse();
		try {
			await buildInteractiveMapStaticMap(true)(
				mockRequest({ example: 'basic' }, {}, { accept: 'image/avif' }),
				res as never
			);

			assert.match(String(res.type.mock.calls[0].arguments[0]), /image\/svg\+xml/);
			assert.match(String(res.send.mock.calls[0].arguments[0]), /<svg/);
		} finally {
			fetchStub.restore();
		}
	});

	test('matching If-None-Match returns 304 without fetching upstream tiles', async () => {
		const fetchStub = stubTileFetch();
		const res = mockResponse();
		try {
			await buildInteractiveMapStaticMap()(mockRequest({ example: 'basic' }), res as never);
			const etag = res.set.mock.calls[0].arguments[0].ETag;

			fetchStub.calls.length = 0;
			res.status.mock.resetCalls();
			res.end.mock.resetCalls();

			await buildInteractiveMapStaticMap()(
				mockRequest({ example: 'basic' }, {}, { 'if-none-match': etag }),
				res as never
			);

			assert.equal(res.status.mock.calls[0].arguments[0], 304);
			assert.equal(res.end.mock.callCount(), 1);
			assert.equal(fetchStub.calls.length, 0);
		} finally {
			fetchStub.restore();
		}
	});

	test('404s for an unknown or missing example', async () => {
		const res = mockResponse();
		await buildInteractiveMapStaticMap()(mockRequest({ example: 'nope' }), res as never);
		assert.equal(res.status.mock.calls[0].arguments[0], 404);
		assert.equal(res.send.mock.calls[0].arguments[0], 'Not found');

		const res2 = mockResponse();
		await buildInteractiveMapStaticMap()(mockRequest(), res2 as never);
		assert.equal(res2.status.mock.calls[0].arguments[0], 404);
	});
});
