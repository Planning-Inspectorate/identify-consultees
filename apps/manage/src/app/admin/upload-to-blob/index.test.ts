import express from 'express';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, test } from 'node:test';
import request from 'supertest';
import { limitInFlightUploads } from './index.ts';

describe('limitInFlightUploads', () => {
	test('lets up to the cap run at once, 429s the rest, and frees slots as uploads finish', async () => {
		let releaseFirst!: () => void;
		const gate = new Promise<void>((resolve) => (releaseFirst = resolve));
		let reached = 0;
		const app = express();
		// a capped route whose handler waits on the gate, so the first request stays in flight
		app.post('/run', limitInFlightUploads(1), async (_req, res) => {
			reached += 1;
			await gate;
			res.sendStatus(204);
		});

		// .then() is what actually sends a supertest request; first stays in flight on the gate
		const first = request(app)
			.post('/run')
			.send('x')
			.then((response) => response);
		for (let i = 0; i < 50 && reached === 0; i += 1) {
			await new Promise((resolve) => setImmediate(resolve));
		}
		assert.equal(reached, 1);

		const rejected = await request(app).post('/run').send('x');
		assert.equal(rejected.status, 429);
		assert.equal(rejected.headers['retry-after'], '30');

		releaseFirst();
		assert.equal((await first).status, 204);

		// the slot freed once the first response finished - the next goes straight through
		assert.equal((await request(app).post('/run').send('x')).status, 204);
	});

	test('releases the slot when the connection closes mid-upload', () => {
		const limiter = limitInFlightUploads(1);
		// a stand-in response: an EventEmitter with the bits of res the limiter touches
		const res = () => Object.assign(new EventEmitter(), { setHeader() {}, status: () => ({ send() {} }) });
		let reached = 0;
		const next = () => {
			reached += 1;
		};

		const first = res();
		limiter({} as never, first as never, next);
		assert.equal(reached, 1);
		// the slot is held: a second request gets a 429
		limiter({} as never, res() as never, () => assert.fail('over-cap request should not pass'));

		// the connection closing mid-upload frees the slot, as 'finish' would have
		first.emit('close');
		limiter({} as never, res() as never, next);
		assert.equal(reached, 2);
	});
});
