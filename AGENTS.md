# Agent guidance

This file is the single source of truth for agent instructions in this repository. [`CLAUDE.md`](./CLAUDE.md) and [`.github/copilot-instructions.md`](./.github/copilot-instructions.md) point here.

## Where guidance lives

Keep instructions in one place and link to them — do not repeat the same rules across files.

| Location                                                                                                                  | Role                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md` (this file)                                                                                                   | Single source of truth for agent rules and repo conventions                                                      |
| [`CLAUDE.md`](./CLAUDE.md), [`.github/copilot-instructions.md`](./.github/copilot-instructions.md), `.cursor/rules/*.mdc` | Thin pointers back to this file — add scoped detail here, not in the pointers                                    |
| `.devin/skills/*/SKILL.md`                                                                                                | Task-specific skills (for example `dependency-update-check` for green-pipeline checks before dependency updates) |
| [`ACCESSIBILITY.md`](./ACCESSIBILITY.md)                                                                                  | Accessibility policy: WCAG 2.2 AA, testing, audit and statement duties                                           |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md)                                                                                    | Human-facing contribution workflow                                                                               |
| [`docs/`](./docs/), [`kt-docs/`](./kt-docs/README.md)                                                                     | Procedural and onboarding detail linked from the relevant sections below                                         |

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
- Prefer rebasing the feature branch onto `main` over merging `main` into the feature branch.
- `--force-with-lease` is allowed on feature / PR branches only, and only after an intentional history rewrite (rebase/squash).
- Still never force-push `main` (or `master`).
- Still only commit / push / open PRs when the user asks (or existing user rules already authorize that step); when they do, apply the practices above.
- Follow the AI identification rules above: do not identify as an AI or add AI co-authorship in any GitHub-visible content.

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
- [ ] No secrets, `.env`, or production data dumps in the diff.
- [ ] No AI self-identification in the PR description, commits, or diff.

## Node and npm toolchain (match Azure Pipelines)

Local installs must use the **same Node major and npm** as CI so `package-lock.json` stays compatible with `npm ci`. We pin the **major version only** — minor and patch releases float to the latest automatically, so routine Node releases need no repo change.

| Tool    | Required version       | Where it is pinned                                                                                                                                          |
| ------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js | **24.x** (current LTS) | `.nvmrc`, `.node-version`, `.tool-versions` (`24`), `package.json` `engines.node` `^24`, Azure `nodeVersion: 24`, `apps/manage/Dockerfile` `node:24-alpine` |
| npm     | **11.x+** (bundled)    | `engines.npm` is a `>=11` floor only — npm ships with Node 24 and is never patch-pinned                                                                     |

Azure jobs use PINS `node_script.yml` with `nodeVersion: 24` (see `.azure/pipelines/pr.yml` and `infrastructure/pipelines/terraform-ci-commit.yaml`), so CI always tracks the latest Node 24.x and its bundled npm.

### Agent rules for the toolchain

- Pin majors, not patches: `.nvmrc`, `.node-version`, `.tool-versions`, the Dockerfile base tag, and Azure `nodeVersion` all resolve to the **latest 24.x**; `engines.node` `^24` enforces the same range. Only major/LTS bumps should touch these files — never pin an exact patch (it forces a repo change per Node release and causes EBADENGINE drift against the floating tags).
- Do **not** re-add a `packageManager` field or an exact `engines.npm` — pinning a specific npm defeats the float-above and, under corepack, can force an npm that doesn't match Node's bundled one.
- Before changing dependencies or regenerating the lockfile: `nvm use` (or equivalent) so Node is **24.x** with its bundled **npm 11.x**. Do **not** regenerate `package-lock.json` under a different Node/npm major.
- Prefer `npm ci` for a clean tree (same command as CI). Use `npm install` only when intentionally updating dependencies.
- After any `package-lock.json` change, run `npm run check-toolchain` (also runs at the end of `postinstall`). It validates the running Node/npm against the `engines` ranges — not exact versions.
- Keep root `optionalDependencies` on `react@19.3.0`, `react-dom@19.3.0`, and `scheduler@0.28.0`. They are not used by app code; they satisfy Prisma Studio / Radix peers so Azure `npm ci` does not fail with “Missing: react@… from lock file” (see PR #53 / commit `2e4f99d`). Never remove those entries or the matching `node_modules/react` (etc.) lockfile packages without replacing the guard.
- `.npmrc` sets `engine-strict=true` and `legacy-peer-deps=false` (Azure default). Do not enable `legacy-peer-deps` locally — it hides the `preact` 8 vs 10 peer conflict (`accessible-autocomplete` vs `@defra/interactive-map`) that breaks Azure `npm ci`.
- Keep the root `overrides.preact` on `^10.29.8` so that conflict resolves to Defra’s preact 10 line in the lockfile.
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

- **Prefer `@planning-inspectorate/core` components first, then GOV.UK Frontend.** When a shared component exists in `@planning-inspectorate/core` (for example `pinsHeader`, `pinsFooter` under `ui/`), use it ahead of assembling the equivalent from `govuk-frontend` parts or local markup. Fall back to GOV.UK Frontend Nunjucks macros (for example `govukButton`, `govukInput`, `govukSelect`, `govukTable`, `govukRadios`, `govukPhaseBanner`) where no core component exists. Do not hand-write equivalent component HTML. This maximises accessibility, GDS compliance, and web performance (consistent markup, shared assets, and fewer bespoke patterns).
- **Header / footer chrome:** Use `pinsHeader` and `pinsFooter` from `@planning-inspectorate/core` for PINS-branded chrome — their styles come from core's `ui/header`/`ui/footer` Sass, pulled in via `apps/manage/src/app/sass/govuk-overrides.scss`. Pair with `govukServiceNavigation` for the navigation. Do not use `govukHeader`/`govukFooter` — GOV.UK Frontend 6 reserves those for services on GOV.UK.
- Layout wrappers that use Design System classes (for example `govuk-grid-row`, `govuk-width-container`, `govuk-heading-*`) and plain content text are fine; interactive and presentational UI components must still be macros.
- Prefer documented components (for example button, error summary, text input, radios, table, notification banner) and [patterns](https://design-system.service.gov.uk/patterns/) (for example question pages, check answers, validation errors).
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
- [ ] Page HTML uses GOV.UK Frontend macros only for UI components (no hand-rolled component markup).
- [ ] Used existing GOV.UK Frontend / Nunjucks patterns already in this codebase where possible.
- [ ] Content is plain language; errors follow Design System error patterns.
- [ ] Accessibility considered per [ACCESSIBILITY.md](./ACCESSIBILITY.md) (WCAG 2.2 AA: semantics, focus, contrast via Design System defaults, keyboard use).
- [ ] Security and privacy considered (auth, validation, data minimisation, no secrets).
- [ ] Reused shared packages/patterns rather than introducing a parallel stack.
- [ ] PR summary notes any Service Standard / TCoP impact when material.
- [ ] Static / tile map usage follows the caching rules below (no uncached hot-linking of OSM or commercial static image servers).
- [ ] Map overlay colours, fills, hatches, and label styling follow the GIS Tool Styling tables in the Maps section below.
- [ ] No `!important` in authored Sass/CSS — stylelint `declaration-no-important` fails the lint; use `govuk-!-*` override classes, BEM specificity, or source order instead.
- [ ] HTTP protocol changes follow the Front Door / origin guidance below (do not add experimental Node QUIC listeners).

## HTTP protocols and Azure Front Door

Public traffic reaches the manage app through **Azure Front Door**, then Azure App Service. Protocol choices must match that topology.

### Current best practice

| Hop                               | Protocol today                            | Notes                                                                |
| --------------------------------- | ----------------------------------------- | -------------------------------------------------------------------- |
| Browser → Azure Front Door        | HTTPS with **HTTP/2** (HTTP/1.1 fallback) | Front Door terminates TLS and speaks modern HTTP to clients.         |
| Front Door → App Service (origin) | **HTTP/1.1**                              | Microsoft documents this for Front Door origins.                     |
| Node / Express in the container   | **HTTP/1.1** `app.listen`                 | Correct for an origin behind Front Door; keep `trust proxy` enabled. |

**Do not** add an in-process HTTP/3 or QUIC listener in the Node/TypeScript app:

- Node’s `node:quic` / HTTP/3 server surface is still experimental, needs a specially built binary plus `--experimental-quic`, and is not available on ordinary Node 24 runtimes used here.
- Third-party native QUIC packages are not appropriate for this Azure App Service origin: clients never reach Node’s UDP listener while Front Door is in front.
- Optimum user-facing performance for HTTP/3 comes from enabling it **at the CDN edge**, not in the origin process.

### HTTP/3 + QUIC — enable at Azure Front Door

When Microsoft ships HTTP/3 (QUIC) on Azure Front Door Standard/Premium for this shared profile, enable it **on Front Door** (portal, ARM/Bicep, or Terraform once the provider exposes the setting). Until then:

- Keep documenting the intent in `infrastructure/front-door.tf`.
- Do not advertise a misleading `Alt-Svc: h3=…` from the origin while the edge cannot serve HTTP/3.
- After edge HTTP/3 is on, verify UDP/443 path, TLS 1.3, and that browsers negotiate `h3` on the public hostname (Chrome DevTools Protocol column / `Alt-Svc`).

App-level performance work that _does_ help today stays in the origin: fingerprinting, Brotli, cache headers, CSP, and keeping responses streamable — not a Node QUIC stack.

## Maps (interactive and static)

### Terminology (how the user talks about maps)

When the user mentions maps in conversation or tickets, interpret wording as follows:

| User says                                 | Means                                                                                                                                                 |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **map** (unqualified)                     | The **JS-on interactive map** (Defra Interactive Map / client-side map when JavaScript works).                                                        |
| **static map** or **non-interactive map** | A **server-rendered image** of a map (PNG/JPEG/SVG served by our app), used for noscript / progressive-enhancement failure — not the interactive map. |

Do not assume “map” alone refers to the static fallback; only treat it as static when they say static or non-interactive (or clearly point at the image/fallback path).

### Shapefile upload and GIS report workflow (external)

For Astun GIS shapefile packaging, upload, attribute population, and prescribed-consultee report generation, read:

- [`docs/gis-shapefile-upload-and-report.md`](./docs/gis-shapefile-upload-and-report.md)

Keep that procedural detail out of this file; link here when an agent needs the operational context.

### GIS Tool Styling (map overlays — required)

Source: **GIS Tool Styling** (last updated 12/09/2024, Jo Gerulaitis). Agents and contributors **must** use these styles whenever implementing or changing map overlays (interactive layers, legends/keys, and static-map drawings of the same features). Do not invent new colours or fill patterns for these layer types.

#### All layers — labels and buffers

Applies to label styling on all map overlays:

| Property       | Value     |
| -------------- | --------- |
| Font name      | Arial     |
| Font size      | 10pt      |
| Colour         | `#424145` |
| Buffer width   | 2mm       |
| Buffer colour  | `#ffffff` |
| Buffer opacity | `0.9`     |

#### All projects layer — by `geometryStage`

Solid fill; fill opacity `0.6`; border opacity `1`.

| Layer                 | Column          | Colour    | Description |
| --------------------- | --------------- | --------- | ----------- |
| Scoping               | `geometryStage` | `#3c51ab` | Solid fill  |
| Acceptance            | `geometryStage` | `#bd2327` | Solid fill  |
| Consultation adequacy | `geometryStage` | `#ee853e` | Solid fill  |
| DCO consent           | `geometryStage` | `#85a54e` | Solid fill  |
| Built                 | `geometryStage` | `#4c888e` | Solid fill  |

#### All projects — by type (`Sector`)

Solid fill; fill opacity `0.6`; border opacity `1`.

| Layer                  | Column   | Colour    | Description |
| ---------------------- | -------- | --------- | ----------- |
| Transport              | `Sector` | `#da7c7e` | Solid fill  |
| Business or Commercial | `Sector` | `#782e98` | Solid fill  |
| Energy                 | `Sector` | `#e0a620` | Solid fill  |
| Waste                  | `Sector` | `#874927` | Solid fill  |
| Waste water            | `Sector` | `#418335` | Solid fill  |
| Water                  | `Sector` | `#85b6b1` | Solid fill  |
| Other                  | `Sector` | `#77767b` | Solid fill  |

#### Energy projects — by subtype (`subType`)

Diagonal hatch (`Hatched /`); fill opacity `1`; border opacity `1`.

| Layer             | Column    | Colour    | Description |
| ----------------- | --------- | --------- | ----------- |
| Natural gas       | `subType` | `#da7c7e` | Hatched /   |
| Energy from waste | `subType` | `#782e98` | Hatched /   |
| Solar             | `subType` | `#e0a620` | Hatched /   |
| Offshore wind     | `subType` | `#3b629b` | Hatched /   |
| Biomass           | `subType` | `#418335` | Hatched /   |
| Nuclear           | `subType` | `#85a54e` | Hatched /   |
| Tidal             | `subType` | `#4c888e` | Hatched /   |
| Hydrogen          | `subType` | `#85b6b1` | Hatched /   |
| Onshore wind      | `subType` | `#77767b` | Hatched /   |
| Other             | `subType` | `#874927` | Hatched /   |

#### MOD low flying areas

Cross hatch (`Hatched X`); fill opacity `1`; border opacity `1`.

| Layer | Colour    | Description |
| ----- | --------- | ----------- |
| Green | `#418335` | Hatched X   |
| Amber | `#e0a620` | Hatched X   |
| Red   | `#bd2327` | Hatched X   |
| Blue  | `#2068e4` | Hatched X   |

#### MOD safeguarding areas

Cross hatch (`Hatched X`); fill opacity `1`; border opacity `1`.

| Layer  | Colour    | Description |
| ------ | --------- | ----------- |
| Purple | `#782e98` | Hatched X   |

#### Agent rules for overlay styling

- Prefer shared constants / a single style module over hard-coding hex values in multiple views.
- Match legend/key swatches to the same colour and fill pattern as the map layer.
- When a new overlay type is needed and is not listed above, ask product/design rather than inventing a palette.
- Static-map fallbacks that draw the same features should use the same colours and opacities where the render path allows.

### Architecture

The manage app follows the PINS-data-spike pattern: **Defra Interactive Map** when JavaScript works, plus a **server-rendered static map** for noscript / progressive-enhancement failure.

### Formats

Non-JS / fallback maps are **not always SVG**. Depending on configuration they may be:

| Format                | Typical source                                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| `image/avif`          | Default OSM-tile path composited with `sharp` and encoded as AVIF when the client accepts it               |
| `image/webp`          | Same composited raster, encoded as WebP when AVIF is not accepted                                          |
| `image/png` (or JPEG) | Composited raster fallback for older clients, or Google Maps Static API when configured                    |
| `image/svg+xml`       | Local SVG that embeds OpenStreetMap (or similar) **raster tiles** as PNG data URIs (explicit `.svg` route) |

The default `/…/static-map` route negotiates AVIF → WebP → PNG from the request `Accept` header, so it must send `Vary: Accept`, and the negotiated format is part of the ETag fingerprint (`buildStaticMapFingerprint`). The `/…/static-map.svg` route always returns SVG.

Treat static maps as **binary or markup images served by our app**, never as a reason for browsers to hit third-party tile hosts directly.

### Static map / tile server usage (required)

OpenStreetMap tile servers and commercial static-map APIs rate-limit and block abusive clients. Agents and contributors **must**:

1. **Proxy through our app** — serve `/…/static-map` (and optional `/…/static-map.svg`) from Express; do not put `tile.openstreetmap.org` (or equivalent) URLs in page HTML/CSS/JS for the static fallback.
2. **Cache heavily** — responses must send long-lived `Cache-Control` (and preferably `ETag`). Matching `If-None-Match` must return **`304` and skip upstream Google/OSM fetches**. Prefer an in-process tile cache so repeat renders of the same viewport do not re-hit tile servers.
3. **Keep concurrency low** when fetching tiles (small batches; identifying `User-Agent` naming this service and repo).
4. **Only load static `<img>` when needed** — put the image in `<noscript>` and/or inject it after interactive-map failure; never eager-load static images for JS-capable users who will use the interactive map. Pass fallback details via the page's `<script type="application/json">` config block, not `data-*` attributes on the map container (see the `data-*` hazard below).
5. **Do not invent uncached polling or prefetch** of static maps or tiles (e.g. pre-warming every section on every page view without cache).

When changing static-map code, preserve ETag fingerprinting of framing + geometry so validators continue to avoid unnecessary upstream work. Every new input that affects the rendered image (markers, numbered badges, overlays, format) must be added to `buildStaticMapFingerprint`'s payload — otherwise stale cached variants keep serving after the config changes.

The static fallback should carry the same feature information as the interactive map. For feature-based examples, draw numbered badges at each feature's centroid and pair them with a GOV.UK table below the map that keys the numbers to names/details (see `select-feature` in `interactive-map-examples.ts` and the `featureLegend` model in `example.njk`).

`sharp` gotcha in `static-map-raster.ts`: **`.composite()` replaces the input list, it does not append.** Tiles and the overlay must go into a single `.composite()` call — a second call silently drops the basemap, producing a background-only image (this exact bug shipped once because tile fetches also fail silently to an empty array, making the two failure modes indistinguishable). Tests should assert on output pixel stats, not just format signatures.

### Interactive map component showcase

`/components/interactive-map` (reachable via the `?components=true` showcase) renders one page per worked Defra Interactive Map example from `src/app/maps/interactive-map-examples.ts`. Each page loads only the plugin bundles that example needs, and reuses the shared static-map pipeline for its `<noscript>` / init-failure fallback. Vendor bundles under `/vendor/*` are served with lazy in-process Brotli (`src/app/maps/vendor.ts`); entry points are fingerprinted at build time, lazy chunks keep stable names and are served `max-age=0` so they revalidate via ETag rather than caching (see the stale-chunk gotcha below).

### Defra component integration gotchas (learned from real bugs)

- **`data-*` attributes are JSON-parsed.** The `InteractiveMap` constructor runs `JSON.parse` on every `data-*` attribute it finds on the map container. Plain strings like `data-static-map-src="/static-map"` log `SyntaxError`s to the console (harmless but noisy, and confusing to diagnose). Keep `data-*` off the container — put configuration in the page's `<script type="application/json">` block (the consultee maps carry their static-map fallback as `config.fallback`) and discover containers by a class selector (`.app-consultee-map`, `.app-map-layers-demo`, `.app-interactive-map-example`).
- **Plugin API methods attach late.** The object returned by `defra.interactPlugin()` (and siblings) has no `enable`/`clear` methods at construction — the core attaches them when the plugin's init component mounts, around `map:ready`. Guard wiring on the plugin object existing, then call the API lazily: `map.on('map:ready', () => interactPlugin.enable?.())`. A jsdom mock that exposes `enable` immediately masks this and lets the bug ship — model the late attachment (plugin object without the API until `map:ready`) in tests.
- **`mapStyles` entries need a `thumbnail`.** The `map-styles` plugin renders `mapStyle.thumbnail` as an `<img>`; an omitted field leaves an empty placeholder box in the style panel. Inline SVG `data:` URIs work well — zero requests, decorative `alt=""`, and CSP already allows `img-src data:`.
- **Feature info is a panel, not a tooltip.** The component has no floating-tooltip API for clicked features (its internal tooltips are only control labels). The supported pattern is `interact` + `interact:selectionchange` writing into an `addPanel` side panel — also the more accessible option for keyboard and touch users. Escape property values (`escapeHtml`) before `innerHTML`.
- **`buttonFirst`/`hybrid` fullscreen needs `hasExitButton: true`.** The shell ships a built-in Exit control (top-left, fullscreen only) but excludes it unless `appConfig.hasExitButton` is set — without it, a `buttonFirst` map opens fullscreen with no way out. Pass the flag through the page config; `inline` maps can leave it off since they never fullscreen.
- **`mapStyle` must have an `id`.** The draw adapter builds per-style override properties (`user_fill<Id>` etc.) via `mapStyle.id.charAt(0)` and crashes at mount with `Cannot read properties of undefined (reading 'charAt')` when the style object lacks `id` — the draw control then silently never attaches. Give the shared style object `id: 'liberty'` (see `interactive-map-examples/controller.ts`); style-switcher `mapStyles` entries already carry ids.
- **`<noscript>` contents are not in the live DOM.** With JS enabled, browsers don't expose noscript markup to `querySelector` or Playwright — content needed for _both_ no-JS users and JS-users-on-init-failure must be rendered twice: inside `<noscript>` and again in a `hidden` block (`#<mapId>-fallback`) that `showStaticMapFallback` reveals on failure. Tests asserting the fallback must read the raw HTML response, not the live DOM.
- **Verify plugin interactions with a real click, not DOM presence.** The draw adapter crashed during mount (`mapStyle.id` missing) while its toolbar markup still rendered — a presence assertion passes but the feature is dead. When touching plugin wiring, click through the actual interaction in a browser (Playwright against the dev server) and watch `pageerror`/`console` for mount-time exceptions.
- **Never give vendor lazy chunks a nonzero `max-age`.** Webpack loads `im-core.js` and the numeric `NNNN.js` plugin chunks by literal filename — the URL never changes across package versions, unlike the fingerprinted `index-<hash>.js` entry. A cached stale chunk booting against a new entry throws `o[e] is not a function` inside webpack's module lookup and the map fails with "There was a problem loading the map" — seen in Chrome (warm cache) while Firefox (cold cache) worked, right after a `@defra/interactive-map` bump. `createDefraVendorRouter` is mounted with no `maxAge` → `max-age=0` + ETag/304 revalidation. Do not plumb `service.cacheControl.maxAge` back into it; `CACHE_CONTROL_MAX_AGE` still feeds core's static mount, which serves nothing (the app overrides `staticDir` with an empty mount).
- **Draw tools need a consumer-added entry button.** The draw plugin only renders in-session controls (Cancel/Add point/Done); nothing starts a session until the consumer wires a button: `map.on('map:ready', () => map.addButton('drawPolygon', { label: 'Draw polygon', onClick: () => drawPlugin.newPolygon?.(crypto.randomUUID()) }))`. `newPolygon(featureId, options?)` is late-bound like `interact.enable` — call it with `?.` at click time.
- **Viewport `aria-controls` is a dangling idref upstream (0.0.44+).** `Features` (`#<id>-features`) was replaced by `SpatialList` (`#<id>-spatial-list`) but the viewport's `aria-controls` still points at the old id — axe flags it as critical `aria-valid-attr-value`. `scripts/patch-im-aria-controls.ts` rewrites the idref in the installed `dist/{umd,esm}/im-core.js` at postinstall; it throws when the pattern disappears so a fixed upstream version fails loudly and the patch can be removed.

## Asset fingerprinting and the local dev server

`npm run build` (`src/util/build.ts`) copies assets into `apps/manage/src/.static`, renames selected files with an 8-char content hash (`fingerprint-assets.ts`), writes Brotli `.br` sidecars, and rewrites the manifest values in `src/util/config-middleware.ts`.

- **Never hand-edit the hashes** in `config-middleware.ts` — run `npm run build` so the filename and manifest stay in sync.
- **Any change to a fingerprinted source file changes its hash.** The old filename is deleted from `.static`, so a running server that rendered a page earlier now references a file that no longer exists (`404` / `ERR_EMPTY_RESPONSE`). After editing files under `src/public/` or rerunning the build, restart the dev server — nodemon watches `src` and normally handles this.
- **Orphaned dev server:** if a restart attempt crashes with `EADDRINUSE` (an old `node src/server.ts` still holds `:8090`), nodemon leaves the stale process serving old code and hash manifest. Check `lsof -nP -iTCP:8090 -sTCP:LISTEN`, kill the orphan, and nodemon respawns on the next file change.
- **Playwright e2e uses `reuseExistingServer: !CI`**, so a stale `e2e-server.mjs` left listening on `:8091` serves old code and produces confusing render failures. Kill it before re-running e2e after source changes.

## Database operations without redeploying the app

Schema migrations and data changes for a real environment (Dev/Test/Training/Prod) don't require
shipping app code - two pipelines already handle this independently of `Build`/`Deploy`'s web-app
job:

- **Schema-only migration**: run the `Deploy` pipeline (`.azure/pipelines/deploy.yml`) with
  `deployWeb=false` and `schemaMigration=true` (the default). Its `Migrate` and `Deploy Web` jobs
  are siblings, not dependent on each other, so this applies `npm run migrate-prod` to the target
  environment's real database without touching the running app or its slots at all.
- **Data operations**: `.azure/pipelines/db-seed.yml` (`trigger: none`, manually run via
  `az pipelines run` or the Azure DevOps UI, parameterised by `environment`) is a fully separate
  pipeline for loading data. Its default is the small built-in sample dataset
  (`npm run seed`/`seed-prod`); passing `loadFullReferenceData=true` (Dev/Test/Training only)
  instead runs `npm run import-from-blob` for the two known reference-data blobs
  (`combined_reference_data_v1.geojson`, `all-project-boundaries.geojson`) in the app's storage
  container (`infrastructure/storage.tf`). Imports merge by id and never delete, so add
  `replaceExistingData=true` to clear each table first when the source's ids or areas changed -
  otherwise old rows stay as stale or duplicate consultees. Each table is cleared only once its
  blob has downloaded and parsed with features. The pipeline reads the blobs as its own identity,
  which has no data-plane role on the container (Terraform can't grant one: the pipeline identity's
  role-assignment rights carry an ABAC condition that refuses it), so this route fails with 403
  until the platform team grants it Storage Blob Data Reader - use the in-app import meanwhile.
- **In-app import**: the same blobs can be imported from the manage app itself at
  `/admin/import-reference-data` (with `/admin/upload-to-blob` for getting files into the
  container) - the app's managed identity has Storage Blob Data Contributor. This route always
  **replaces** the table (same safeguards as the pipeline's `replaceExistingData`), and shows the
  rows currently loaded, so an import that outlasts Front Door's response timeout can be confirmed
  by reloading the page.
- **One-off local imports**: `npm run db-import -- --type=<consultee-areas|case-boundaries> --file=<path>`
  works against any `SQL_CONNECTION_STRING` you can reach directly (e.g. from a machine with a
  route to a real environment's database), independently of any pipeline.
