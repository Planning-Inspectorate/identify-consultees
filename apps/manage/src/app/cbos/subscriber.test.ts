import { mockLogger } from '#lib/testing/index.ts';
import { ServiceBusClient } from '@azure/service-bus';
import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import {
	boundaryCaseReference,
	buildCbosEventHandler,
	serviceBusClientFor,
	startCbosSubscriber
} from './subscriber.ts';

// an nsip-document event for the GeoJSON CBOS's process-shapefile job saves
const GEOJSON_EVENT = {
	documentId: '0f8fad5b-d9cb-469f-a165-70867728950e',
	version: 2,
	caseRef: 'EN010001',
	mime: 'application/geo+json',
	documentType: 'GIS shapefile',
	path: 'EN010001/GIS Shapefiles/site.geojson'
};

const service = () => ({
	db: {} as never,
	logger: mockLogger(),
	pythonFunctionUrl: 'http://localhost:7071/api/consultee-areas',
	pythonFunctionApiKey: 'test-key'
});

describe('CBOS subscriber', () => {
	describe('boundaryCaseReference', () => {
		it("is the case of a GeoJSON that's a GIS shapefile, or is in a GIS Shapefiles folder", () => {
			assert.equal(boundaryCaseReference(GEOJSON_EVENT), 'EN010001');
			assert.equal(boundaryCaseReference({ ...GEOJSON_EVENT, documentType: null }), 'EN010001');
			assert.equal(
				boundaryCaseReference({ ...GEOJSON_EVENT, path: 'EN010001/Other/site.geojson', caseRef: ' EN010001 ' }),
				'EN010001'
			);
			// as text, or bytes
			assert.equal(boundaryCaseReference(JSON.stringify(GEOJSON_EVENT)), 'EN010001');
			assert.equal(boundaryCaseReference(Buffer.from(JSON.stringify(GEOJSON_EVENT))), 'EN010001');
		});

		it('is none for any other document, or an event it cannot read', () => {
			for (const body of [
				// the shapefile ZIP itself, before CBOS converts it
				{ ...GEOJSON_EVENT, mime: 'application/zip' },
				// a GeoJSON filed elsewhere, not called a shapefile
				{ ...GEOJSON_EVENT, documentType: 'Plans', path: 'EN010001/Other/site.geojson' },
				{ ...GEOJSON_EVENT, documentType: 'Plans', path: null },
				{ ...GEOJSON_EVENT, caseRef: ' ' },
				{ ...GEOJSON_EVENT, caseRef: null },
				'not json',
				null,
				[GEOJSON_EVENT],
				42
			]) {
				assert.equal(boundaryCaseReference(body), undefined, JSON.stringify(body));
			}
		});
	});

	describe('buildCbosEventHandler', () => {
		it("imports the case's boundaries for a boundary event, through the function", async () => {
			const subscriberService = service();
			const runImport = mock.fn(async () => ({ filesFound: 2, imported: 2, casesImported: 1, failures: [] }));
			await buildCbosEventHandler(subscriberService, runImport as never)({ body: GEOJSON_EVENT, messageId: 'm1' });

			assert.deepEqual(runImport.mock.calls[0].arguments.slice(1), [
				{
					pythonFunctionUrl: 'http://localhost:7071/api/consultee-areas',
					apiKey: 'test-key',
					caseReference: 'EN010001'
				}
			]);
			assert.equal(subscriberService.logger.info.mock.callCount(), 1);
			assert.equal(subscriberService.logger.warn.mock.callCount(), 0);
		});

		it('passes over other documents without importing anything', async () => {
			const runImport = mock.fn();
			await buildCbosEventHandler(
				service(),
				runImport as never
			)({ body: { mime: 'application/pdf' }, messageId: 'm2' });
			assert.equal(runImport.mock.callCount(), 0);
		});

		it('logs files it could not read, and throws when the import fails - so the message is tried again', async () => {
			const subscriberService = service();
			const failure = { caseReference: 'EN010001', fileName: 'site.geojson', reason: 'no geometry' };
			await buildCbosEventHandler(subscriberService, (async () => ({
				filesFound: 1,
				imported: 0,
				casesImported: 0,
				failures: [failure]
			})) as never)({ body: GEOJSON_EVENT, messageId: 'm3' });
			assert.equal(subscriberService.logger.warn.mock.callCount(), 1);

			await assert.rejects(
				buildCbosEventHandler(service(), (async () => {
					throw new Error('Python function cbos/boundary-files responded with status 500');
				}) as never)({ body: GEOJSON_EVENT, messageId: 'm4' }),
				/status 500/
			);
		});
	});

	it('signs in to the namespace as the app - a client connects only when it receives', async () => {
		const client = serviceBusClientFor('sb.example.net');
		assert.ok(client instanceof ServiceBusClient);
		await client.close();
	});

	describe('startCbosSubscriber', () => {
		it('takes events from our subscription one at a time, logs errors, and stops', async () => {
			const subscriberService = service();
			const subscription = { close: mock.fn(async () => undefined) };
			const receiver = { subscribe: mock.fn(() => subscription), close: mock.fn(async () => undefined) };
			const client = { createReceiver: mock.fn(() => receiver), close: mock.fn(async () => undefined) };
			const createClient = mock.fn(() => client);

			const subscriber = startCbosSubscriber(
				subscriberService,
				{ namespace: 'sb.example.net', topic: 'nsip-document', subscription: 'identify-consultees' },
				createClient as never
			);

			assert.deepEqual(createClient.mock.calls[0].arguments, ['sb.example.net']);
			assert.deepEqual(client.createReceiver.mock.calls[0].arguments, ['nsip-document', 'identify-consultees']);
			const [handlers, options] = receiver.subscribe.mock.calls[0].arguments as unknown as [
				{ processError: (args: object) => Promise<void> },
				object
			];
			assert.deepEqual(options, { maxConcurrentCalls: 1 });
			await handlers.processError({ error: new Error('unauthorised'), errorSource: 'receive', entityPath: 'x' });
			assert.equal(subscriberService.logger.error.mock.callCount(), 1);

			await subscriber.close();
			assert.equal(subscription.close.mock.callCount(), 1);
			assert.equal(receiver.close.mock.callCount(), 1);
			assert.equal(client.close.mock.callCount(), 1);
		});
	});
});
