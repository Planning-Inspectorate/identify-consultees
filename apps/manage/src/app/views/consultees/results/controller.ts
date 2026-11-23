import type { ManageService } from '#service';
import { dataWatermark } from '@pins/identify-consultees-database/src/geospatial/consultee-areas.ts';
import { getRuleset } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import type { AsyncRequestHandler } from '@planning-inspectorate/core/util';
import { createHash } from 'node:crypto';
import { addedBeyondRun, buildCaseMapConfig, markAddedByHand, withAuthorityRoles } from '../../../maps/case-geojson.ts';
import { osMapsApiKeyFromEnv } from '../../../maps/os-maps.ts';
import { buildConsulteeStaticMapResponse, sendStaticMapResponse } from '../../../maps/serve-static-map.ts';
import { negotiateStaticMapFormat } from '../../../maps/static-map-raster.ts';
import { renderedStaticMap } from '../../../maps/static-map-response-cache.ts';
import { googleMapsApiKeyFromEnv } from '../../../maps/static-map.ts';
import { categorySettings } from '../../../report-config.ts';
import { excludedIds, queryValues } from '../report/urls.ts';
import { isCaseId, resolveCase } from '../resolve-case.ts';
import { buildSearchAreaSafely, firstQueryValue, runRulesetSafely, storedRunReference } from '../run-ruleset.ts';
import { categoryBufferMetres, siteBufferGeojson, siteBuffers } from '../site-buffers.ts';

function textResponse(status: number, body: string) {
	return { status, body, contentType: 'text/plain', cacheControl: 'no-cache', etag: '' };
}

/**
 * A category page's static map - the image its map falls back to without JavaScript, and when the
 * interactive map can't start: the category's consultees less removals, with the nearby ones added
 * by hand drawn as identified. Its URL sits under /results, where it began (categoryStaticMapUrl).
 *
 * Rendering one is expensive - display geometries, grown buffers, an upstream basemap - but is
 * decided entirely by the URL's parameters, the session's remembered run and the state of the
 * data. Those inputs fingerprint cheaply (one small query - see dataWatermark), so a repeated
 * request, including most If-None-Match revalidations, is answered from the rendered-map cache
 * without touching geometry at all.
 */
export function buildResultsStaticMap(service: ManageService, forceSvg = false): AsyncRequestHandler {
	const { db, logger } = service;

	return async (req, res) => {
		const caseId = String(req.params.caseId ?? '');
		const ruleset = getRuleset(firstQueryValue(req.query.ruleset));
		const { caseUpdated, watermark } = isCaseId(caseId)
			? await dataWatermark(db, caseId)
			: { caseUpdated: null, watermark: '' };

		if (!caseUpdated || !ruleset) {
			res.status(404).type('text/plain').send('Not found');
			return;
		}

		const category = firstQueryValue(req.query.category);
		// the remembered run's pointer names it (its ranAt), whichever shape the session field
		// holds - a Redis pointer or the whole run - so no geometry or Redis read is needed here
		const stored = storedRunReference(req.session, caseId, ruleset.id);
		const ifNoneMatch = typeof req.headers['if-none-match'] === 'string' ? req.headers['if-none-match'] : undefined;
		const accept = typeof req.headers.accept === 'string' ? req.headers.accept : undefined;

		// everything the image is drawn from: the URL's parameters, which run is remembered (a
		// ranAt names it, and its consultees and screening mode with it), the data's watermark and
		// which basemap/rendering choices are in play. A changed input is a different key - a hit
		// is only ever for identical content
		const key = createHash('sha256')
			.update(
				JSON.stringify({
					caseId,
					caseUpdated,
					rulesetId: ruleset.id,
					category: category || null,
					excluded: [...excludedIds(req.query.exclude)].sort(),
					included: queryValues(req.query.include).sort(),
					runRanAt: stored?.ranAt ?? null,
					watermark,
					format: forceSvg ? 'svg' : negotiateStaticMapFormat(accept),
					nearbyMetres: service.nearbySearchRadiusMetres,
					nearbyNsipMetres: service.nearbyNsipRadiusMetres ?? null,
					google: Boolean(googleMapsApiKeyFromEnv()),
					os: Boolean(osMapsApiKeyFromEnv())
				})
			)
			.digest('hex');

		const image = await renderedStaticMap(key, ifNoneMatch, async (inm) => {
			const project = await resolveCase(db, caseId);
			if (!project) {
				// the watermark's existence check said it was there - it went mid-request
				return textResponse(404, 'Not found');
			}

			const { consultees, failed, siteScreenedAs } = await runRulesetSafely(service, project, ruleset, req.session);
			if (failed) {
				// not an empty map: that would be cached (see Cache-Control below) as if it were a real
				// "no matches" result
				return textResponse(503, 'The ruleset could not be run');
			}
			// a category page's static map draws only that category's non-excluded consultees, with the
			// nearby ones added by hand (`include`) drawn as identified; with no
			// category it's every consultee the run found, same as the interactive map
			const excluded = excludedIds(req.query.exclude);
			const displayMatches =
				category || excluded.size > 0
					? consultees.filter(
							(match) =>
								(!category || match.feature.properties.consulteeCategory === category) &&
								!excluded.has(match.feature.id)
						)
					: consultees;
			// the consultees added by hand (`include`) the run found are drawn as identified, and a
			// category's ones it didn't - further away - are drawn too, as its Change page draws them
			const included = queryValues(req.query.include);
			const drawn = [
				...markAddedByHand(displayMatches, new Set(included)),
				...(category
					? addedBeyondRun(
							consultees,
							included.map((id) => ({ id, category, name: '' })),
							category
						)
					: [])
			];
			// the same search area as the interactive map, so both open on the same view - and the
			// category's ruleset buffers around the site, as its interactive map draws them: asked for together
			const [searchArea, buffers] = await Promise.all([
				buildSearchAreaSafely(db, project, drawn, service.nearbySearchRadiusMetres, logger),
				category
					? siteBuffers(
							service,
							project,
							siteScreenedAs,
							categoryBufferMetres(ruleset, category, service.nearbyNsipRadiusMetres)
						)
					: Promise.resolve([])
			]);
			// a category's map is framed as config/report.yaml sets for the category
			const map = buildCaseMapConfig(
				project,
				withAuthorityRoles(drawn, ruleset),
				category || ruleset.name,
				searchArea,
				undefined,
				categorySettings(category).mapMarginMetres
			);

			return buildConsulteeStaticMapResponse({
				geometryId: project.id,
				sectionId: ruleset.id,
				map: buffers.length > 0 ? { ...map, bufferGeojson: siteBufferGeojson(buffers) } : map,
				forceSvg,
				ifNoneMatch: inm,
				accept
			});
		});

		sendStaticMapResponse(res, image);
	};
}
