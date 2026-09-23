# Agent guidance

This file is the single source of truth for agent instructions in this repository. [`CLAUDE.md`](./CLAUDE.md) points here.

## GitHub and pull request practices (PINS)

PINS expects specific GitHub practices on their repos. Follow these for every PR in this project (and when preparing a branch for review).

### Requirements

| Requirement                    | What it means here                                                                                                                                                                      |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linear history                 | Prefer a straight line of commits on the PR branch (rebase onto `main`; avoid merge commits from `main` into the feature branch).                                                       |
| Squashed commits before review | Before requesting or refreshing review, squash noisy WIP / fixup commits so the PR presents a clean, reviewable history (often one commit per logical change, or a small coherent set). |
| Semantic commit messages       | Use Conventional Commits-style subjects, e.g. `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`, `perf:`, `ci:`. Imperative mood; explain the why in the body when needed.       |

Do not open or hand over a PR for review with a messy stack of “wip”, “fix typo”, or merge-from-main commits. Clean the history first.

### Cleaning history before review

When the feature branch has diverged or accumulated noise:

1. Update local `main`: `git fetch origin` then ensure `main` is current.
2. Rebase the feature branch onto `main` and squash/fix commits with an interactive rebase, e.g. `git rebase -i main` (mark commits as `pick` / `squash` / `fixup` / `reword` as needed).
3. Resolve any conflicts, finish the rebase, then update the remote feature branch with `git push --force-with-lease` (never plain `--force` unless explicitly required and understood).

`git rebase -i main` + `git push --force-with-lease` is the expected combination for fixing PR history after a rebase or squash. Agents must be able to use both when preparing or repairing a PR branch.

**Non-interactive squash alternative** (when interactive rebase is unavailable in the environment): soft-reset to the merge-base with `main`, then create one (or a few) semantic commit(s), then `git push --force-with-lease`. Prefer that over leaving WIP history on a review-ready PR.

### Agent rules for PRs

- Before creating or updating a PR for review: rebase onto latest `main`, squash to a clean history, ensure commit messages are semantic, then push with `--force-with-lease` if history was rewritten.
- Prefer rebasing the feature branch onto `main` over merging `main` into the feature branch.
- `--force-with-lease` is allowed on feature / PR branches only, and only after an intentional history rewrite (rebase/squash).
- Still never force-push `main` (or `master`).
- Still only commit / push / open PRs when the user asks (or existing user rules already authorize that step); when they do, apply the practices above.
- Do not identify as an AI (or name a model/product) in any GitHub-visible surface: PR titles/bodies, commit messages, code comments, docs, issue comments, review comments, or other repo content. Write as a normal human contributor.

### PR description checklist

When opening a PR with `gh pr create` (user-requested):

- [ ] Branch is based on current `main` with linear, squashed history.
- [ ] Commit subjects are semantic (`feat:` / `fix:` / `docs:` / …).
- [ ] Summary explains the change or outcome; test plan is concrete.
- [ ] No secrets, `.env`, or production data dumps in the diff.
- [ ] No AI self-identification in the PR description, commits, or diff.

## Building a GDS-compliant government service

This service is a public-sector product. Features, UI, and technical choices should align with GDS guidance. Prefer existing GOV.UK patterns already used in this repo over inventing new ones.

### Authoritative sources

| Source                                                                                     | Use it for                                                                        |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| [GOV.UK Design System](https://design-system.service.gov.uk/)                              | Styles, components, patterns, accessibility, and frontend implementation          |
| [Service Manual](https://www.gov.uk/service-manual)                                        | How to design, build, and run services (agile, research, technology, assessments) |
| [Service Standard](https://www.gov.uk/service-manual/service-standard)                     | The 14 points a good government service must meet                                 |
| [Technology Code of Practice](https://www.gov.uk/guidance/the-technology-code-of-practice) | Criteria for designing, building, and buying technology                           |

Read the relevant guidance before proposing or implementing user-facing or architectural changes. Do not invent bespoke UI when a Design System component or pattern exists.

### GOV.UK Design System

When changing UI or frontend behaviour:

- **HTML must come from GOV.UK Frontend macros only.** Build page markup with Nunjucks macros from `govuk-frontend` (for example `govukButton`, `govukInput`, `govukSelect`, `govukTable`, `govukRadios`, `govukPhaseBanner`). Do not hand-write equivalent component HTML. This maximises accessibility, GDS compliance, and web performance (consistent markup, shared assets, and fewer bespoke patterns).
- **Header / footer chrome:** Prefer GOV.UK Frontend macros plus `apps/manage/src/app/sass/govuk-overrides.scss` for PINS branding. Use `govukGenericHeader` (not `govukHeader`) with the PINS landscape logo, and `govukServiceNavigation`. Use `pinsFooter` from `@planning-inspectorate/core` for the footer — there is no GOV.UK generic footer, and `govukFooter` is only for services on GOV.UK (Frontend 6).
- Layout wrappers that use Design System classes (for example `govuk-grid-row`, `govuk-width-container`, `govuk-heading-*`) and plain content text are fine; interactive and presentational UI components must still be macros.
- Prefer documented components (for example button, error summary, text input, radios, table, notification banner) and [patterns](https://design-system.service.gov.uk/patterns/) (for example question pages, check answers, validation errors).
- Follow Design System guidance for labels/legends, error messages, focus states, and typography — do not restyle GOV.UK components to look “custom”.
- Keep pages accessible by default: correct heading order, accessible names, keyboard operation, and visible focus. Treat accessibility as a requirement, not a polish step.
- Prototype and production guidance on the Design System site applies; this manage app is a production-style service, not a one-off prototype.

### Service Standard (apply when building features)

Use these points as a practical checklist for product and engineering work. Fuller detail: [Service Standard](https://www.gov.uk/service-manual/service-standard).

1. **Understand users and their needs** — design from user research and real tasks, not internal process alone.
2. **Solve a whole problem for users** — end-to-end journeys; avoid fragmented half-solutions.
3. **Joined-up experience across channels** — consistent language and outcomes where users also use other channels.
4. **Make the service simple to use** — plain language, clear questions, progressive disclosure.
5. **Make sure everyone can use the service** — WCAG-oriented UI, inclusive content, assisted digital considerations where relevant.
6. **Multidisciplinary team** — changes should be explainable to design, content, and ops — not only engineers.
7. **Agile ways of working** — small increments; ship thin vertical slices.
8. **Iterate and improve frequently** — prefer reversible releases and feedback loops over big-bang redesigns.
9. **Secure service that protects privacy** — authz, least privilege, safe handling of personal data; see also TCoP security/privacy points.
10. **Define success and performance data** — consider how success will be observed when adding significant journeys.
11. **Choose the right tools and technology** — reuse existing stack and platform choices in this monorepo unless there is a clear need to change.
12. **Make new source code open** — this repo is public; do not commit secrets, personal data, or non-disclosable material.
13. **Use and contribute to open standards, common components and patterns** — Design System, shared PINS packages, open standards over one-offs.
14. **Operate a reliable service** — health checks, logging, sensible failure modes, and supportable config.

### Technology Code of Practice (engineering defaults)

Align technical decisions with the [Technology Code of Practice](https://www.gov.uk/guidance/the-technology-code-of-practice), especially:

- **User needs first** — technology serves the journey, not the other way around.
- **Accessible and inclusive** — infrastructure and interfaces must not exclude users.
- **Open source and open standards** — prefer open libraries and interoperable formats already accepted in government.
- **Cloud first** — stay consistent with the existing Azure / cloud deployment model unless directed otherwise.
- **Secure by design** — threat-aware defaults, dependency hygiene, no secrets in git.
- **Privacy integral** — minimise personal data; do not log sensitive payloads.
- **Share, reuse, collaborate** — reuse `@planning-inspectorate/core`, GOV.UK Frontend, and existing patterns before adding new frameworks.
- **Integrate and adapt** — fit the monorepo (`apps/*`, `packages/*`) and existing pipelines.
- **Sustainable and supportable** — simple, documented, testable changes over clever abstractions.
- **Meet the Service Standard** — TCoP point 13: service work must still satisfy the Service Standard above.

### Service Manual (delivery context)

Use the [Service Manual](https://www.gov.uk/service-manual) for wider delivery topics when relevant to the task: accessibility and assisted digital, agile delivery, design, measuring success, service assessments, technology, team working, and user research. If a change would affect assessment posture (accessibility, security, reliability, openness), call that out in the PR summary.

### Agent checklist for GDS-aligned changes

Before implementing or opening a PR that affects users or architecture:

- [ ] Checked Design System for an existing component/pattern before adding custom UI.
- [ ] Page HTML uses GOV.UK Frontend macros only for UI components (no hand-rolled component markup).
- [ ] Used existing GOV.UK Frontend / Nunjucks patterns already in this codebase where possible.
- [ ] Content is plain language; errors follow Design System error patterns.
- [ ] Accessibility considered (semantics, focus, contrast via Design System defaults, keyboard use).
- [ ] Security and privacy considered (auth, validation, data minimisation, no secrets).
- [ ] Reused shared packages/patterns rather than introducing a parallel stack.
- [ ] PR summary notes any Service Standard / TCoP impact when material.
