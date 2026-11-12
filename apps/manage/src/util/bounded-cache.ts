/**
 * An in-process cache that can't grow without limit: at most `maxEntries`, the least recently used
 * dropped first, and each kept for `ttlMs`. Core's MapCache only drops an entry when that same key
 * is read again, so one never asked for again stays for the life of the process.
 */
export class BoundedCache<T> {
	readonly #entries = new Map<string, { value: T; storedAt: number }>();
	readonly #maxEntries: number;
	readonly #ttlMs: number;
	readonly #now: () => number;

	constructor({ maxEntries, ttlMs, now = Date.now }: { maxEntries: number; ttlMs: number; now?: () => number }) {
		this.#maxEntries = maxEntries;
		this.#ttlMs = ttlMs;
		this.#now = now;
	}

	get(key: string): T | undefined {
		const entry = this.#entries.get(key);
		if (!entry) {
			return undefined;
		}
		this.#entries.delete(key);
		if (this.#now() - entry.storedAt > this.#ttlMs) {
			return undefined;
		}
		// a Map iterates oldest first: put it back last, as the most recently used
		this.#entries.set(key, entry);
		return entry.value;
	}

	set(key: string, value: T): void {
		this.#entries.delete(key);
		this.#entries.set(key, { value, storedAt: this.#now() });
		for (const oldest of this.#entries.keys()) {
			if (this.#entries.size <= this.#maxEntries) {
				break;
			}
			this.#entries.delete(oldest);
		}
	}

	delete(key: string): void {
		this.#entries.delete(key);
	}

	clear(): void {
		this.#entries.clear();
	}

	get size(): number {
		return this.#entries.size;
	}
}
