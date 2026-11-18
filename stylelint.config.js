import { stylelintConfig } from '@planning-inspectorate/coding-standards';

export default {
	...stylelintConfig,
	overrides: [
		{
			// Overrides of third-party component classes belong in govuk-overrides.scss,
			// which style.scss @use's after the govuk index so equal-specificity rules
			// win on source order. Root-level selectors starting with a govuk-/moj-
			// class are only allowed there; classes nested under our own components
			// (inside-block) are untouched, as are non-class selectors like
			// [aria-sort] button. Vendor classes without a prefix (e.g.
			// .autocomplete__menu) can't be matched this way - the same placement
			// rule is documented in AGENTS.md.
			files: ['apps/manage/src/app/sass/*.scss'],
			rules: {
				'selector-disallowed-list': [
					/^\.(govuk|moj)-/,
					{
						ignore: ['inside-block'],
						splitList: true,
						message: 'Overrides of third-party component classes belong in govuk-overrides.scss'
					}
				]
			}
		},
		{
			files: ['apps/manage/src/app/sass/govuk-overrides.scss'],
			rules: { 'selector-disallowed-list': null }
		}
	]
};
