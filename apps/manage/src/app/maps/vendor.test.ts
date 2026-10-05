import { DEFRA_VENDOR_ROOTS } from '#util/vendor-assets.ts';
import express from 'express';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, stat, utimes, writeFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { brotliDecompressSync } from 'node:zlib';
import request from 'supertest';
import {
	clearVendorBrotliCacheForTests,
	createDefraVendorRouter,
	createVendorBrotliHandler,
	maxAgeToSeconds
} from './vendor.ts';

const VENDOR_CSS = '/vendor/interactive-map/css/index.css';
const VENDOR_JS = '/vendor/map-key-plugin/js/index.js';
const LICENSE_TXT = '/vendor/map-key-plugin/js/index.js.LICENSE.txt';

describe('defra vendor router', () => {
	test('serves vendor files with the configured cache lifetime and validators', async () => {
		const app = express();
		app.use(createDefraVendorRouter({ maxAge: '1d' }));

		const response = await request(app).get(VENDOR_CSS);
		assert.equal(response.status, 200);
		assert.match(response.headers['content-type'] || '', /text\/css/);
		assert.match(response.headers['cache-control'] || '', /max-age=86400/);
		// express.static emits validators so stale copies revalidate with 304s
		assert.ok(response.headers.etag);
		assert.ok(response.headers['last-modified']);
		// compressible files must advertise the br variant even when served plain
		assert.match(response.headers.vary || '', /Accept-Encoding/i);

		const revalidated = await request(app).get(VENDOR_CSS).set('If-None-Match', response.headers.etag);
		assert.equal(revalidated.status, 304);
	});

	test('defaults to revalidation (max-age=0) when no lifetime is configured', async () => {
		const app = express();
		app.use(createDefraVendorRouter());

		const response = await request(app).get(VENDOR_JS);
		assert.equal(response.status, 200);
		assert.match(response.headers['cache-control'] || '', /max-age=0/);
	});

	test('serves a Brotli variant to clients that accept br', async () => {
		const app = express();
		app.use(createDefraVendorRouter({ maxAge: '1d' }));

		const response = await request(app).get(VENDOR_CSS).set('Accept-Encoding', 'br, gzip');
		assert.equal(response.status, 200);
		assert.equal(response.headers['content-encoding'], 'br');
		assert.match(response.headers['content-type'] || '', /text\/css/);
		assert.match(response.headers['cache-control'] || '', /max-age=86400/);
		assert.match(response.headers.vary || '', /Accept-Encoding/i);
		assert.ok(response.headers.etag);
	});

	test('Brotli bytes decompress to the original file (raw HTTP)', async () => {
		const app = express();
		app.use(createDefraVendorRouter({ maxAge: '1d' }));
		const server = app.listen(0);
		await new Promise((resolve) => server.once('listening', resolve));
		try {
			const port = (server.address() as AddressInfo).port;
			const raw = await new Promise<Buffer>((resolve, reject) => {
				http.get({ port, path: VENDOR_CSS, headers: { 'Accept-Encoding': 'br' } }, (res) => {
					const chunks: Buffer[] = [];
					res.on('data', (chunk) => chunks.push(chunk));
					res.on('end', () => resolve(Buffer.concat(chunks)));
					res.on('error', reject);
				});
			});
			const root = DEFRA_VENDOR_ROOTS['interactive-map/css'];
			const original = await readFile(`${root}/index.css`);
			assert.deepEqual(brotliDecompressSync(raw), original);
		} finally {
			server.close();
		}
	});

	test('Brotli variant revalidates with its own ETag (304)', async () => {
		const app = express();
		app.use(createDefraVendorRouter({ maxAge: '1d' }));

		const first = await request(app).get(VENDOR_CSS).set('Accept-Encoding', 'br');
		const second = await request(app)
			.get(VENDOR_CSS)
			.set('Accept-Encoding', 'br')
			.set('If-None-Match', first.headers.etag);
		assert.equal(second.status, 304);
	});

	test('HEAD returns the Brotli headers without a body', async () => {
		const app = express();
		app.use(createDefraVendorRouter({ maxAge: '1d' }));

		const response = await request(app).head(VENDOR_CSS).set('Accept-Encoding', 'br');
		assert.equal(response.status, 200);
		assert.equal(response.headers['content-encoding'], 'br');
		assert.ok(Number(response.headers['content-length']) > 0);
	});

	test('memoises the compressed variant across requests', async () => {
		const app = express();
		app.use(createDefraVendorRouter({ maxAge: '1d' }));

		const first = await request(app).get(VENDOR_CSS).set('Accept-Encoding', 'br');
		const second = await request(app).get(VENDOR_CSS).set('Accept-Encoding', 'br');
		assert.equal(first.headers.etag, second.headers.etag);
		assert.equal(first.headers['content-length'], second.headers['content-length']);
	});

	test('files below the Brotli size floor fall through to the plain variant', async () => {
		const license = `${DEFRA_VENDOR_ROOTS['map-key-plugin/js']}/index.js.LICENSE.txt`;
		const stats = await stat(license);
		assert.ok(stats.size < 1024, 'expected the LICENSE sidecar to be below the size floor');

		const app = express();
		app.use(createDefraVendorRouter({ maxAge: '1d' }));

		const response = await request(app).get(LICENSE_TXT).set('Accept-Encoding', 'br');
		assert.equal(response.status, 200);
		assert.equal(response.headers['content-encoding'], undefined);
	});

	test('missing files still 404 through the express.static mount', async () => {
		const app = express();
		app.use(createDefraVendorRouter({ maxAge: '1d' }));

		const compressible = await request(app)
			.get('/vendor/map-key-plugin/js/nonexistent.js')
			.set('Accept-Encoding', 'br');
		assert.equal(compressible.status, 404);

		const binary = await request(app).get('/vendor/map-key-plugin/js/nonexistent.bin').set('Accept-Encoding', 'br');
		assert.equal(binary.status, 404);
	});
});

describe('vendor brotli handler (direct)', () => {
	function invoke(
		handler: ReturnType<typeof createVendorBrotliHandler>,
		{
			method = 'GET',
			path: reqPath = '/x.js',
			headers = {}
		}: { method?: string; path?: string; headers?: Record<string, string> } = {}
	) {
		const req = { method, path: reqPath, get: (name: string) => headers[name.toLowerCase()] };
		const headersSet: Record<string, string | number> = {};
		let ended = false;
		const res = {
			setHeader: (name: string, value: string | number) => {
				headersSet[name.toLowerCase()] = value;
			},
			status: () => res,
			end: (body?: Buffer) => {
				ended = true;
				res.body = body;
			},
			body: undefined as Buffer | undefined
		};
		let fellThrough = false;
		return handler(req as never, res as never, () => {
			fellThrough = true;
		}).then(() => ({ headersSet, ended, body: res.body, fellThrough }));
	}

	test('passes through non-GET methods, unsafe paths and non-compressible files', async () => {
		const root = await mkdtemp(path.join(tmpdir(), 'vendor-br-'));
		await writeFile(path.join(root, 'data.bin'), Buffer.alloc(4096, 1));
		const handler = createVendorBrotliHandler(root, '1d');
		const brHeaders = { 'accept-encoding': 'br' };

		const post = await invoke(handler, { method: 'POST', headers: brHeaders });
		assert.equal(post.fellThrough, true);

		const traversal = await invoke(handler, { path: '/..%2f..%2fetc', headers: brHeaders });
		assert.equal(traversal.fellThrough, true);

		const binary = await invoke(handler, { path: '/data.bin', headers: brHeaders });
		assert.equal(binary.fellThrough, true);
	});

	test('passes through misses, directories and small files', async () => {
		const root = await mkdtemp(path.join(tmpdir(), 'vendor-br-'));
		await mkdir(path.join(root, 'adir.js'));
		await writeFile(path.join(root, 'tiny.js'), 'x=1');
		const handler = createVendorBrotliHandler(root, '1d');
		const brHeaders = { 'accept-encoding': 'br' };

		const missing = await invoke(handler, { path: '/missing.js', headers: brHeaders });
		assert.equal(missing.fellThrough, true);

		const directory = await invoke(handler, { path: '/adir.js', headers: brHeaders });
		assert.equal(directory.fellThrough, true);

		const small = await invoke(handler, { path: '/tiny.js', headers: brHeaders });
		assert.equal(small.fellThrough, true);
	});

	test('passes through when the client does not accept br', async () => {
		const root = await mkdtemp(path.join(tmpdir(), 'vendor-br-'));
		await writeFile(path.join(root, 'big.js'), Buffer.alloc(4096, 1));
		const handler = createVendorBrotliHandler(root, '1d');

		const result = await invoke(handler, { path: '/big.js', headers: { 'accept-encoding': 'gzip' } });
		assert.equal(result.fellThrough, true);
		assert.equal(result.headersSet.vary, 'Accept-Encoding');

		const noEncodingHeader = await invoke(handler, { path: '/big.js' });
		assert.equal(noEncodingHeader.fellThrough, true);
	});

	test('falls through when compression fails', async () => {
		clearVendorBrotliCacheForTests();
		const root = await mkdtemp(path.join(tmpdir(), 'vendor-br-'));
		await writeFile(path.join(root, 'big.js'), Buffer.alloc(4096, 1));
		const handler = createVendorBrotliHandler(root, '1d', {
			compress: () => Promise.reject(new Error('compress boom'))
		});

		const result = await invoke(handler, { path: '/big.js', headers: { 'accept-encoding': 'br' } });
		assert.equal(result.fellThrough, true);
		assert.equal(result.ended, false);
	});

	test('recompresses when the file changes (mtime-based cache key)', async () => {
		clearVendorBrotliCacheForTests();
		const root = await mkdtemp(path.join(tmpdir(), 'vendor-br-'));
		const file = path.join(root, 'big.js');
		await writeFile(file, Buffer.alloc(4096, 1));
		const handler = createVendorBrotliHandler(root, '1d');
		const brHeaders = { 'accept-encoding': 'br' };

		const first = await invoke(handler, { path: '/big.js', headers: brHeaders });
		assert.equal(first.ended, true);
		assert.equal(first.headersSet['content-encoding'], 'br');

		await writeFile(file, Buffer.alloc(4096, 2));
		// move mtime forward so the variant key changes even at coarse fs resolution
		const future = new Date(Date.now() + 60_000);
		await utimes(file, future, future);

		const second = await invoke(handler, { path: '/big.js', headers: brHeaders });
		assert.equal(second.ended, true);
		assert.equal(second.headersSet['content-encoding'], 'br');
		assert.notEqual(first.headersSet.etag, second.headersSet.etag);
	});
});

describe('maxAgeToSeconds', () => {
	test('parses ms-style strings and numbers', () => {
		assert.equal(maxAgeToSeconds('1d'), 86400);
		assert.equal(maxAgeToSeconds('12h'), 43200);
		assert.equal(maxAgeToSeconds('30m'), 1800);
		assert.equal(maxAgeToSeconds('45s'), 45);
		assert.equal(maxAgeToSeconds('500ms'), 0);
		assert.equal(maxAgeToSeconds('3600'), 3);
		assert.equal(maxAgeToSeconds(3_600_000), 3600);
		assert.equal(maxAgeToSeconds(undefined), 0);
		assert.equal(maxAgeToSeconds('not-a-duration'), 0);
		assert.equal(maxAgeToSeconds(''), 0);
		assert.equal(maxAgeToSeconds(-5000), 0);
	});
});
