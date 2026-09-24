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

## Node and npm toolchain (match Azure Pipelines)

Local installs must use the **same Node and npm** as CI so `package-lock.json` stays compatible with `npm ci`.

| Tool    | Required version | Where it is pinned                                                                         |
| ------- | ---------------- | ------------------------------------------------------------------------------------------ |
| Node.js | **22.23.2**      | `.nvmrc`, `.node-version`, `.tool-versions`, `package.json` `engines`, Azure `nodeVersion` |
| npm     | **10.9.8**       | Bundled with Node 22.23.2; also `packageManager` + `engines.npm`                           |

Azure jobs use PINS `node_script.yml` with `nodeVersion: 22.23.2` (see `.azure/pipelines/pr.yml` and `infrastructure/pipelines/terraform-ci-commit.yaml`). That Node release ships **npm 10.9.8**.

### Agent rules for the toolchain

- Before changing dependencies or regenerating the lockfile: `nvm use` (or equivalent) so Node is **22.23.2** and `npm -v` is **10.9.8**. Do **not** run `npm install` under Node 24 / npm 11 against this repo.
- Prefer `npm ci` for a clean tree (same command as CI). Use `npm install` only when intentionally updating dependencies.
- After any `package-lock.json` change, run `npm run check-toolchain` (also runs at the end of `postinstall`).
- Keep root `optionalDependencies` on `react@19.3.0`, `react-dom@19.3.0`, and `scheduler@0.28.0`. They are not used by app code; they satisfy Prisma Studio / Radix peers so Azure `npm ci` does not fail with “Missing: react@… from lock file” (see PR #53 / commit `2e4f99d`). Never remove those entries or the matching `node_modules/react` (etc.) lockfile packages without replacing the guard.
- `.npmrc` sets `engine-strict=true` and `legacy-peer-deps=false` (Azure default). Do not enable `legacy-peer-deps` locally — it hides the `preact` 8 vs 10 peer conflict (`accessible-autocomplete` vs `@defra/interactive-map`) that breaks Azure `npm ci`.
- Keep the root `overrides.preact` on `^10.29.8` so that conflict resolves to Defra’s preact 10 line in the lockfile.
- Emergency bypass only: `SKIP_TOOLCHAIN_CHECK=1` (do not use for normal PR work).

### Switching locally

```bash
nvm install   # reads .nvmrc → 22.23.2
nvm use
node -v       # v22.23.2
npm -v        # 10.9.8
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
- [ ] Static / tile map usage follows the caching rules below (no uncached hot-linking of OSM or commercial static image servers).
- [ ] Map overlay colours, fills, hatches, and label styling follow the GIS Tool Styling tables in the Maps section below.
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

- Node’s `node:quic` / HTTP/3 server surface is still experimental, needs a specially built binary plus `--experimental-quic`, and is not available on ordinary Node 22/24 runtimes used here.
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

| Format                | Typical source                                                                     |
| --------------------- | ---------------------------------------------------------------------------------- |
| `image/png` (or JPEG) | Google Maps Static API, or other hosted static-image endpoints                     |
| `image/svg+xml`       | Local SVG that embeds OpenStreetMap (or similar) **raster tiles** as PNG data URIs |

Treat static maps as **binary or markup images served by our app**, never as a reason for browsers to hit third-party tile hosts directly.

### Static map / tile server usage (required)

OpenStreetMap tile servers and commercial static-map APIs rate-limit and block abusive clients. Agents and contributors **must**:

1. **Proxy through our app** — serve `/…/static-map` (and optional `/…/static-map.svg`) from Express; do not put `tile.openstreetmap.org` (or equivalent) URLs in page HTML/CSS/JS for the static fallback.
2. **Cache heavily** — responses must send long-lived `Cache-Control` (and preferably `ETag`). Matching `If-None-Match` must return **`304` and skip upstream Google/OSM fetches**. Prefer an in-process tile cache so repeat renders of the same viewport do not re-hit tile servers.
3. **Keep concurrency low** when fetching tiles (small batches; identifying `User-Agent` naming this service and repo).
4. **Only load static `<img>` when needed** — put the image in `<noscript>` and/or inject from `data-static-map-src` after interactive-map failure; never eager-load static images for JS-capable users who will use the interactive map.
5. **Do not invent uncached polling or prefetch** of static maps or tiles (e.g. pre-warming every section on every page view without cache).

When changing static-map code, preserve ETag fingerprinting of framing + geometry so validators continue to avoid unnecessary upstream work.
