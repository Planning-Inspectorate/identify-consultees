import type { CaseBoundaryFeature } from '@pins/identify-consultees-database/src/geospatial/case-boundaries.ts';
import type { ConsulteeMatch, Ruleset } from '@pins/identify-consultees-database/src/geospatial/rulesets.ts';
import { mockLogger } from '@planning-inspectorate/core/testing';
import { unzipSync } from 'fflate';
import assert from 'node:assert';
import { after, before, describe, it, mock } from 'node:test';
import { ONE_PIXEL_PNG, pdfTextLines } from '../../../../testing/pdf-text.ts';
import {
	buildReportZip,
	categoryBufferMetres,
	formatBufferDistance,
	formatFileSize,
	rememberReportZip,
	rememberedReportZip,
	reportGeneratedBy,
	screenedSite
} from './report-zip.ts';

describe('formatFileSize', () => {
	it('gives kilobytes under a megabyte and megabytes over it', () => {
		assert.strictEqual(formatFileSize(512), '1KB');
		assert.strictEqual(formatFileSize(43_000), '42KB');
		assert.strictEqual(formatFileSize(1_435_000), '1.4MB');
		assert.strictEqual(formatFileSize(25 * 1024 * 1024), '25MB');
	});
});

describe('remembered report ZIPs', () => {
	it('serves what was remembered for a download URL', () => {
		const report = { fileName: 'report.zip', contents: Buffer.from('zip bytes') };
		rememberReportZip('/consultees/a/report/download?ruleset=rs', report);
		assert.strictEqual(rememberedReportZip('/consultees/a/report/download?ruleset=rs'), report);
	});

	it("keeps each user's own copy - its Summary names who generated it", () => {
		const report = { fileName: 'report.zip', contents: Buffer.from('Sam') };
		rememberReportZip('/consultees/a/report/download?ruleset=other', report, 'Sam Officer');
		assert.strictEqual(rememberedReportZip('/consultees/a/report/download?ruleset=other', 'Sam Officer'), report);
		assert.strictEqual(rememberedReportZip('/consultees/a/report/download?ruleset=other', 'Alex Officer'), undefined);
		assert.strictEqual(rememberedReportZip('/consultees/a/report/download?ruleset=other'), undefined);
	});

	it('keeps only the newest few reports - each is tens of MB of process memory', () => {
		for (let i = 0; i < 7; i++) {
			rememberReportZip(`/download/${i}`, { fileName: `${i}.zip`, contents: Buffer.alloc(1) });
		}
		// the oldest are evicted once five are kept
		assert.strictEqual(rememberedReportZip('/download/0'), undefined);
		assert.strictEqual(rememberedReportZip('/download/1'), undefined);
		assert.ok(rememberedReportZip('/download/6'));
	});
});

const RULESET: Ruleset = {
	id: 'test-ruleset',
	name: 'Test ruleset',
	rules: [
		{
			id: 'ambulance-near',
			name: 'Ambulance near',
			group: 'Public bodies',
			logicType: 'intersection',
			categories: ['Ambulance Trust'],
			bufferMetres: 1_000
		},
		{
			id: 'ambulance-and-hospital',
			name: 'Ambulance and hospital',
			group: 'Public bodies',
			logicType: 'intersection',
			categories: ['Ambulance Trust', 'Hospital'],
			bufferMetres: 10_000
		},
		{
			id: 'hospital-touching',
			name: 'Hospital touching',
			group: 'Public bodies',
			logicType: 'intersection',
			categories: ['Hospital'],
			bufferMetres: 0
		},
		{
			id: 'parish-host',
			name: 'Parish host',
			group: 'Administrative boundaries',
			logicType: 'intersection',
			categories: ['Parish Council']
		},
		{
			id: 'parish-bordering',
			name: 'Parish bordering',
			group: 'Administrative boundaries',
			logicType: 'bordering',
			categories: ['Parish Council'],
			hostCategory: 'Parish Council'
		}
	]
};

describe("a category's buffers", () => {
	it("are its conditions' distances, smallest first, each once - none for touching or bordering", () => {
		assert.deepStrictEqual(categoryBufferMetres(RULESET, 'Ambulance Trust', 5_000), [1_000, 10_000]);
		assert.deepStrictEqual(categoryBufferMetres(RULESET, 'Hospital', 5_000), [10_000]);
		assert.deepStrictEqual(categoryBufferMetres(RULESET, 'Parish Council', 5_000), []);
		assert.deepStrictEqual(categoryBufferMetres(RULESET, 'Railway', 5_000), []);
	});

	it('are the Nearby NSIPs distance for Nearby NSIPs, if it has one', () => {
		assert.deepStrictEqual(categoryBufferMetres(RULESET, 'Nearby NSIPs', 5_000), [5_000]);
		assert.deepStrictEqual(categoryBufferMetres(RULESET, 'Nearby NSIPs', 0), []);
	});

	it('read in metres under a kilometre, else kilometres', () => {
		assert.strictEqual(formatBufferDistance(500), '500 m');
		assert.strictEqual(formatBufferDistance(1_000), '1 km');
		assert.strictEqual(formatBufferDistance(1_500), '1.5 km');
		assert.strictEqual(formatBufferDistance(35_000), '35 km');
	});
});

const PROJECT: CaseBoundaryFeature = {
	type: 'Feature',
	id: '44444444-4444-4444-4444-444444444444',
	properties: { caseReference: 'EN010099', caseName: 'Real Test Project', fileName: 'site.geojson' },
	geometry: {
		type: 'Polygon',
		coordinates: [
			[
				[-1.6, 52.4],
				[-1.4, 52.4],
				[-1.4, 52.6],
				[-1.6, 52.6],
				[-1.6, 52.4]
			]
		]
	}
} as CaseBoundaryFeature;

describe('the site the buffers grow from', () => {
	it("is the site's outline, or the rectangle around it grown by 1km, as the function screens it", () => {
		assert.strictEqual(screenedSite(PROJECT, 'outline'), PROJECT.geometry);
		const box = screenedSite(PROJECT, 'boundingBox');
		assert.strictEqual(box.type, 'Polygon');
		const [ring] = (box as { coordinates: number[][][] }).coordinates;
		const latitudeMargin = 1_000 / 111_320;
		const longitudeMargin = 1_000 / (111_320 * Math.cos(((52.6 + latitudeMargin) * Math.PI) / 180));
		assert.deepStrictEqual(ring[0], [-1.6 - longitudeMargin, 52.4 - latitudeMargin]);
		assert.deepStrictEqual(ring[2], [-1.4 + longitudeMargin, 52.6 + latitudeMargin]);
		assert.deepStrictEqual(ring[4], ring[0]);
	});
});

describe("the report's maps", () => {
	const originalFetch = globalThis.fetch;
	before(() => {
		globalThis.fetch = async () =>
			new Response(ONE_PIXEL_PNG, { status: 200, headers: { 'content-type': 'image/png' } });
	});
	after(() => {
		globalThis.fetch = originalFetch;
	});

	function match(id: string, category: string, conditionId?: string): ConsulteeMatch {
		return {
			feature: {
				id,
				properties: { consulteeCategory: category, consultee: `${category} ${id}` },
				geometry: { type: 'Point', coordinates: [-1.5, 52.5] }
			},
			distanceMetres: 500,
			reasons: conditionId ? [{ type: 'condition', conditionId }] : [{ type: 'nearby', radiusMetres: 20_000 }]
		} as ConsulteeMatch;
	}

	it("draw only what's in the report, with each category's buffers around the site as the run screened it", async () => {
		const queries: unknown[][] = [];
		const logger = mockLogger();
		const service = {
			db: {
				$queryRaw: mock.fn(async (sql: TemplateStringsArray, ...values: unknown[]) => {
					// a Prisma.join of ids nests them in an Sql of their own
					queries.push(values.flatMap((value) => (value as { values?: unknown[] })?.values ?? [value]));
					const text = sql.join('');
					if (!/\bFROM\b/.test(text)) {
						// a buffer that can't be drawn
						if (values.includes(1_000)) {
							throw new Error('Unrecognised WKT');
						}
						return [{ wkt: 'POLYGON((-1.7 52.3, -1.3 52.3, -1.3 52.7, -1.7 52.7, -1.7 52.3))' }];
					}
					return ['a1', 'a2', 'h1'].map((id) => ({ id, geometryWkt: 'POINT(-1.5 52.5)' }));
				}),
				consulteeArea: { findMany: mock.fn(async () => []) },
				caseBoundary: { findMany: mock.fn(async () => []) }
			},
			logger,
			nearbySearchRadiusMetres: 20_000,
			nearbyNsipRadiusMetres: 0
		};
		const report = await buildReportZip({
			service: service as never,
			project: PROJECT,
			ruleset: RULESET,
			consultees: [
				match('a1', 'Ambulance Trust', 'ambulance-near'),
				// only the nearby search found it - not in the report, so not drawn
				match('a2', 'Ambulance Trust'),
				match('h1', 'Hospital', 'ambulance-and-hospital')
			],
			selection: { removed: [], adds: [] },
			siteScreenedAs: 'boundingBox'
		});

		const files = unzipSync(new Uint8Array(report.contents));
		const ambulance = pdfTextLines(Buffer.from(files['maps/01 Ambulance Trust.pdf']));
		// its 1km buffer couldn't be drawn, so only its 10km one is keyed
		assert.ok(ambulance.includes('Ruleset buffer (10 km)'), ambulance.join('|'));
		assert.ok(!ambulance.some((line) => line.startsWith('Nearby')));
		assert.ok(pdfTextLines(Buffer.from(files['maps/02 Hospital.pdf'])).includes('Ruleset buffer (10 km)'));
		assert.strictEqual(logger.warn.mock.callCount(), 1);

		// each buffer grown once for the report, from the rectangle the run screened
		const buffers = queries.filter((values) => values.includes(1_000) || values.includes(10_000));
		assert.strictEqual(buffers.length, 2);
		assert.ok(
			buffers.every(([wkt]) => String(wkt) !== 'POLYGON((-1.6 52.4, -1.4 52.4, -1.4 52.6, -1.6 52.6, -1.6 52.4))')
		);
		// the nearby-only consultee's area is never looked up to draw
		const drawn = queries.filter((values) =>
			values.some((value) => typeof value === 'string' && /^[ah]\d$/.test(value))
		);
		assert.ok(drawn.length > 0);
		assert.ok(drawn.every((values) => !values.includes('a2')));
	});
});

describe('who generated a report', () => {
	it("is the signed-in user's name, else no one", () => {
		assert.strictEqual(reportGeneratedBy({ account: { name: ' Sam Officer ' } } as never), 'Sam Officer');
		assert.strictEqual(reportGeneratedBy({ account: { name: ' ' } } as never), undefined);
		assert.strictEqual(reportGeneratedBy({ account: {} } as never), undefined);
		assert.strictEqual(reportGeneratedBy({} as never), undefined);
		assert.strictEqual(reportGeneratedBy(undefined), undefined);
	});
});
