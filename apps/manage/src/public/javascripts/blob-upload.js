/**
 * The admin "Upload a file to blob storage" page: sends the chosen file a part at a time rather
 * than in one request. One request carrying a whole reference data export - hundreds of MB through
 * Front Door, onto the app's disk, then on to blob storage - can outlast Front Door's response
 * timeout; each part here takes seconds. The server stages each part as a block of the blob, then
 * commits them in order (admin/upload-to-blob/controller.ts).
 *
 * Without this script the form posts the whole file, as it always has - fine for a small one.
 */

/** How many parts are in flight at once. */
export const PARALLEL_PARTS = 4;
/** How many times a part is tried before the upload gives up. */
export const ATTEMPTS = 3;

/**
 * @typedef {{
 *   chunkBytes: number,
 *   csrfToken: string,
 *   fetch?: typeof fetch,
 *   onProgress?: (sent: number, total: number) => void,
 *   retryDelayMs?: number
 * }} UploadOptions
 */

/**
 * The error a failed response gives, else a general one.
 * @param {Response} response
 * @returns {Promise<string>}
 */
async function responseError(response) {
	try {
		const body = await response.json();
		if (body && typeof body.error === 'string') {
			return body.error;
		}
	} catch {
		// not JSON - Front Door's firewall or timeout page, say
	}
	return `The upload failed (${response.status}).`;
}

/**
 * `send`, tried up to ATTEMPTS times, waiting a little longer each time.
 * @param {() => Promise<Response>} send
 * @param {number} retryDelayMs
 * @returns {Promise<Response>}
 */
async function withRetries(send, retryDelayMs) {
	let lastError;
	for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
		try {
			const response = await send();
			// a refused part (400) won't do better a second time
			if (response.ok || response.status === 400) {
				return response;
			}
			lastError = new Error(await responseError(response));
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
		}
		if (attempt < ATTEMPTS) {
			await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
		}
	}
	throw lastError;
}

/**
 * Upload `file` to blob storage under its own name, `chunkBytes` at a time, then commit it.
 * Resolves the blob's name; rejects with the reason it failed.
 * @param {File} file
 * @param {UploadOptions} options
 * @returns {Promise<string>}
 */
export async function uploadInParts(file, options) {
	const { chunkBytes, csrfToken, fetch = globalThis.fetch, onProgress = () => {}, retryDelayMs = 1000 } = options;
	const parts = Math.ceil(file.size / chunkBytes);
	if (parts === 0) {
		throw new Error('The selected file is empty.');
	}
	const name = encodeURIComponent(file.name);
	let next = 0;
	let sent = 0;
	onProgress(0, parts);

	const sendParts = async () => {
		while (next < parts) {
			const index = next++;
			const response = await withRetries(
				() =>
					fetch(`/admin/upload-to-blob/blocks?name=${name}&block=${index}`, {
						method: 'POST',
						headers: { 'content-type': 'application/octet-stream', 'x-csrf-token': csrfToken },
						body: file.slice(index * chunkBytes, (index + 1) * chunkBytes)
					}),
				retryDelayMs
			);
			if (!response.ok) {
				throw new Error(await responseError(response));
			}
			onProgress(++sent, parts);
		}
	};
	await Promise.all(Array.from({ length: Math.min(PARALLEL_PARTS, parts) }, sendParts));

	const response = await withRetries(
		() =>
			fetch('/admin/upload-to-blob/commit', {
				method: 'POST',
				headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
				body: JSON.stringify({ name: file.name, blocks: parts })
			}),
		retryDelayMs
	);
	if (!response.ok) {
		throw new Error(await responseError(response));
	}
	return (await response.json()).uploadedBlobName;
}

/**
 * Make the form upload its file in parts, saying how far it's got, and go to the page's success
 * message once it's done. No file, a file over the limit, or no fetch in the browser - the form
 * posts as it would without this script, and the server says what's wrong.
 * @param {HTMLFormElement} form
 * @param {{ fetch?: typeof fetch, location?: { assign: (url: string) => void }, retryDelayMs?: number }} [options]
 */
export function enhanceUploadForm(form, options = {}) {
	const { fetch = globalThis.fetch, location = globalThis.location, retryDelayMs } = options;
	const input = form.querySelector('input[type="file"]');
	const status = form.querySelector('[data-upload-status]');
	const button = form.querySelector('button');
	const chunkBytes = Number(form.dataset.chunkBytes);
	const maxBytes = Number(form.dataset.maxUploadBytes);
	if (!input || !status || !button || !(chunkBytes > 0) || typeof fetch !== 'function') {
		return false;
	}

	form.addEventListener('submit', async (event) => {
		const file = input.files?.[0];
		if (!file || file.size > maxBytes) {
			return;
		}
		event.preventDefault();
		button.disabled = true;
		status.classList.remove('govuk-error-message');
		try {
			const uploaded = await uploadInParts(file, {
				chunkBytes,
				csrfToken: form.dataset.csrfToken ?? '',
				fetch,
				retryDelayMs,
				onProgress: (sent, total) => {
					status.textContent = `Uploading ${file.name}: ${sent} of ${total} parts sent (${Math.floor((sent / total) * 100)}%).`;
				}
			});
			status.textContent = `Uploaded ${uploaded}.`;
			location.assign(`/admin/upload-to-blob?uploaded=${encodeURIComponent(uploaded)}`);
		} catch (error) {
			status.classList.add('govuk-error-message');
			// uploadInParts always rejects with an Error
			status.textContent = `Could not upload the file: ${error.message}`;
			button.disabled = false;
		}
	});
	return true;
}

/**
 * Enhance the upload form, if the page has one.
 * @param {Document | undefined} documentTarget
 */
export function initBlobUpload(documentTarget = globalThis.document) {
	const form = documentTarget?.querySelector('form[data-chunked-upload]');
	return form ? enhanceUploadForm(form) : false;
}

initBlobUpload();
