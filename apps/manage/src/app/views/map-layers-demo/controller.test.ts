import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';
import { buildMapLayersDemoPage } from './controller.ts';

describe('map layers demo page', () => {
	test('renders the demo view with layer summaries and map config', async () => {
		const handler = buildMapLayersDemoPage();
		const mockRes = {
			render: mock.fn()
		};

		await handler({} as never, mockRes as never);

		assert.equal(mockRes.render.mock.callCount(), 1);
		const [view, model] = mockRes.render.mock.calls[0].arguments as [
			string,
			{
				pageHeading: string;
				mapId: string;
				layerSummaries: unknown[];
				mapConfigJson: string;
			}
		];
		assert.equal(view, 'views/map-layers-demo/view.njk');
		assert.equal(model.pageHeading, 'Map layers demo');
		assert.equal(model.mapId, 'map-layers-demo');
		assert.equal(model.layerSummaries.length, 4);
		assert.match(model.mapConfigJson, /"railwayGeojson"/);
		assert.match(model.mapConfigJson, /"roadGeojson"/);
		assert.match(model.mapConfigJson, /Railway lines/);
	});
});
