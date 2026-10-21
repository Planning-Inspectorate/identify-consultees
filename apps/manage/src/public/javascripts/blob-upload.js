/**
 * The admin "Upload a file to blob storage" page: sends the chosen file a part at a time rather
 * than in one request. One request carrying a whole reference data export - hundreds of MB through
 * Front Door, onto the app's disk, then on to blob storage - can outlast Front Door's response
 * timeout; each part here takes seconds. The server stages each part as a block of the blob, then
 * commits them in order (admin/upload-to-blob/controller.ts).
 *
 * A group's form (data-blob-group) saves the file as the group's for the date its data is from -
 * 20261020_public_bodies.geojson - filling the date in from the chosen file's name, which the
 * pipeline starts with it.
 *
 * Without this script the form posts the whole file, as it always has - fine for a small one.
 */

/** How many parts are in flight at once. */
export const PARALLEL_PARTS = 4;
/** How many times a part is tried before the upload gives up. */
export const ATTEMPTS = 3;

/**
 * @typedef {{
 *   blobName?: string,
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
 * A day, month and year as YYYYMMDD, if they're a real date.
 * @param {string} day
 * @param {string} month
 * @param {string} year
 * @returns {string | undefined}
 */
export function compactDate(day, month, year) {
	const [d, m, y] = [day, month, year].map((part) => String(part).trim());
	if (!/^\d{4}$/.test(y) || !/^\d{1,2}$/.test(m) || !/^\d{1,2}$/.test(d)) {
		return undefined;
	}
	const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
	const real =
		date.getUTCFullYear() === Number(y) && date.getUTCMonth() === Number(m) - 1 && date.getUTCDate() === Number(d);
	return real ? `${y}${m.padStart(2, '0')}${d.padStart(2, '0')}` : undefined;
}

/**
 * The date a file's name starts with, as the pipeline names its files (20261020_...).
 * @param {string} name
 * @returns {{ day: string, month: string, year: string } | undefined}
 */
export function dateFromFileName(name) {
	const match = /^(\d{4})(\d{2})(\d{2})/.exec(name);
	if (!match || !compactDate(match[3], match[2], match[1])) {
		return undefined;
	}
	return { day: String(Number(match[3])), month: String(Number(match[2])), year: match[1] };
}

/**
 * Upload `file` to blob storage - under `blobName`, else its own name - `chunkBytes` at a time,
 * then commit it. Resolves the blob's name; rejects with the reason it failed.
 * @param {File} file
 * @param {UploadOptions} options
 * @returns {Promise<string>}
 */
export async function uploadInParts(file, options) {
	const { chunkBytes, csrfToken, fetch = globalThis.fetch, onProgress = () => {}, retryDelayMs = 1000 } = options;
	const blobName = options.blobName ?? file.name;
	const parts = Math.ceil(file.size / chunkBytes);
	if (parts === 0) {
		throw new Error('The selected file is empty.');
	}
	const name = encodeURIComponent(blobName);
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
				body: JSON.stringify({ name: blobName, blocks: parts })
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
	const group = form.dataset.blobGroup;
	if (!input || !status || !button || !(chunkBytes > 0) || typeof fetch !== 'function') {
		return false;
	}
	/** @param {'day' | 'month' | 'year'} part */
	const dateField = (part) => /** @type {HTMLInputElement | null} */ (form.querySelector(`input[name="date-${part}"]`));
	const showError = (message) => {
		status.classList.add('govuk-error-message');
		status.textContent = message;
	};

	if (group) {
		// the pipeline starts each file's name with the date its data is from
		input.addEventListener('change', () => {
			const date = input.files[0] ? dateFromFileName(input.files[0].name) : undefined;
			for (const part of /** @type {const} */ (['day', 'month', 'year'])) {
				const field = dateField(part);
				if (date && field) {
					field.value = date[part];
				}
			}
		});
	}

	// marks the form as sending in parts - and tells tests the script is ready
	form.dataset.uploadEnhanced = '';
	form.addEventListener('submit', async (event) => {
		const file = input.files[0];
		if (!file || file.size > maxBytes) {
			return;
		}
		event.preventDefault();
		let blobName = file.name;
		if (group) {
			const date = compactDate(
				dateField('day')?.value ?? '',
				dateField('month')?.value ?? '',
				dateField('year')?.value ?? ''
			);
			if (!date) {
				showError('Enter the date the data is from, as a real date.');
				return;
			}
			blobName = `${date}_${group}.geojson`;
		}
		button.disabled = true;
		status.classList.remove('govuk-error-message');
		try {
			const uploaded = await uploadInParts(file, {
				blobName,
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
			// uploadInParts always rejects with an Error
			showError(`Could not upload the file: ${error.message}`);
			button.disabled = false;
		}
	});
	return true;
}

/**
 * Enhance the page's upload forms, if it has any - how many it enhanced.
 * @param {Document | undefined} documentTarget
 */
export function initBlobUpload(documentTarget = globalThis.document) {
	const forms = documentTarget ? [...documentTarget.querySelectorAll('form[data-chunked-upload]')] : [];
	return forms.filter((form) => enhanceUploadForm(form)).length;
}

initBlobUpload();
