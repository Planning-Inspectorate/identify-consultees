# Agent guidance

This file is the single source of truth for agent instructions in this repository. [`CLAUDE.md`](./CLAUDE.md) and [`.github/copilot-instructions.md`](./.github/copilot-instructions.md) point here.

## Where guidance lives

Keep instructions in one place and link to them — do not repeat the same rules across files.

| Location                                                                                                                  | Role                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md` (this file)                                                                                                   | Single source of truth for agent rules and repo conventions                                                       |
| [`CLAUDE.md`](./CLAUDE.md), [`.github/copilot-instructions.md`](./.github/copilot-instructions.md), `.cursor/rules/*.mdc` | Thin pointers back to this file — add scoped detail here, not in the pointers                                     |
| `.devin/skills/*/SKILL.md`                                                                                                | Task-specific skills (for example `dependency-update-check` for green-pipeline checks before dependency updates)  |
| [`ACCESSIBILITY.md`](./ACCESSIBILITY.md)                                                                                  | Accessibility policy: WCAG 2.2 AA, testing, audit and statement duties                                            |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md)                                                                                    | Human-facing contribution workflow                                                                                |
| [`docs/`](./docs/), [`kt-docs/`](./kt-docs/README.md)                                                                     | Procedural and onboarding detail linked from the relevant sections below                                          |
| [`config/`](./config/README.md)                                                                                           | What the service does, not how: rulesets, map styles, nearby distances. Edit these, not code, to change behaviour |

When adding new guidance: put the rule here (or in a linked doc it points to), reference it from the
pointers/skills, and do not copy the content between files.

## AI agent identification and co-authorship

AI agents working on this repository must not identify themselves as AI or co-authors in any repository-visible content. All contributions should appear as normal human contributions.

### Required rules for all AI agents

- **Do not identify as an AI** in any GitHub-visible surface: PR titles/bodies, commit messages, code comments, documentation, issue comments, review comments, or other repo content.
- **Do not add AI co-author tags** in commit messages (e.g., `Co-Authored-By: AI <...>`).
- **Do not include AI attribution** in documentation files, README, or code comments.
- **Do not reference AI tools or models** in user-facing documentation or code.
- **Write as a normal human contributor** — the output should be indistinguishable from work done by a human team member.

### IDE and editor settings

To prevent IDE AI features from automatically adding co-authorship metadata:

- The `.vscode/settings.json` file includes settings to disable AI co-author features where possible.
- Disable AI-powered commit message generation and co-author attribution in your editor.
- Do not configure automated AI co-authorship trailers in git hooks or editor extensions.

### Rationale

This policy ensures:

- Repository history and documentation remain clean and professional.
- External reviewers and users see contributions as team work, not AI-generated.
- Compliance with government service standards that expect human accountability for code and documentation.
- Avoidance of AI-generated content appearing in official public-sector repositories.

## GitHub and pull request practices (PINS)

PINS expects specific GitHub practices on their repos. Follow these for every PR in this project (and when preparing a branch for review).

### Requirements

| Requirement                    | What it means here                                                                                                                                                                                                                                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No direct changes to `main`    | Merging or pushing directly to `main` is not possible or recommended — every change lands through a pull request on a feature branch, reviewed before merge.                                                                                                                        |
| Descriptive branch names       | Name the branch after the change it makes, using the Conventional Commit type as a prefix: `feat/`, `fix/`, `docs/`, `chore/`, `ci/`, `perf/`, `test/` + a short kebab-case description (e.g. `feat/real-ruleset-engine`, `fix/auth-rate-limiting`, `docs/react-preact-peer-deps`). |
| Linear history                 | Prefer a straight line of commits on the PR branch (rebase onto `main`; avoid merge commits from `main` into the feature branch).                                                                                                                                                   |
| Squashed commits before review | Before requesting or refreshing review, squash noisy WIP / fixup commits so the PR presents a clean, reviewable history (often one commit per logical change, or a small coherent set).                                                                                             |
| Semantic commit messages       | Use Conventional Commits-style subjects, e.g. `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`, `perf:`, `ci:`. Imperative mood; explain the why in the body when needed.                                                                                                   |
| Comprehensive PR summary       | The PR body must let a reviewer understand the change without reading the diff: what changed and why, the advantages, any disadvantages or trade-offs, and the risks (see the PR description checklist below).                                                                      |

Do not open or hand over a PR for review with a messy stack of “wip”, “fix typo”, or merge-from-main commits. Clean the history first.

### Cleaning history before review

When the feature branch has diverged or accumulated noise:

1. Update local `main`: `git fetch origin` then ensure `main` is current.
2. Rebase the feature branch onto `main` and squash/fix commits with an interactive rebase, e.g. `git rebase -i main` (mark commits as `pick` / `squash` / `fixup` / `reword` as needed).
3. Resolve any conflicts, finish the rebase, then update the remote feature branch with `git push --force-with-lease` (never plain `--force` unless explicitly required and understood).

`git rebase -i main` + `git push --force-with-lease` is the expected combination for fixing PR history after a rebase or squash. Agents must be able to use both when preparing or repairing a PR branch.

**Non-interactive squash alternative** (when interactive rebase is unavailable in the environment): soft-reset to the merge-base with `main`, then create one (or a few) semantic commit(s), then `git push --force-with-lease`. Prefer that over leaving WIP history on a review-ready PR.

### Agent rules for PRs

- Never push or merge directly to `main` — always open a new pull request from a feature branch.
- Choose a branch name that reflects the changes: `<type>/<short-kebab-case-description>` using the Conventional Commit type (e.g. `feat/interactive-map-examples`, `fix/azure-playwright-e2e-ci`, `chore/pin-npm-dependencies-policy`).
- Before creating or updating a PR for review: rebase onto latest `main`, squash to a clean history, ensure commit messages are semantic, then push with `--force-with-lease` if history was rewritten.
- Before opening a PR, verify the branch the way the pipeline will (see "Verifying changes before opening a PR" below): 100% of the tests pass — old and new code — and every linting and coverage check CI runs passes too. This minimises builds failing in the pipeline.
- Prefer rebasing the feature branch onto `main` over merging `main` into the feature branch.
- `--force-with-lease` is allowed on feature / PR branches only, and only after an intentional history rewrite (rebase/squash).
- Still never force-push `main` (or `master`).
- Still only commit / push / open PRs when the user asks (or existing user rules already authorize that step); when they do, apply the practices above.
- When the request that started the work names a JIRA ticket (e.g. `GIS-159`), always mention it in the PR body and link it (`https://pins-ds.atlassian.net/browse/<TICKET-ID>`), so the change can be tracked and tested against the ticket.
- Follow the AI identification rules above: do not identify as an AI or add AI co-authorship in any GitHub-visible content.
- Devin: pass the PR body to `gh pr create` with `--body-file <file>` — write it to a scratch file first. Inline heredocs (`--body "$(cat <<'EOF' … EOF)"`) get mangled by Devin's shell quoting and break the command. Other agents can use whatever works for them.

### Verifying changes before opening a PR

Before a PR is opened or handed over for review, run the same checks the pipeline runs (`.azure/pipelines/pr.yml`) and make sure they all pass — the tests, on old and new code alike, and every linting and coverage gate. A PR that fails CI on its first build wastes a pipeline run and delays review.

- `npm run check-types && npm run lint && npm run format-prettier-check` — the static checks.
- `npm run build` (in `apps/manage`) — the app must still build.
- `npm run test-coverage` — every test passes, with hard 100% line/function/branch coverage gates across the JavaScript codebase: `test:packages-coverage` covers `packages/database/src` and `scripts/*.ts`, and the run ends with the manage app's gate (`apps/manage/scripts/run-frontend-coverage.mjs`). A green `node --test` run alone does not prove the gates pass, and new code needs tests that cover it.
- `npm run commitlint` — confirms the commit subjects are Conventional Commits.
- `apps/function-python` changes: `python3 -m ruff check .` and `python3 -m pytest --cov --cov-fail-under=100` there — the same 100% statement gate as the JavaScript suites.

`test-coverage` needs the local database and Playwright browsers set up (see CONTRIBUTING.md). If the pipeline still fails, [`docs/azure-devops-ci-logs.md`](./docs/azure-devops-ci-logs.md) explains how to pull the failing step's log.

### PR description checklist

When opening a PR with `gh pr create` (user-requested), the body must include comprehensive summary notes:

- **What changed** — the change or outcome, at a level a reviewer can grasp without reading the diff.
- **Advantages** — what this improves or unblocks.
- **Disadvantages / trade-offs** — costs, complexity, or anything intentionally deferred.
- **Risks** — what could go wrong, rollout/rollback notes, and any Service Standard / TCoP impact when material.
- **Test plan** — concrete steps a reviewer can run or verify.

And mechanically:

- [ ] Branch name reflects the change (`<type>/<kebab-case-description>`).
- [ ] Branch is based on current `main` with linear, squashed history.
- [ ] Commit subjects are semantic (`feat:` / `fix:` / `docs:` / …).
- [ ] Any JIRA ticket named in the request is mentioned and linked in the PR body.
- [ ] No secrets, `.env`, or production data dumps in the diff.
- [ ] No AI self-identification in the PR description, commits, or diff.
- [ ] All tests and the CI checks (lint, typecheck, format, coverage) pass locally — see "Verifying changes before opening a PR".

## Node and npm toolchain (match Azure Pipelines)

Local installs must use the **same Node major and npm** as CI so `package-lock.json` stays compatible with `npm ci`. We pin the **major version only** — minor and patch releases float to the latest automatically, so routine Node releases need no repo change.

| Tool    | Required version                    | Where it is pinned                                                                                                                                               |
| ------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js | **24.x** (current LTS), `>=24.22.1` | `.nvmrc`, `.node-version`, `.tool-versions` (`24`), `package.json` `engines.node` `^24.22.1`, Azure `nodeVersion: 24`, `apps/manage/Dockerfile` `node:24-alpine` |
| npm     | **11.x+** (bundled)                 | `engines.npm` is a `>=11` floor only — npm ships with Node 24 and is never patch-pinned                                                                          |

Azure jobs use PINS `node_script.yml` with `nodeVersion: 24` (see `.azure/pipelines/pr.yml` and `infrastructure/pipelines/terraform-ci-commit.yaml`). The template runs `nvm use 24`, which resolves to the newest 24.x **preinstalled on the agent image** — that can lag upstream releases, so each `npm ci` step first sources `scripts/ci-use-latest-node.sh`, which installs the true latest into a job-private nvm dir when the preinstalled one fails `check-toolchain` (the pool's shared `/usr/local/nvm` makes `nvm install` race on a lock and may not be agent-writable).

### Agent rules for the toolchain

- Pin majors, not patches: `.nvmrc`, `.node-version`, `.tool-versions`, the Dockerfile base tag, and Azure `nodeVersion` all resolve to the **latest 24.x**; `engines.node` `^24.22.1` enforces the same range with a security floor — `>=24.22.1` patches in the October 2026 security release (<https://nodejs.org/en/blog/vulnerability/october-2026-security-releases>), everything above still floats. Only major/LTS bumps or new security floors should touch these files — never pin an exact patch (it forces a repo change per Node release and causes EBADENGINE drift against the floating tags).
- Do **not** re-add a `packageManager` field or an exact `engines.npm` — pinning a specific npm defeats the float-above and, under corepack, can force an npm that doesn't match Node's bundled one.
- Before changing dependencies or regenerating the lockfile: `nvm use` (or equivalent) so Node is **24.x** with its bundled **npm 11.x**. Do **not** regenerate `package-lock.json` under a different Node/npm major.
- Prefer `npm ci` for a clean tree (same command as CI). Use `npm install` only when intentionally updating dependencies.
- After any `package-lock.json` change, run `npm run check-toolchain` (also runs at the end of `postinstall`). It validates the running Node/npm against the `engines` ranges — not exact versions.
- Keep root `optionalDependencies` on `react@19.3.0`, `react-dom@19.3.0`, and `scheduler@0.28.0`. They are not used by app code; they satisfy Prisma Studio / Radix peers so Azure `npm ci` does not fail with “Missing: react@… from lock file” (see PR #53 / commit `2e4f99d`). Never remove those entries or the matching `node_modules/react` (etc.) lockfile packages without replacing the guard.
- `.npmrc` sets `engine-strict=true` and `legacy-peer-deps=false` (Azure default). Do not enable `legacy-peer-deps` locally — it hides the `preact` 8 vs 10 peer conflict (`accessible-autocomplete` vs `@defra/interactive-map`) that breaks Azure `npm ci`.
- Keep the root `overrides.preact` on `^10.29.8` so that conflict resolves to Defra’s preact 10 line in the lockfile.
- Keep `prisma` (the CLI dev-dependency) and the `@prisma/*` runtime packages on the **same major** — the `prisma` Dependabot group in `.github/dependabot.yml` exists to move them together. Do not bump the CLI alone, and do not take prerelease (`-rc`, `-next`) versions: Prisma 8 rewrites the CLI surface (`migrate dev`/`migrate deploy`, `generate`, `db seed` no longer exist), which breaks `db-migrate-dev`/`db-migrate-prod` locally and the `npm run db-migrate-prod` steps in `.azure/pipelines/pr.yml`. A major Prisma bump needs the scripts and docs updated in the same change.
- Emergency bypass only: `SKIP_TOOLCHAIN_CHECK=1` (do not use for normal PR work).

### Why React and Preact appear in `package.json`

No application code imports React or Preact — the manage UI is GOV.UK Frontend Nunjucks macros plus vanilla JS only. These entries are transitive peer-dependency plumbing that `npm ci` needs:

| Entry                                                      | Why it exists                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `optionalDependencies` → `react`, `react-dom`, `scheduler` | Required (non-optional) peer deps of `@prisma/studio-core` — pulled in by the `prisma` CLI for `prisma studio` — and of the `@visx/*` / `@radix-ui/*` packages it brings. Pinning them keeps `node_modules/react` (etc.) in the lockfile so Azure `npm ci` does not fail with “Missing: react@… from lock file” (PR #53 / commit `2e4f99d`). |
| `overrides.preact` → `^10.29.8`                            | `@defra/interactive-map` ships Preact-compiled code (`preact` is a real dependency of the map). `accessible-autocomplete` declares an optional `preact@^8` peer; the override keeps resolution on the Defra v10 line.                                                                                                                        |
| `node_modules/preact` in the lockfile                      | Satisfies `@defra/interactive-map` at runtime — the interactive map component genuinely runs on Preact.                                                                                                                                                                                                                                      |

Do not remove these entries as a “cleanup” — they are enforced by `scripts/check-toolchain.mjs` and removing them breaks Azure `npm ci`. They can only go if the underlying dependencies (`prisma` CLI, `@defra/interactive-map`, `accessible-autocomplete`) are removed, which is an architecture decision, not a tidy-up.

### Switching locally

```bash
nvm install   # reads .nvmrc → latest Node 24.x
nvm use
node -v       # v24.x.y
npm -v        # 11.x (bundled with Node 24)
npm ci
npm run check-toolchain
```

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

- **Prefer `@planning-inspectorate/core` components first, then GOV.UK Frontend.** When a shared component exists in `@planning-inspectorate/core` (for example `pinsHeader`, `pinsFooter` under `ui/`), use it ahead of assembling the equivalent from `govuk-frontend` parts or local markup. Fall back to GOV.UK Frontend Nunjucks macros (for example `govukButton`, `govukInput`, `govukSelect`, `govukTable`, `govukRadios`, `govukPhaseBanner`) where no core component exists. A packaged component always takes precedence over custom HTML and CSS: never hand-write a component's markup, copy its rendered output, or restyle it from scratch — component upgrades and accessibility fixes land with the package bump, while a copied equivalent drifts. This maximises accessibility, GDS compliance, upgradability, and web performance (consistent markup, shared assets, and fewer bespoke patterns).
- **Header / footer chrome:** Use `pinsHeader` and `pinsFooter` from `@planning-inspectorate/core` for PINS-branded chrome — their styles come from core's `ui/header`/`ui/footer` Sass, pulled in via `apps/manage/src/app/sass/govuk-overrides.scss`. Pair with `govukServiceNavigation` for the navigation. Do not use `govukHeader`/`govukFooter` — GOV.UK Frontend 6 reserves those for services on GOV.UK.
- Layout wrappers that use Design System classes (for example `govuk-grid-row`, `govuk-width-container`, `govuk-heading-*`) and plain content text are fine; interactive and presentational UI components must still be macros.
- Prefer documented components (for example button, error summary, text input, radios, table, notification banner) and [patterns](https://design-system.service.gov.uk/patterns/) (for example question pages, check answers, validation errors).
- **Never pre-select radios (or checkboxes) the user hasn't answered.** The Design System's [radios guidance](https://design-system.service.gov.uk/components/radios/) says not to pre-select an option — users then miss the question or submit the wrong answer. Only mark an input `checked` to re-show an answer the user has already given (for example a choice carried back through a check-answers "Change" link). A required question submitted with no selection re-renders with a GDS error summary and inline `errorMessage` — do not silently default, redirect, or guess.
- Follow Design System guidance for labels/legends, error messages, focus states, and typography — do not restyle GOV.UK components to look “custom”.
- **Never write `!important` in authored Sass/CSS.** It escalates specificity and blocks every later override. `npm run lint-css` enforces this — the shared `@planning-inspectorate/coding-standards` stylelint config sets `declaration-no-important`. To win a cascade conflict: prefer the Design System's `govuk-!-*` override classes in markup, raise specificity with a proper BEM selector, or rely on source order (`govuk-overrides.scss` imports after `govuk-frontend`, so equal-specificity rules there already win).
- Keep pages accessible by default: correct heading order, accessible names, keyboard operation, and visible focus. Treat accessibility as a requirement, not a polish step — the policy and testing expectations are in [ACCESSIBILITY.md](./ACCESSIBILITY.md).
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
- [ ] Page HTML uses GOV.UK Frontend macros only for UI components (no hand-rolled component markup or styles — a packaged component takes precedence over a local equivalent).
- [ ] Used existing GOV.UK Frontend / Nunjucks patterns already in this codebase where possible.
- [ ] Content is plain language; errors follow Design System error patterns.
- [ ] Radios/checkboxes are never pre-selected; a `checked` state only reflects an answer the user already gave, and an unanswered required question fails validation with an error summary.
- [ ] Accessibility considered per [ACCESSIBILITY.md](./ACCESSIBILITY.md) (WCAG 2.2 AA: semantics, focus, contrast via Design System defaults, keyboard use).
- [ ] Security and privacy considered (auth, validation, data minimisation, no secrets).
- [ ] Reused shared packages/patterns rather than introducing a parallel stack.
- [ ] PR summary notes any Service Standard / TCoP impact when material.
- [ ] Static / tile map usage follows the caching rules in [`docs/maps.md`](./docs/maps.md) (no uncached hot-linking of OSM or commercial static image servers).
- [ ] Map overlay colours, fills, hatches, and label styling follow the GIS Styling tables in [`docs/maps.md`](./docs/maps.md).
- [ ] No `!important` in authored Sass/CSS — stylelint `declaration-no-important` fails the lint; use `govuk-!-*` override classes, BEM specificity, or source order instead.
- [ ] HTTP protocol changes follow the Front Door / origin guidance in [`docs/http-and-front-door.md`](./docs/http-and-front-door.md) (do not add experimental Node QUIC listeners).

## Maps (interactive and static)

"Map" unqualified means the **Defra interactive map**; "static map" or "non-interactive map" means the server-rendered image. The full rules — GIS Styling tables, static-map caching and size budgets, tile-server usage, and Defra integration gotchas — live in [`docs/maps.md`](./docs/maps.md); [`kt-docs/maps.md`](./kt-docs/maps.md) explains how the project maps are built. Hard rules, abbreviated:

- Never invent overlay colours, fills, or hatch patterns — use the GIS Styling tables in `docs/maps.md` and match legend/key swatches to the layer.
- Static maps are proxied and cached by our app; never hot-link tile hosts in page HTML/CSS/JS, and never put `data-*` attributes on the map container (the Defra constructor JSON-parses them).

## Linked operational docs

Procedural and reference material lives outside this file — linked here, not duplicated:

- [`docs/azure-devops-ci-logs.md`](./docs/azure-devops-ci-logs.md) — pulling a failing PR check's DevOps log (token or local reproduction).
- [`docs/http-and-front-door.md`](./docs/http-and-front-door.md) — HTTP/2, HTTP/3 and the Front Door → origin topology.
- [`docs/maps.md`](./docs/maps.md) — GIS Styling tables, static-map rules, Defra component gotchas.
- [`kt-docs/deployment.md`](./kt-docs/deployment.md) — pipelines, overlapping-deploy locking, and schema/data operations without redeploying the app.

## Asset fingerprinting and the local dev server

`npm run build` (`src/util/build.ts`) copies assets into `apps/manage/src/.static`, renames selected files with an 8-char content hash (`fingerprint-assets.ts`), writes Brotli `.br` sidecars, and rewrites the manifest values in `src/util/config-middleware.ts`.

- **Never hand-edit the hashes** in `config-middleware.ts` — run `npm run build` so the filename and manifest stay in sync.
- **Any change to a fingerprinted source file changes its hash.** The old filename is deleted from `.static`, so a running server that rendered a page earlier now references a file that no longer exists (`404` / `ERR_EMPTY_RESPONSE`). After editing files under `src/public/` or rerunning the build, restart the dev server — nodemon watches `src` and normally handles this.
- **Kill old localhost servers before starting new ones.** A leftover process keeps its port and keeps serving stale code and hash manifest, so never leave two running. `npm start`/`npm run dev` free the app port automatically (`scripts/kill-port.ts` runs as `prestart` in `apps/manage`, including on every nodemon restart), and the root `npm start` frees the Python function's `:7071` too. Starting `node src/server.ts` — or any other local server — directly skips that check: find and kill the old listener yourself (`node scripts/kill-port.ts <port>`, or `lsof -nP -iTCP:<port> -sTCP:LISTEN`). If the listener's parent is nodemon, stop the nodemon session instead: killing only its child makes nodemon respawn it and retake the port.
- **Stale servers render hybrid pages.** Controllers run from memory but Nunjucks views are read from disk per request, so a stale server pairs old view-models/routes with new templates. The signature is a page that mixes the two versions — e.g. the old heading text over a new form whose items never populate (the old view-model lacks the field) and whose POST 404s (the old router never had the route). Before debugging the code for impossible symptoms like that, check the serving process's start time (`ps -o lstart -p <pid>`) against when the code changed, and `curl` the page for old response shapes (e.g. stale field names in the map config JSON).
- **Playwright e2e uses `reuseExistingServer: !CI`**, so a stale `e2e-server.mjs` left listening on `:8091` serves old code and produces confusing render failures. Kill it (`node scripts/kill-port.ts 8091`) before re-running e2e after source changes — and check for old `e2e-server.mjs` processes on other ports too (`lsof -nP -iTCP -sTCP:LISTEN | grep node`), they survive across sessions.
