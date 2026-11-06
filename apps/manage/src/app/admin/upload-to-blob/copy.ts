import type { ManageService } from '#service';
import type { AsyncRequestHandler } from '@planning-inspectorate/core/util';
import type { ReferenceDataCopySettings } from '../../config.ts';
import { formatUploadedAt } from '../../views/consultees/project/format-uploaded.ts';
import type { CopyPipeline, CopyRun } from './copy-pipeline.ts';
import type { CopySection } from './view-model.ts';

/**
 * The files page's Copy section: on Training, copy the reference data files Test loaded into this
 * environment's blob storage; on Prod, Training's - by starting the Promote reference data
 * pipeline (copy-pipeline.ts). Nothing is loaded: that's the Load into database page's, once the
 * copy has finished. Only where it's set up (config.ts's referenceDataCopy).
 */

const STATUS: Record<CopyRun['status'], { text: string; colour: string }> = {
	running: { text: 'Running', colour: 'blue' },
	succeeded: { text: 'Copied', colour: 'green' },
	failed: { text: 'Failed', colour: 'red' },
	cancelled: { text: 'Cancelled', colour: 'grey' }
};

// what ?copy= says, after a copy is asked for
const NOTICES = new Set(['started', 'running']);

/** The section - undefined where copying isn't set up. Never rejects: Azure DevOps down shows as an error. */
export async function copySection(
	service: Pick<ManageService, 'referenceDataCopy' | 'logger'>,
	pipeline: CopyPipeline | undefined,
	notice?: unknown
): Promise<CopySection | undefined> {
	const settings = service.referenceDataCopy;
	if (!settings || !pipeline) {
		return undefined;
	}
	const section: CopySection = {
		from: settings.from,
		to: settings.to,
		// the pipeline's Copy job is a deployment to the target environment - Prod's has an approval check
		needsApproval: settings.to === 'Prod',
		running: false,
		...(typeof notice === 'string' && NOTICES.has(notice) ? { notice: notice as CopySection['notice'] } : {})
	};
	try {
		const run = await pipeline.latestRun();
		if (run) {
			section.running = run.status === 'running';
			section.latest = {
				status: STATUS[run.status],
				queuedAt: formatUploadedAt(run.queuedAt),
				...(run.finishedAt ? { finishedAt: formatUploadedAt(run.finishedAt) } : {}),
				url: run.url
			};
		}
	} catch (error) {
		service.logger.warn({ error }, 'Could not read the reference data copy pipeline');
		section.error = `Couldn't reach Azure DevOps to see the last copy: ${describe(error)}`;
	}
	return section;
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Start a copy, unless one is already running for this route, then back to the page, which says
 * which. One that can't be started goes back saying why, on the page as it was. Mounted only where
 * copying is set up (index.ts).
 */
export function buildStartCopy(
	settings: ReferenceDataCopySettings,
	pipeline: CopyPipeline,
	service: Pick<ManageService, 'logger'>,
	renderPage: (res: Parameters<AsyncRequestHandler>[1], copyError: string) => Promise<void>
): AsyncRequestHandler {
	return async (_req, res) => {
		try {
			if ((await pipeline.latestRun())?.status === 'running') {
				return res.redirect('/admin/upload-to-blob?copy=running');
			}
			const run = await pipeline.start();
			service.logger.info({ runId: run.id, from: settings.from, to: settings.to }, 'Started a reference data copy');
			return res.redirect('/admin/upload-to-blob?copy=started');
		} catch (error) {
			service.logger.error({ error }, 'Could not start the reference data copy');
			return renderPage(res, `Couldn't start the copy from ${settings.from}: ${describe(error)}`);
		}
	};
}
