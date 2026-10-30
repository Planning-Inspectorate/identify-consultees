/**
 * An error to indicate that a request timed out as a response was not received within the configured time
 */
export class TimeoutError extends Error {
	#timeoutMs: number;

	constructor(timeoutMs: number, message?: string) {
		super(message);
		this.name = 'TimeoutError';
		this.#timeoutMs = timeoutMs;
	}

	get timeoutMs() {
		return this.#timeoutMs;
	}
}
