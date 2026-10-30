import { TimeoutError } from './timeout-error.ts';

/**
 * Make a request with `fetch` using an AbortController to implement request timeout.
 * Defaults to a GET request
 */
export async function fetchWithTimeout(
	url: string,
	{ timeoutMs }: { timeoutMs: number },
	options: RequestInit = {}
): Promise<Response> {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

	try {
		return await fetch(url, {
			method: 'GET',
			headers: {
				'Content-Type': 'application/json'
			},
			...options,
			signal: controller.signal
		});
	} catch (error) {
		if (error instanceof Error && error.name === 'AbortError') {
			throw new TimeoutError(timeoutMs, `Request to ${url} timed out after ${timeoutMs}ms`);
		}
		throw error;
	} finally {
		clearTimeout(timeoutId);
	}
}
