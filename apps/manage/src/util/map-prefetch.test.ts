import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildMapPrefetchAssets } from './map-prefetch.ts';

const assetPaths = {
	vendorInteractiveMapJs: 'vendor/interactive-map/js/index-aaaa1111.js',
	vendorInteractiveMapCss: 'vendor/interactive-map/css/index-bbbb2222.css',
	vendorMaplibreProviderJs: 'vendor/maplibre-provider/js/index-cccc3333.js',
	vendorDatasetsPluginJs: 'vendor/datasets-plugin/js/index-dddd4444.js',
	vendorDatasetsPluginCss: 'vendor/datasets-plugin/css/index-eeee5555.css',
	vendorInteractPluginJs: 'vendor/interact-plugin/js/index-ffff6666.js',
	vendorDrawPluginJs: 'vendor/draw-plugin/js/index-11117777.js',
	vendorMapKeyPluginJs: 'vendor/map-key-plugin/js/index-22228888.js',
	vendorMapKeyPluginCss: 'vendor/map-key-plugin/css/index-33339999.css',
	vendorMapStylesPluginJs: 'vendor/map-styles-plugin/js/index-44440000.js',
	vendorMapStylesPluginCss: 'vendor/map-styles-plugin/css/index-55551111.css',
	consulteesMapJs: 'javascripts/consultees-map-66662222.js'
};

const manifestAssets = {
	'javascripts/consultees-map.js': 'javascripts/consultees-map-66662222.js',
	'javascripts/feature-details-plugin.mjs': 'javascripts/feature-details-plugin-77773333.mjs',
	'javascripts/static-map-plugin.mjs': 'javascripts/static-map-plugin-88884444.mjs',
	'javascripts/sortable-table.js': 'javascripts/sortable-table-99995555.js',
	'style.css': 'style-0000aaaa.css'
};

const vendorRoots = {
	'interactive-map/js': '/node_modules/interactive-map/umd',
	'interactive-map/css': '/node_modules/interactive-map/css',
	'datasets-plugin/js': '/node_modules/datasets/umd',
	'draw-plugin/js': '/node_modules/draw/umd'
};

const vendorFiles = {
	'/node_modules/interactive-map/umd': ['index.js', 'im-core.js', 'im-core.js.LICENSE.txt', 'im-core.js.br'],
	'/node_modules/datasets/umd': [
		'index.js',
		'im-datasets-plugin.js',
		'im-datasets-ml-adapter.js',
		'im-datasets-esri-adapter.js',
		'im-datasets-ol-adapter.js',
		'5300.js'
	],
	'/node_modules/draw/umd': ['im-draw-plugin.js', 'im-draw-ml-adapter.js', 'im-draw-ol-adapter.js']
};

function build(overrides = {}) {
	return buildMapPrefetchAssets({
		assetPaths,
		manifestAssets,
		vendorRoots,
		listVendorFiles: (root) => vendorFiles[root] ?? [],
		...overrides
	});
}

describe('buildMapPrefetchAssets', () => {
	it('primes every map-page entry bundle with the hint type the page requests it as', () => {
		const assets = build();
		assert.deepStrictEqual(
			assets.find(({ href }) => href === `/${assetPaths.vendorInteractiveMapJs}`),
			{ href: `/${assetPaths.vendorInteractiveMapJs}`, as: 'script' }
		);
		assert.deepStrictEqual(
			assets.find(({ href }) => href === `/${assetPaths.vendorInteractiveMapCss}`),
			{ href: `/${assetPaths.vendorInteractiveMapCss}`, as: 'style' }
		);
		assert.deepStrictEqual(
			assets.find(({ href }) => href === `/${assetPaths.consulteesMapJs}`),
			{ href: `/${assetPaths.consulteesMapJs}`, as: 'script' }
		);
	});

	it('skips entry properties missing from the resolved paths', () => {
		const assets = build({ assetPaths: { consulteesMapJs: 'javascripts/consultees-map-66662222.js' } });
		assert.equal(
			assets.some(({ href }) => href === `/${assetPaths.vendorInteractiveMapJs}`),
			false
		);
		assert.equal(
			assets.some(({ href }) => href === '/javascripts/consultees-map-66662222.js'),
			true
		);
	});

	it('primes the map module’s .mjs plugin files from the manifest, not other assets', () => {
		const hrefs = build().map(({ href }) => href);
		assert.ok(hrefs.includes('/javascripts/feature-details-plugin-77773333.mjs'));
		assert.ok(hrefs.includes('/javascripts/static-map-plugin-88884444.mjs'));
		assert.equal(hrefs.includes('/javascripts/sortable-table-99995555.js'), false);
		assert.equal(hrefs.includes('/style-0000aaaa.css'), false);
	});

	it('primes each vendor bundle’s im- chunks as same-origin /vendor URLs', () => {
		const hrefs = build().map(({ href }) => href);
		assert.ok(hrefs.includes('/vendor/interactive-map/js/im-core.js'));
		assert.ok(hrefs.includes('/vendor/datasets-plugin/js/im-datasets-plugin.js'));
		assert.ok(hrefs.includes('/vendor/draw-plugin/js/im-draw-ml-adapter.js'));
	});

	it('leaves the esri/ol provider adapters and on-demand chunks out', () => {
		const hrefs = build().map(({ href }) => href);
		assert.equal(
			hrefs.some((href) => href.includes('-esri-')),
			false
		);
		assert.equal(
			hrefs.some((href) => href.includes('-ol-')),
			false
		);
		assert.equal(
			hrefs.some((href) => href.endsWith('/5300.js')),
			false
		);
		assert.equal(
			hrefs.some((href) => href.endsWith('.LICENSE.txt') || href.endsWith('.br')),
			false
		);
	});

	it('ignores vendor roots that are not a js bundle directory', () => {
		const hrefs = build({
			vendorRoots: { 'interactive-map/css': '/node_modules/interactive-map/css' },
			listVendorFiles: () => ['im-anything.js', 'index.css']
		}).map(({ href }) => href);
		assert.equal(hrefs.includes('/vendor/interactive-map/css/im-anything.js'), false);
	});

	it('survives a vendor root that cannot be listed', () => {
		const assets = build({
			listVendorFiles: () => {
				throw new Error('ENOENT');
			}
		});
		assert.equal(
			assets.some(({ href }) => /\/vendor\/.*\/js\/im-/.test(href)),
			false
		);
		assert.equal(
			assets.some(({ href }) => href === `/${assetPaths.vendorInteractiveMapJs}`),
			true
		);
	});

	it('lists nothing for a vendor root that does not exist on disk', () => {
		const assets = buildMapPrefetchAssets({
			assetPaths,
			vendorRoots: { 'interactive-map/js': '/node_modules/not-a-real-package/umd' }
		});
		assert.equal(
			assets.some(({ href }) => /\/vendor\/.*\/js\/im-/.test(href)),
			false
		);
	});

	it('dedupes an asset listed by more than one source', () => {
		const assets = build({
			manifestAssets: { 'javascripts/feature.mjs': assetPaths.consulteesMapJs }
		});
		assert.equal(assets.filter(({ href }) => href === `/${assetPaths.consulteesMapJs}`).length, 1);
	});
});
