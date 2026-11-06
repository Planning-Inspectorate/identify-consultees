import { DefaultAzureCredential } from '@azure/identity';
import { fetchWithTimeout } from '@planning-inspectorate/core/util';
import type { ReferenceDataCopySettings } from '../../config.ts';

/**
 * The Promote reference data pipeline (.azure/pipelines/promote-reference-data.yml), as the admin
 * files page starts and follows it: it copies the reference data files the previous environment
 * loaded into this one's blob storage - Training's from Test, Prod's from Training - ready to load.
 * Through Azure DevOps's REST API, signed in as the app's managed identity, which DevOps adds to the
 * project with permission to queue and view that pipeline (see kt-docs/data/data-model.md).
 */

// the pipeline's name in Azure DevOps - it's found by name, so no id needs configuring
export const COPY_PIPELINE_NAME = 'Promote reference data';
// Azure DevOps's own Entra resource - every organisation's
const AZURE_DEVOPS_SCOPE = '499b84ac-1321-427f-aa17-267ca6975798/.default';
const API_VERSION = '7.1';
const REQUEST_TIMEOUT_MS = 15_000;
// how many of the pipeline's recent runs are looked through for this route's latest
const RECENT_RUNS = 20;

/** A run of the pipeline for this route, as the page shows it. */
export interface CopyRun {
	id: number;
	/** Waiting for Prod's approval shows as running: it's queued until approved. */
	status: 'running' | 'succeeded' | 'failed' | 'cancelled';
	queuedAt: Date;
	finishedAt?: Date;
	/** The run in Azure DevOps. */
	url: string;
}

export interface CopyPipeline {
	/** The route's latest run, if it has one. */
	latestRun(): Promise<CopyRun | undefined>;
	/** Start a run for the route, copying the source's dataset in use. */
	start(): Promise<CopyRun>;
}

/** The route as the pipeline's `route` parameter names it: "Test to Training". */
export function routeName(settings: Pick<ReferenceDataCopySettings, 'from' | 'to'>): string {
	return `${settings.from} to ${settings.to}`;
}

interface Build {
	id: number;
	status?: string;
	result?: string;
	queueTime: string;
	finishTime?: string;
	templateParameters?: Record<string, string>;
	_links?: { web?: { href?: string } };
}

export function toCopyRun(build: Build): CopyRun {
	const result = build.result ?? '';
	const status: CopyRun['status'] =
		build.status !== 'completed'
			? 'running'
			: result === 'succeeded'
				? 'succeeded'
				: result === 'canceled'
					? 'cancelled'
					: 'failed';
	return {
		id: build.id,
		status,
		queuedAt: new Date(build.queueTime),
		...(build.finishTime ? { finishedAt: new Date(build.finishTime) } : {}),
		url: build._links?.web?.href ?? ''
	};
}

export type AccessToken = () => Promise<string>;

/** A token for Azure DevOps, as the app's managed identity - or, locally, the Azure CLI's user. */
export function azureDevOpsToken(credential = new DefaultAzureCredential()): AccessToken {
	return async () => (await credential.getToken(AZURE_DEVOPS_SCOPE)).token;
}

export function azureDevOpsCopyPipeline(
	settings: ReferenceDataCopySettings,
	token: AccessToken = azureDevOpsToken()
): CopyPipeline {
	const route = routeName(settings);
	const request = async (path: string, init: { method?: string; body?: unknown } = {}) => {
		const url = `${settings.projectUrl}/_apis/${path}${path.includes('?') ? '&' : '?'}api-version=${API_VERSION}`;
		const response = await fetchWithTimeout(
			url,
			{ timeoutMs: REQUEST_TIMEOUT_MS },
			{
				method: init.method ?? 'GET',
				headers: { authorization: `Bearer ${await token()}`, 'content-type': 'application/json' },
				...(init.body ? { body: JSON.stringify(init.body) } : {})
			}
		);
		if (!response.ok) {
			// 401 and 403: the identity isn't in the project, or can't queue or view the pipeline
			throw new Error(`Azure DevOps responded with status ${response.status} to ${init.method ?? 'GET'} ${path}`);
		}
		return response.json();
	};
	let definitionId: Promise<number> | undefined;
	const pipelineId = () => {
		definitionId ??= request(`build/definitions?name=${encodeURIComponent(COPY_PIPELINE_NAME)}`).then(
			(body: { value?: { id: number }[] }) => {
				const id = body.value?.[0]?.id;
				if (id === undefined) {
					throw new Error(`Azure DevOps has no pipeline named "${COPY_PIPELINE_NAME}" in this project`);
				}
				return id;
			}
		);
		// a failed look-up is tried again next time
		definitionId.catch(() => (definitionId = undefined));
		return definitionId;
	};

	return {
		latestRun: async () => {
			const body = (await request(
				`build/builds?definitions=${await pipelineId()}&$top=${RECENT_RUNS}&queryOrder=queueTimeDescending`
			)) as { value?: Build[] };
			const build = (body.value ?? []).find((run) => run.templateParameters?.route === route);
			return build ? toCopyRun(build) : undefined;
		},
		start: async () =>
			toCopyRun(
				(await request('build/builds', {
					method: 'POST',
					body: {
						definition: { id: await pipelineId() },
						sourceBranch: 'refs/heads/main',
						// a blank quarter - the source's dataset in use, which the export checks
						templateParameters: { route, quarter: ' ' }
					}
				})) as Build
			)
	};
}
