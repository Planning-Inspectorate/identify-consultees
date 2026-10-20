import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';
import { ATTEMPTS, enhanceUploadForm, initBlobUpload, PARALLEL_PARTS, uploadInParts } from './blob-upload.js';

const FORM = `
	<form method="post" action="/admin/upload-to-blob/run" data-chunked-upload data-chunk-bytes="4"
		data-max-upload-bytes="20" data-csrf-token="token-1">
		<input type="file" id="file" name="file">
		<p role="status" data-upload-status></p>
		<button>Upload</button>
	</form>`;

function documentWith(body = FORM) {
	return new JSDOM(`<!DOCTYPE html><html><body>${body}</body></html>`).window.document;
}

/** A file of `text`, as the browser's File: a name, a size and slice(). */
function fileOf(text, name = 'data.geojson') {
	return new File([text], name);
}

/** fetch answering each request with `answer(url, init)`, or 204 - and the requests it got. */
function fakeFetch(answer = () => new Response(null, { status: 204 })) {
	return mock.fn(async (url, init) => {
		if (url === '/admin/upload-to-blob/commit') {
			const { name } = JSON.parse(init.body);
			return answer(url, init) ?? Response.json({ uploadedBlobName: name });
		}
		return answer(url, init) ?? new Response(null, { status: 204 });
	});
}

const partsOf = (fetch) =>
	fetch.mock.calls.filter((call) => call.arguments[0].startsWith('/admin/upload-to-blob/blocks'));

describe('uploadInParts', () => {
	test('sends the file a part at a time with the CSRF token, then commits the parts in order', async () => {
		const fetch = fakeFetch(() => undefined);
		const progress = [];
		const name = await uploadInParts(fileOf('0123456789'), {
			chunkBytes: 4,
			csrfToken: 'token-1',
			fetch,
			onProgress: (sent, total) => progress.push([sent, total])
		});

		assert.equal(name, 'data.geojson');
		const parts = partsOf(fetch);
		assert.deepEqual(parts.map((call) => call.arguments[0]).sort(), [
			'/admin/upload-to-blob/blocks?name=data.geojson&block=0',
			'/admin/upload-to-blob/blocks?name=data.geojson&block=1',
			'/admin/upload-to-blob/blocks?name=data.geojson&block=2'
		]);
		const [, init] = parts[0].arguments;
		assert.equal(init.method, 'POST');
		assert.deepEqual(init.headers, { 'content-type': 'application/octet-stream', 'x-csrf-token': 'token-1' });
		assert.deepEqual(await Promise.all(parts.map((call) => call.arguments[1].body.text())), ['0123', '4567', '89']);
		const commit = fetch.mock.calls.at(-1).arguments;
		assert.equal(commit[0], '/admin/upload-to-blob/commit');
		assert.deepEqual(JSON.parse(commit[1].body), { name: 'data.geojson', blocks: 3 });
		assert.equal(commit[1].headers['x-csrf-token'], 'token-1');
		assert.deepEqual(progress, [
			[0, 3],
			[1, 3],
			[2, 3],
			[3, 3]
		]);
	});

	test(`keeps at most ${PARALLEL_PARTS} parts in flight`, async () => {
		let inFlight = 0;
		let most = 0;
		const fetch = mock.fn(async (url, init) => {
			if (url.endsWith('commit')) {
				return Response.json({ uploadedBlobName: JSON.parse(init.body).name });
			}
			most = Math.max(most, ++inFlight);
			await new Promise((resolve) => setTimeout(resolve, 1));
			inFlight--;
			return new Response(null, { status: 204 });
		});
		await uploadInParts(fileOf('x'.repeat(40)), { chunkBytes: 4, csrfToken: '', fetch });
		assert.equal(partsOf(fetch).length, 10);
		assert.equal(most, PARALLEL_PARTS);
	});

	test('names the blob by the file name, encoded for the URL', async () => {
		const fetch = fakeFetch(() => undefined);
		await uploadInParts(fileOf('abc', 'data (1).geojson'), { chunkBytes: 4, csrfToken: '', fetch });
		assert.equal(partsOf(fetch)[0].arguments[0], '/admin/upload-to-blob/blocks?name=data%20(1).geojson&block=0');
	});

	test('tries a failed part again, and carries on', async () => {
		let failures = 0;
		const fetch = fakeFetch((url) => {
			if (url.includes('block=0') && failures < ATTEMPTS - 1) {
				failures++;
				return failures === 1 ? new Response('busy', { status: 503 }) : Promise.reject(new TypeError('offline'));
			}
			return undefined;
		});
		const name = await uploadInParts(fileOf('abc'), { chunkBytes: 4, csrfToken: '', fetch, retryDelayMs: 0 });
		assert.equal(name, 'data.geojson');
		assert.equal(partsOf(fetch).length, ATTEMPTS);
	});

	test(`gives up after ${ATTEMPTS} tries, with the last reason`, async () => {
		const fetch = fakeFetch((url) =>
			url.includes('blocks')
				? Response.json({ error: 'Could not upload the file to blob storage.' }, { status: 502 })
				: undefined
		);
		await assert.rejects(
			() => uploadInParts(fileOf('abc'), { chunkBytes: 4, csrfToken: '', fetch, retryDelayMs: 0 }),
			/Could not upload the file to blob storage\./
		);
		assert.equal(partsOf(fetch).length, ATTEMPTS);
	});

	test('a refused part fails at once - trying it again would not help', async () => {
		const fetch = fakeFetch((url) =>
			url.includes('blocks') ? Response.json({ error: 'The upload sent an empty part.' }, { status: 400 }) : undefined
		);
		await assert.rejects(
			() => uploadInParts(fileOf('abc'), { chunkBytes: 4, csrfToken: '', fetch, retryDelayMs: 0 }),
			/empty part/
		);
		assert.equal(partsOf(fetch).length, 1);
	});

	test("says the status when a response isn't the app's - Front Door's firewall page, say", async () => {
		const fetch = fakeFetch((url) =>
			url.includes('commit') ? new Response('<html>blocked</html>', { status: 403 }) : undefined
		);
		await assert.rejects(
			() => uploadInParts(fileOf('abc'), { chunkBytes: 4, csrfToken: '', fetch, retryDelayMs: 0 }),
			/The upload failed \(403\)\./
		);
		// a JSON answer without an error says the status too
		const unexplained = fakeFetch((url) => (url.includes('commit') ? Response.json({}, { status: 500 }) : undefined));
		await assert.rejects(
			() => uploadInParts(fileOf('abc'), { chunkBytes: 4, csrfToken: '', fetch: unexplained, retryDelayMs: 0 }),
			/The upload failed \(500\)\./
		);
	});

	test('fails at once when the commit is refused', async () => {
		const fetch = fakeFetch((url) =>
			url.includes('commit')
				? Response.json({ error: 'The upload named a file or part that can not be uploaded.' }, { status: 400 })
				: undefined
		);
		await assert.rejects(
			() => uploadInParts(fileOf('abc'), { chunkBytes: 4, csrfToken: '', fetch, retryDelayMs: 0 }),
			/can not be uploaded/
		);
		assert.equal(fetch.mock.calls.filter((call) => call.arguments[0].endsWith('commit')).length, 1);
	});

	test('reports a thrown non-error as text', async () => {
		const fetch = mock.fn(() => Promise.reject('down'));
		await assert.rejects(
			() => uploadInParts(fileOf('abc'), { chunkBytes: 4, csrfToken: '', fetch, retryDelayMs: 0 }),
			/down/
		);
	});

	test('refuses an empty file', async () => {
		const fetch = fakeFetch();
		await assert.rejects(() => uploadInParts(fileOf(''), { chunkBytes: 4, csrfToken: '', fetch }), /empty/);
		assert.equal(fetch.mock.callCount(), 0);
	});

	test('uses the browser fetch, and reports progress to nobody, by default', async (t) => {
		const fetch = t.mock.method(globalThis, 'fetch', async (url, init) =>
			url.endsWith('commit')
				? Response.json({ uploadedBlobName: JSON.parse(init.body).name })
				: new Response(null, { status: 204 })
		);
		assert.equal(await uploadInParts(fileOf('abc'), { chunkBytes: 4, csrfToken: '' }), 'data.geojson');
		assert.equal(fetch.mock.callCount(), 2);
	});
});

describe('the upload form', () => {
	/** Choose `file` in the form's file input. */
	function choose(document, file) {
		Object.defineProperty(document.getElementById('file'), 'files', { value: file ? [file] : [] });
	}

	function submit(document) {
		const event = new document.defaultView.Event('submit', { cancelable: true });
		document.querySelector('form').dispatchEvent(event);
		return event;
	}

	/** Wait for the form's upload to finish, whichever way. */
	const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

	test('uploads the chosen file in parts, saying how far it has got, then shows the success message', async () => {
		const document = documentWith();
		const fetch = fakeFetch(() => undefined);
		const location = { assign: mock.fn() };
		assert.equal(enhanceUploadForm(document.querySelector('form'), { fetch, location }), true);
		choose(document, fileOf('0123456789'));

		const event = submit(document);
		assert.equal(event.defaultPrevented, true);
		assert.equal(document.querySelector('button').disabled, true);
		assert.match(
			document.querySelector('[data-upload-status]').textContent,
			/Uploading data\.geojson: 0 of 3 parts sent \(0%\)/
		);
		await settle();

		assert.equal(partsOf(fetch)[0].arguments[1].headers['x-csrf-token'], 'token-1');
		assert.equal(document.querySelector('[data-upload-status]').textContent, 'Uploaded data.geojson.');
		assert.deepEqual(location.assign.mock.calls[0].arguments, ['/admin/upload-to-blob?uploaded=data.geojson']);
	});

	test('shows why an upload failed, as an error, and lets it be tried again', async () => {
		const document = documentWith();
		const fetch = fakeFetch((url) =>
			url.includes('blocks') ? Response.json({ error: 'The upload sent an empty part.' }, { status: 400 }) : undefined
		);
		enhanceUploadForm(document.querySelector('form'), { fetch, location: { assign: mock.fn() } });
		choose(document, fileOf('abc'));
		submit(document);
		await settle();

		const status = document.querySelector('[data-upload-status]');
		assert.equal(status.textContent, 'Could not upload the file: The upload sent an empty part.');
		assert.ok(status.classList.contains('govuk-error-message'));
		assert.equal(document.querySelector('button').disabled, false);
	});

	test('says a non-error failure as text', async () => {
		const document = documentWith();
		enhanceUploadForm(document.querySelector('form'), { fetch: () => Promise.reject('offline'), retryDelayMs: 0 });
		choose(document, fileOf('abc'));
		submit(document);
		await settle();
		assert.equal(document.querySelector('[data-upload-status]').textContent, 'Could not upload the file: offline');
	});

	test('posts the form as usual with no file, or one over the limit - the server says why', () => {
		const document = documentWith();
		const fetch = fakeFetch();
		enhanceUploadForm(document.querySelector('form'), { fetch });
		choose(document, undefined);
		assert.equal(submit(document).defaultPrevented, false);

		const large = documentWith();
		enhanceUploadForm(large.querySelector('form'), { fetch });
		choose(large, fileOf('x'.repeat(21)));
		assert.equal(submit(large).defaultPrevented, false);
		assert.equal(fetch.mock.callCount(), 0);
	});

	test('leaves the form alone without everything it needs', () => {
		assert.equal(enhanceUploadForm(documentWith(FORM.replace('data-upload-status', '')).querySelector('form')), false);
		assert.equal(
			enhanceUploadForm(documentWith(FORM.replace('data-chunk-bytes="4"', '')).querySelector('form')),
			false
		);
		assert.equal(
			enhanceUploadForm(documentWith(FORM.replace('<button>Upload</button>', '')).querySelector('form')),
			false
		);
		assert.equal(enhanceUploadForm(documentWith(FORM.replace('type="file" ', '')).querySelector('form')), false);
		assert.equal(enhanceUploadForm(documentWith().querySelector('form'), { fetch: undefined, location: {} }), true);
		assert.equal(enhanceUploadForm(documentWith().querySelector('form'), { fetch: 'not a function' }), false);
	});

	test('enhances the page form, if there is one', (t) => {
		t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 204 }));
		assert.equal(initBlobUpload(documentWith()), true);
		assert.equal(initBlobUpload(documentWith('<p>No form here</p>')), false);
		assert.equal(initBlobUpload(undefined), false);
	});

	test('posts to the page without a CSRF token if the page has none', async () => {
		const document = documentWith(FORM.replace(' data-csrf-token="token-1"', ''));
		const fetch = fakeFetch(() => undefined);
		enhanceUploadForm(document.querySelector('form'), { fetch, location: { assign: mock.fn() } });
		choose(document, fileOf('abc'));
		submit(document);
		await settle();
		assert.equal(partsOf(fetch)[0].arguments[1].headers['x-csrf-token'], '');
	});
});
