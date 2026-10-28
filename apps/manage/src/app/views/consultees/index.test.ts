import type { ManageService } from '#service';
import express from 'express';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import request from 'supertest';
import { buildReportDownloadRateLimiter, buildStaticMapRateLimiter } from '../../rate-limit.ts';
import { createManageTestService } from '../../testing/create-test-app.ts';
import type { CreateRoutesOptions } from './index.ts';
import { createRoutes } from './index.ts';

// a bare app mounting just the consultees router, so tests can inject tiny
// rate limits without the rest of the app's middleware
function testApp(service: ManageService, options: CreateRoutesOptions) {
	const app = express();
	app.use('/consultees', createRoutes(service, options));
	return app;
}

describe('consultees routes rate limiting', () => {
	// a report download renders a workbook plus a PDF per category, so the
	// limiter must run before the handler - whatever the handler would answer
	test('GET /:caseId/report/download returns 429 past the limit', async () => {
		const service = createManageTestService();
		const app = testApp(service, {
			reportDownloadRateLimiter: buildReportDownloadRateLimiter({ limit: 2, windowMs: 60_000 })
		});
		try {
			for (const path of ['/consultees/case-1/report/download', '/consultees/case-1/report/download']) {
				const response = await request(app).get(path);
				assert.notEqual(response.status, 429);
			}
			const response = await request(app).get('/consultees/case-1/report/download');
			assert.equal(response.status, 429);
			assert.match(response.text, /Too many requests/);
		} finally {
			await service.db.$disconnect().catch(() => undefined);
		}
	});

	// the boundary and results maps share one limiter: they draw from the same
	// kind of request budget (upstream tile fetches per page render), so hits
	// on either count towards one limit
	test('GET static map routes returns 429 past the shared limit', async () => {
		const service = createManageTestService();
		const app = testApp(service, {
			staticMapRateLimiter: buildStaticMapRateLimiter({ limit: 2, windowMs: 60_000 })
		});
		try {
			for (const path of ['/consultees/case-1/boundary-map', '/consultees/case-1/results/static-map?ruleset=rs-1']) {
				const response = await request(app).get(path);
				assert.notEqual(response.status, 429);
			}
			const response = await request(app).get('/consultees/case-1/boundary-map.svg');
			assert.equal(response.status, 429);
		} finally {
			await service.db.$disconnect().catch(() => undefined);
		}
	});

	test('the limiters build with the production defaults when no options are given', () => {
		assert.equal(typeof buildReportDownloadRateLimiter(), 'function');
		assert.equal(typeof buildStaticMapRateLimiter(), 'function');
	});
});
