# Accessibility

This service must be accessible to everyone who needs to use it. Accessibility is a legal and
Service Standard requirement, not a polish step — build it in from the start of each change.

## Standard we work to

- **WCAG 2.2 level AA** is the minimum for every page and journey, as required by the
  [Service Manual](https://www.gov.uk/service-manual/helping-people-to-use-your-service/understanding-wcag)
  and the
  [Public Sector Bodies (Websites and Mobile Applications) (No. 2) Accessibility Regulations 2018](https://www.gov.uk/guidance/make-your-website-or-app-accessible-and-publish-an-accessibility-statement).
- Meeting WCAG 2.2 AA also satisfies Service Standard point 5 ("make sure everyone can use the
  service") alongside assistive-technology support and research with disabled users.

## Authoritative guidance

| Source                                                                                                                                                                 | Use it for                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| [Service Manual — making your service accessible](https://www.gov.uk/service-manual/helping-people-to-use-your-service/making-your-service-accessible-an-introduction) | What "accessible" means across the service lifecycle  |
| [Service Manual — understanding WCAG 2.2](https://www.gov.uk/service-manual/helping-people-to-use-your-service/understanding-wcag)                                     | The success criteria we must meet                     |
| [Service Manual — testing for accessibility](https://www.gov.uk/service-manual/helping-people-to-use-your-service/testing-for-accessibility)                           | How and when to test, audit requirements              |
| [GOV.UK Design System](https://design-system.service.gov.uk/)                                                                                                          | Components and patterns that meet WCAG 2.2 by default |
| [Accessibility statements guidance](https://www.gov.uk/guidance/make-your-website-or-app-accessible-and-publish-an-accessibility-statement)                            | Statement content and legal duties                    |

## How we build

- **GOV.UK Frontend macros for all interactive UI.** Components like `govukButton`, `govukInput`,
  `govukRadios`, `govukErrorSummary`, and `govukTable` carry correct semantics, focus styles, and
  ARIA out of the box. Do not hand-roll equivalents — see the GDS section of [AGENTS.md](./AGENTS.md).
- **Semantics first.** Landmarks, exactly one logical `h1`, headings in order, lists for lists,
  tables only for tabular data.
- **Forms.** Every control has a programmatic label; hints and errors are associated
  (`aria-describedby` via the macros); error summaries link to fields; never rely on placeholder
  text as a label.
- **Keyboard.** Every action is reachable and operable by keyboard alone, with visible focus and
  no traps. The skip link must move focus to the main content.
- **Colour and meaning.** Never convey information by colour alone — pair colours with text,
  icons, or patterns (this applies especially to map legends and hatches).
- **Content.** Plain English, short sentences, descriptive link text ("view the boundary for X",
  not "click here"), meaningful page titles.
- **Progressive enhancement.** Core journeys work without JavaScript; the static-map fallback and
  `<noscript>` patterns in the manage app exist for this reason.

### WCAG 2.2 criteria worth an explicit check

These are newer or commonly missed — verify them on any UI change:

- **2.4.11 Focus not obscured** — sticky headers/cookie banners must not hide the focused element.
- **2.5.7 Dragging movements** — drag-only interactions (map drawing, reordering) need a
  single-pointer or alternative input path.
- **2.5.8 Target size** — interactive targets at least 24×24 CSS px or adequately spaced.
- **3.2.6 Consistent help** — help/contact mechanisms stay in the same place across pages.
- **3.3.7 Redundant entry** — do not ask for information the user already gave us.
- **3.3.8 Accessible authentication** — no cognitive-function tests (memory puzzles, transcription)
  as the only login path.

## Maps and geospatial content

Maps are a known accessibility risk area — treat them with extra care:

- Give the interactive map container an accessible name (`aria-label`/role) describing its purpose.
- Ensure essential map information has a non-map route: the numbered-badge + GOV.UK table pattern
  used on the showcase pages is the model — spatial data should also be available as a list or table.
- The static-map fallback needs `alt` text describing the map's purpose (not "map of…" alone if the
  meaning is the features shown).
- Legend swatches must not rely on colour alone — use the hatch patterns and labels defined in the
  GIS Tool Styling tables in [AGENTS.md](./AGENTS.md).
- Do not leave drawing as the only way to complete a task — provide a text alternative (for example
  searching or selecting from a list).

## Testing before merge

Minimum habit for any UI change:

1. **Automated** — keep the axe checks green: `pages.a11y.test.ts` (unit) and the Playwright a11y
   project (e2e). Add coverage when adding pages. See
   [`docs/frontend-testing.md`](./docs/frontend-testing.md).
2. **Keyboard pass** — complete the changed journey with Tab / Shift+Tab / Enter / Space / arrows only.
3. **Zoom and reflow** — check at 400% zoom and a narrow viewport; no horizontal scroll or lost content.
4. **Screen reader spot check** — VoiceOver (macOS) on anything new involving dynamic regions, error
   summaries, tables with controls, or the map.

Automated tools catch roughly a third of real issues — the manual checks are not optional.

## Audit and accessibility statement

- A **formal accessibility audit is required before public beta** — it provides the evidence for the
  beta assessment and the statement.
- The service must publish an **accessibility statement** when it moves into public beta, using the
  [GDS model statement](https://www.gov.uk/guidance/model-accessibility-statement). It must say how
  accessible the service is, list any known issues, explain how to get accessible alternatives, give
  a contact route for problems, and mention the EHRC/ECNI enforcement route.
- Keep the statement accurate — review it on a regular cycle and after any significant UI change.

## When you find an issue

Fix it in the change that introduces or touches it where practical. If a fix is disproportionate,
record it so it can be triaged and reflected in the accessibility statement — do not silently ship
known barriers.

## Related documents

- [AGENTS.md](./AGENTS.md) — GDS design/frontend rules, Service Standard checklist, map styling
- [`kt-docs/accessibility-and-quality.md`](./kt-docs/accessibility-and-quality.md) — engineering checklist and quality gates
- [`docs/frontend-testing.md`](./docs/frontend-testing.md) — test matrix including the a11y projects
- [CONTRIBUTING.md](./CONTRIBUTING.md) — contribution workflow
