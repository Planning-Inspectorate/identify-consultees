import type { ManageService } from '#service';
import { DefaultAzureCredential } from '@azure/identity';
import type { ProcessErrorArgs, ServiceBusReceivedMessage } from '@azure/service-bus';
import { ServiceBusClient } from '@azure/service-bus';
import type { CbosSubscriberSettings } from '../config.ts';
import { importCaseBoundariesFromCbos } from './cbos-boundaries.ts';

/**
 * Keeps case boundaries in step with CBOS. CBOS publishes an event on its `nsip-document` Service
 * Bus topic whenever a document changes - including when its process-shapefile job saves a
 * boundary's GeoJSON as a new version of the uploaded ZIP (an Update; see
 * Planning-Inspectorate/back-office: shapefile-processing.service.js). Each event for a GeoJSON in
 * a GIS Shapefiles folder imports that case's boundaries again, through the same path as the admin
 * import - so a new boundary arrives without anyone importing it.
 *
 * The subscription (infrastructure/idas-back-office.tf) passes only Create and Update events, and
 * most of those are other documents, ignored here. Nothing is deleted when CBOS deletes a document:
 * the import only adds and updates.
 */

const GEOJSON_MIME = 'application/geo+json';
const GIS_SHAPEFILE_DOCUMENT_TYPE = 'GIS shapefile';
const GIS_SHAPEFILES_FOLDER_NAME = 'GIS Shapefiles';

/** The nsip-document event fields this reads (Planning-Inspectorate/data-model: nsip-document.schema.json). */
interface NsipDocumentEvent {
	caseRef?: unknown;
	mime?: unknown;
	documentType?: unknown;
	/** Case reference, folders and file name: "EN010011/GIS Shapefiles/site.geojson". */
	path?: unknown;
}

/** A message body as an object - the SDK hands over JSON already parsed, but text or bytes may come too. */
function eventBody(body: unknown): NsipDocumentEvent | undefined {
	let parsed = body;
	if (typeof body === 'string' || Buffer.isBuffer(body)) {
		try {
			parsed = JSON.parse(body.toString());
		} catch {
			return undefined;
		}
	}
	return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
}

/**
 * The case whose boundary an event is about - one for a GeoJSON that's a GIS shapefile, or is filed
 * in a GIS Shapefiles folder - else undefined, for every other document.
 */
export function boundaryCaseReference(body: unknown): string | undefined {
	const event = eventBody(body);
	if (!event || event.mime !== GEOJSON_MIME || typeof event.caseRef !== 'string' || !event.caseRef.trim()) {
		return undefined;
	}
	const inGisFolder = typeof event.path === 'string' && event.path.split('/').includes(GIS_SHAPEFILES_FOLDER_NAME);
	return event.documentType === GIS_SHAPEFILE_DOCUMENT_TYPE || inGisFolder ? event.caseRef.trim() : undefined;
}

type SubscriberService = Pick<ManageService, 'db' | 'logger' | 'pythonFunctionUrl' | 'pythonFunctionApiKey'>;

/**
 * Handles one event: imports its case's boundaries, if it's about one. A failed import throws, so
 * the message goes back on the subscription to be tried again (and, after the subscription's
 * delivery count, to its dead-letter queue); a file that can't be read is logged and passed over,
 * as the admin import does.
 */
export function buildCbosEventHandler(
	service: SubscriberService,
	runImport: typeof importCaseBoundariesFromCbos = importCaseBoundariesFromCbos
) {
	return async (message: Pick<ServiceBusReceivedMessage, 'body' | 'messageId'>): Promise<void> => {
		const caseReference = boundaryCaseReference(message.body);
		if (!caseReference) {
			return;
		}
		const result = await runImport(service.db, {
			pythonFunctionUrl: service.pythonFunctionUrl,
			apiKey: service.pythonFunctionApiKey,
			caseReference
		});
		service.logger.info(
			{ caseReference, messageId: message.messageId, filesFound: result.filesFound, imported: result.imported },
			'imported a case boundary update from CBOS'
		);
		if (result.failures.length > 0) {
			service.logger.warn(
				{ caseReference, failures: result.failures },
				'Some CBOS boundary files could not be imported'
			);
		}
	};
}

/** What starting the subscriber needs from the SDK - a client for the namespace, signed in as the app. */
export type ServiceBusClientFactory = (namespace: string) => Pick<ServiceBusClient, 'createReceiver' | 'close'>;

/** A client for the namespace, signed in as the app's managed identity (locally, the Azure CLI's user). */
export const serviceBusClientFor: ServiceBusClientFactory = (namespace) =>
	new ServiceBusClient(namespace, new DefaultAzureCredential());

/**
 * Starts taking CBOS's document events from our subscription, one at a time - an import is a few
 * calls to the function, and a burst of events for one case shouldn't import it in parallel. The
 * SDK reconnects by itself; its errors are logged. Returns a way to stop.
 */
export function startCbosSubscriber(
	service: SubscriberService,
	settings: CbosSubscriberSettings,
	createClient: ServiceBusClientFactory = serviceBusClientFor
): { close: () => Promise<void> } {
	const client = createClient(settings.namespace);
	const receiver = client.createReceiver(settings.topic, settings.subscription);
	const subscription = receiver.subscribe(
		{
			processMessage: buildCbosEventHandler(service),
			processError: async ({ error, errorSource, entityPath }: ProcessErrorArgs) => {
				service.logger.error({ error, errorSource, entityPath }, 'CBOS subscription error');
			}
		},
		{ maxConcurrentCalls: 1 }
	);
	service.logger.info(
		{ topic: settings.topic, subscription: settings.subscription },
		'listening for CBOS case boundary updates'
	);
	return {
		close: async () => {
			await subscription.close();
			await receiver.close();
			await client.close();
		}
	};
}
