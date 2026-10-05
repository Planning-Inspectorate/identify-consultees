import type { AsyncRequestHandler } from '@planning-inspectorate/core/util';
import type { Request } from 'express';
import {
	createGovukNunjucksEnvironment,
	getVisibleFixtures,
	loadComponentCatalogue,
	renderGovukComponent,
	scopeFixtureIds
} from '../../govuk-frontend-components.ts';
import type { ComponentDetailViewModel, ComponentsIndexViewModel } from './view-model.ts';

/**
 * "error-summary" -> "Error summary"
 */
function componentTitle(component: string): string {
	return component
		.split('-')
		.map((part, index) => (index === 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part))
		.join(' ');
}

/**
 * The "Components" nav item is gated behind ?components=true; keep the flag on
 * links within the section so it stays visible while browsing.
 */
function componentsQuerySuffix(req: Request): string {
	return req.query.components === 'true' ? '?components=true' : '';
}

/**
 * Index page listing every GOV.UK Frontend component shipped in the installed
 * version, linking to a rendered-examples page per component.
 */
export function buildComponentsIndexPage(): AsyncRequestHandler {
	const catalogue = loadComponentCatalogue();

	return async (req, res) => {
		const suffix = componentsQuerySuffix(req);

		const model: ComponentsIndexViewModel = {
			pageHeading: 'GOV.UK Frontend components',
			interactiveMapHref: `/components/interactive-map${suffix}`,
			components: catalogue.map((entry) => ({
				name: entry.component,
				title: componentTitle(entry.component),
				href: `/components/${entry.component}${suffix}`,
				exampleCount: getVisibleFixtures(entry).length
			}))
		};

		res.render('views/components/view.njk', model);
	};
}

/**
 * Rendered-examples page: every non-hidden fixture for one component, rendered
 * through the component's Nunjucks macro. Fixture ids are scoped per example so
 * repeated examples do not produce duplicate ids on the page.
 */
export function buildComponentDetailPage(): AsyncRequestHandler {
	const env = createGovukNunjucksEnvironment();
	const catalogue = loadComponentCatalogue();

	return async (req, res) => {
		const name = req.params.component;
		const entry = catalogue.find((item) => item.component === name);

		if (!entry) {
			res.status(404).render('views/errors/404.njk', { pageHeading: 'Page not found' });
			return;
		}

		const examples = getVisibleFixtures(entry).map((fixture, index) => ({
			name: fixture.name,
			html: scopeFixtureIds(renderGovukComponent(env, name, fixture.options), `${name}-${index}`)
		}));

		const model: ComponentDetailViewModel = {
			pageHeading: componentTitle(name),
			componentName: name,
			backLinkUrl: `/components${componentsQuerySuffix(req)}`,
			backLinkText: 'Back to components',
			examples
		};

		res.render('views/components/component.njk', model);
	};
}
