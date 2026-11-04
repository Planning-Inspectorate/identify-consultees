import assert from 'node:assert';
import { describe, it } from 'node:test';
import { configureNunjucks } from '../../nunjucks.ts';
import { helpViewModel } from './index.ts';

describe('help page', () => {
	it('lists every accepted wording, and names those with no data yet when there are any', () => {
		const nunjucks = configureNunjucks();
		const render = (model: ReturnType<typeof helpViewModel>) => nunjucks.render('views/help/view.njk', model);

		const awaiting = helpViewModel([
			{ wording: 'Ambulance Trusts', awaitingData: false },
			{ wording: 'Cheshire Brine Area', awaitingData: true }
		]);
		assert.deepStrictEqual(awaiting.consulteeTypeWordings, ['Ambulance Trusts', 'Cheshire Brine Area']);
		assert.deepStrictEqual(awaiting.awaitingDataWordings, ['Cheshire Brine Area']);
		assert.match(render(awaiting), /Cheshire Brine Area have no map data yet/);

		// none awaiting data - no note, rather than one naming nothing
		const none = helpViewModel([{ wording: 'Ambulance Trusts', awaitingData: false }]);
		assert.deepStrictEqual(none.awaitingDataWordings, []);
		assert.doesNotMatch(render(none), /have no map data yet/);
	});
});
