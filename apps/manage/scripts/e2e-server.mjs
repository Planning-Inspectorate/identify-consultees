#!/usr/bin/env node
/**
 * Lightweight HTTP server for Playwright e2e / a11y / visual tests.
 * Uses the same auth-disabled app factory as the manage integration tests.
 */
import { createServer } from 'node:http';
import { createManageTestApp, createManageTestService } from '../src/app/testing/create-test-app.ts';

const port = Number.parseInt(process.env.E2E_PORT || '8091', 10);
const service = createManageTestService(true);
const app = createManageTestApp(service);

const server = createServer(app);

const shutdown = async () => {
	await new Promise((resolve) => server.close(resolve));
	await service.db.$disconnect().catch(() => undefined);
	process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(port, '127.0.0.1', () => {
	console.log(`e2e server listening on http://127.0.0.1:${port}`);
});
