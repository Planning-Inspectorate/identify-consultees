# Accessibility and quality

**Status:** Current expectations; Partial against a formal WCAG audit of every future page.

## Target

Aim for **WCAG 2.2 AA** behaviour on manage journeys, using GOV.UK Frontend as the default control set.

This is a public-sector service shape even while still a spike — accessibility is not optional polish.

## Practical checklist

| Area          | Expectation                                                                                     |
| ------------- | ----------------------------------------------------------------------------------------------- |
| Semantic HTML | Landmarks, one logical `h1`, ordered headings                                                   |
| Components    | GOV.UK macros for interactive controls                                                          |
| Keyboard      | All actions reachable; visible focus; skip link works                                           |
| Forms         | Labels/hints/errors associated correctly                                                        |
| Maps          | Region `aria-label`; static map `alt` describes purpose; do not rely on colour alone in legends |
| Motion / JS   | Core content available without JavaScript                                                       |
| Language      | Plain English; avoid internal jargon in user-visible strings                                    |

## Screen-reader and keyboard testing

Minimum engineer habit before merging UI changes:

1. Keyboard-only pass of the changed journey (Tab / Shift+Tab / Enter / Space)
2. Check axe results in unit (`pages.a11y.test.ts`) and Playwright a11y project
3. Spot-check with a screen reader when changing map regions, tables with radios, or error summaries (VoiceOver on macOS is the usual local option)

## No-JavaScript fallbacks

- Homepage search and selection are plain forms
- Consultees maps include `<noscript>` static images and hint text
- Do not introduce client-only navigation for critical steps without an HTML equivalent

## Quality bars beyond a11y

- ESLint + Prettier on TS/JS
- Typecheck (`npm run check-types`)
- Manage frontend coverage gate at 100% lines/functions/branches for `apps/manage/src/**` (with documented exclusions)
- Prefer Design System patterns over custom CSS

## Related pages

- [ACCESSIBILITY.md](../ACCESSIBILITY.md) — the repo accessibility policy this checklist supports
- [GOV.UK Frontend conventions](./govuk-frontend-conventions.md)
- [Testing](./testing.md)
