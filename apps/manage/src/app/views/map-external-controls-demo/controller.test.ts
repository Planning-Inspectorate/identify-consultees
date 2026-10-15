import assert from 'node:assert/strict';
import { afterEach, describe, mock, test } from 'node:test';
import { clearOsmTileCacheForTests } from '../../maps/static-map.ts';
import {
	buildDemoStaticMap,
	buildMapExternalControlsDemoPage,
	buildMapExternalControlsDemoSubmit
} from './controller.ts';
import type { MapExternalControlsDemoViewModel } from './view-model.ts';

const tinyPng = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64'
);

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

async function renderedModel(
	handler: (req: never, res: never) => Promise<void>,
	req: { query?: unknown; body?: unknown } = {}
) {
	const mockRes = { render: mock.fn() };
	await handler(req as never, mockRes as never);
	assert.equal(mockRes.render.mock.callCount(), 1);
	const [view, model] = mockRes.render.mock.calls[0].arguments as [string, MapExternalControlsDemoViewModel];
	assert.equal(view, 'views/map-external-controls-demo/view.njk');
	return model;
}

describe('map external controls demo page', () => {
	test('renders one section with its own externalControls config, plus the mode switcher', async () => {
		const model = await renderedModel(buildMapExternalControlsDemoPage());
		// no ?mode= falls back to the first configuration
		assert.equal(model.section.slug, 'select-shared');

		// the switcher lists every configuration, marking the rendered one current
		assert.deepEqual(
			model.modes.map((mode) => [mode.slug, mode.current]),
			[
				['select-shared', true],
				['solo-external', false],
				['dim-zoom', false]
			]
		);
		for (const mode of model.modes) {
			assert.equal(mode.href, `/map-external-controls-demo?mode=${mode.slug}`);
		}

		const { section } = model;
		const mapConfig = JSON.parse(section.mapConfigJson);
		// the section gets the same three fictional files as shapefile datasets...
		assert.equal(mapConfig.shapefileDatasets.length, 3);
		// ...and an externalControls block whose control selector is scoped to its own form
		assert.equal(mapConfig.externalControls.control, `#${section.formId} input[name="shapefile"]`);
		assert.equal(mapConfig.externalControls.bindings.length, 3);
		// the details panel shows exactly what the plugin received
		assert.deepEqual(JSON.parse(section.configSnippet), mapConfig.externalControls);
		// each binding links radio value -> fileKey -> dataset id on the shared convention
		for (const binding of mapConfig.externalControls.bindings) {
			assert.equal(binding.value, binding.featureId);
			assert.equal(binding.idProperty, 'fileKey');
			assert.equal(binding.datasetId, `shapefile-${binding.value}`);
			assert.equal(
				mapConfig.shapefileDatasets.some((dataset: { id: string }) => dataset.id === binding.datasetId),
				true
			);
		}
		assert.equal(mapConfig.detailsPanelId, `details-${section.slug}`);
		// the radios are ordinary govukRadios items, one per file
		assert.equal(section.radioItems.length, 3);

		// the default demo pre-checks the third radio - on load the plugin replays it to the map
		const checked = section.radioItems.filter((item) => item.checked);
		assert.equal(checked.length, 1);
		assert.equal(checked[0].value, 'demo-earlier-boundary');

		// the oldest fictional file has no recorded date, so its radio carries no Uploaded hint
		const hinted = section.radioItems.map((item) => item.hint?.text);
		assert.equal(hinted.filter(Boolean).length, 2);
	});

	test('?mode= selects the configuration; an unrecognised mode falls back to the default', async () => {
		for (const [mode, emphasis, primaryControl] of [
			['solo-external', 'solo', 'external'],
			['dim-zoom', 'dim', 'shared']
		]) {
			const model = await renderedModel(buildMapExternalControlsDemoPage(), { query: { mode } });
			assert.equal(model.section.slug, mode);
			const controls = JSON.parse(model.section.configSnippet);
			assert.equal(controls.emphasis, emphasis);
			assert.equal(controls.primaryControl, primaryControl);
			assert.equal(model.modes.find((candidate) => candidate.current)?.slug, mode);
			// only the default section pre-checks a radio
			assert.ok(model.section.radioItems.every((item) => !item.checked));
		}
		// dim mode zooms to the pick
		const dim = await renderedModel(buildMapExternalControlsDemoPage(), { query: { mode: 'dim-zoom' } });
		assert.equal(JSON.parse(dim.section.configSnippet).zoomTo, 'always');

		const fallback = await renderedModel(buildMapExternalControlsDemoPage(), { query: { mode: 'nope' } });
		assert.equal(fallback.section.slug, 'select-shared');
	});

	test('a posted pick re-renders that mode with a banner and the submitted radio checked', async () => {
		const model = await renderedModel(buildMapExternalControlsDemoSubmit(), {
			body: { demo: 'solo-external', shapefile: 'demo-red-line-boundary' }
		});
		assert.equal(model.section.slug, 'solo-external');
		assert.match(model.submittedBanner ?? '', /demo-red-line|rlb_270226/);
		assert.match(model.submittedBanner ?? '', /Solo emphasis/);
		assert.equal(model.section.submittedValue, 'demo-red-line-boundary');
		assert.equal(model.section.radioItems.find((item) => item.checked)?.value, 'demo-red-line-boundary');
		assert.equal(model.errorSummary, undefined);
	});

	test('an unanswered post mirrors the boundary page error on that mode', async () => {
		const model = await renderedModel(buildMapExternalControlsDemoSubmit(), { body: { demo: 'dim-zoom' } });
		assert.equal(model.section.slug, 'dim-zoom');
		assert.deepEqual(model.section.radiosError, { text: 'Select a shapefile' });
		assert.deepEqual(model.errorSummary, [{ text: 'Select a shapefile', href: '#shapefile-dim-zoom' }]);
		assert.equal(model.submittedBanner, undefined);
		// nothing is checked when a post arrives but no file was chosen
		assert.ok(model.section.radioItems.every((item) => !item.checked));
	});

	test('an unrecognised file value mirrors the boundary page error on that mode', async () => {
		const model = await renderedModel(buildMapExternalControlsDemoSubmit(), {
			body: { demo: 'select-shared', shapefile: 'not-a-file' }
		});
		assert.equal(model.submittedBanner, undefined);
		assert.deepEqual(model.errorSummary, [{ text: 'Select a shapefile', href: '#shapefile-select-shared' }]);
		assert.deepEqual(model.section.radiosError, { text: 'Select a shapefile' });
	});

	test('an unrecognised section slug or an empty body renders cleanly', async () => {
		for (const body of [{ demo: 'nope', shapefile: 'demo-cable-corridor' }, {}]) {
			const model = await renderedModel(buildMapExternalControlsDemoSubmit(), { body });
			assert.equal(model.submittedBanner, undefined);
			assert.equal(model.errorSummary, undefined);
			assert.equal(model.section.radiosError, undefined);
		}
	});
});

describe('demo static map', () => {
	function mockRes() {
		const res = {
			status: mock.fn(() => res),
			type: mock.fn(() => res),
			set: mock.fn(() => res),
			send: mock.fn(),
			end: mock.fn()
		};
		return res;
	}

	test('serves the fictional files as an SVG when forced, honouring request headers', async () => {
		clearOsmTileCacheForTests();
		globalThis.fetch = async () => new Response(null, { status: 503 });
		const res = mockRes();
		const handler = buildDemoStaticMap(true);
		await handler({ query: {}, headers: { 'if-none-match': '"stale"', accept: 'image/png' } } as never, res as never);
		// and a second call with no conditional headers
		await handler({ query: {}, headers: {} } as never, res as never);
		assert.equal(res.status.mock.calls[0].arguments[0], 200);
		assert.match(String(res.type.mock.calls[0].arguments[0]), /image\/svg\+xml/);
		assert.match(String(res.send.mock.calls[0].arguments[0]), /<svg/);
	});

	test('serves a raster from the shared pipeline by default', async () => {
		clearOsmTileCacheForTests();
		globalThis.fetch = async () => new Response(tinyPng, { status: 200, headers: { 'content-type': 'image/png' } });
		const res = mockRes();
		await buildDemoStaticMap()({ query: {}, headers: { accept: 'image/png' } } as never, res as never);
		assert.equal(res.status.mock.calls[0].arguments[0], 200);
		assert.match(String(res.type.mock.calls[0].arguments[0]), /image\/(png|webp|avif)/);
	});
});
