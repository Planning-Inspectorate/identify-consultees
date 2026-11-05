# Contributing

Thank you for contributing to Identify consultees. This guide covers how to set up the repo, make changes, and open a pull request.

## Prerequisites

- Node.js **24** (latest 24.x LTS — `.nvmrc` pins the major only) and the bundled **npm 11+** (see `package.json` `engines` — same as Azure Pipelines)
- Docker (for the local database)

Use `nvm use` then `npm ci`. Do not regenerate the lockfile under a different Node/npm major (e.g. Node 26 / npm 12). Run `npm run check-toolchain` if unsure. Toolchain rules for agents are in [AGENTS.md](./AGENTS.md).

## Getting started

Follow the day-one setup in the [README](./README.md) (`npm ci` then `npm start`). That covers env files, SQL Server on port 1434, migrations, seed data, and the manage app at http://localhost:8090.

## Making a change

### Where to make it

Many changes need no code. Rulesets, the report's columns, map distances and map colours are set in [`config/`](./config/README.md), which has step-by-step instructions for the common ones. Check an edit there with `npm run check-config`.

| To change                                      | Look in                                                        | Read first                                                                                                  |
| ---------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| A ruleset, the report, a distance, map colours | `config/`                                                      | [`config/README.md`](./config/README.md)                                                                    |
| A page or journey                              | `apps/manage/src/app/views/<feature>/`                         | [Web app](./kt-docs/web-app.md), [Frontend conventions](./kt-docs/frontend-conventions.md)                  |
| An admin page                                  | `apps/manage/src/app/admin/<page>/`                            | [Web app: Admin section](./kt-docs/web-app.md#admin-section)                                                |
| The maps                                       | `apps/manage/src/app/maps/`, `apps/manage/public/javascripts/` | [Maps](./kt-docs/maps.md)                                                                                   |
| How a ruleset is run                           | `packages/database/src/geospatial/`, `apps/function-python/`   | [Screening service](./kt-docs/screening-service.md), [Screening engine](./kt-docs/data/screening-engine.md) |
| The database schema                            | `packages/database/src/schema.prisma`                          | [`packages/database/src/README.md`](./packages/database/src/README.md)                                      |
| Importing data or CBOS cases                   | `packages/database/src/seed/`, `apps/manage/src/app/cbos/`     | [Data model and loading](./kt-docs/data/data-model.md)                                                      |
| An environment variable                        | `apps/manage/src/app/config.ts`                                | See below                                                                                                   |
| Azure resources or settings                    | `infrastructure/`                                              | [`infrastructure/README.md`](./infrastructure/README.md), [Deployment](./kt-docs/deployment.md)             |

A page's folder holds:

- `index.ts`, its routes
- `controller.ts`, which reads the request, gets the data through `service` and builds the view model
- `view-model.ts`, the view model's type
- `view.njk`, the template
- the tests beside them

Copy the nearest page that does something similar.

### What to update with it

Update these in the same PR as the change:

- **Tests.** Manage app code needs 100% line, branch and function coverage (`npm run test:frontend-coverage`), and so do `packages/database` and `scripts/` (`npm run test:packages-coverage`). A new or changed page also needs its accessibility test and a Playwright journey: see [Testing: Adding a route](./kt-docs/testing.md#adding-a-route).
- **Screenshots.** If the change alters how a page looks, run `npm run test:visual:update --workspace identify-consultees-manage` and commit the new snapshots. The baselines are macOS ones, so run it on a Mac.
- **Asset hashes.** If you change a file in `apps/manage/public/` or the Sass, `npm run build` rewrites its fingerprinted name in `apps/manage/src/util/config-middleware.ts`. Commit that file too, or the page loads the old file.
- **An environment variable** needs:
  - reading and checking in `apps/manage/src/app/config.ts`, with a test in `config.test.ts`
  - a line in `apps/manage/.env.example` if it's needed locally
  - an app setting in `infrastructure/app-web.tf`, with its variable in `infrastructure/variables.tf` and a value in each `infrastructure/environments/*.tfvars` that needs one
- **A schema change** needs a migration: see [`packages/database/src/README.md`](./packages/database/src/README.md). Read its warning about the consultee area tables first.
- **What users see.** Update the user guide (`apps/manage/src/app/views/help/view.njk`) when a page or step changes.
- **What developers read.** Update the `kt-docs/` page for the area, `config/README.md` for a new setting, and the header comment of any config file whose settings change.

### Explaining it

Explain each change where the next person will look for it:

- **In the code.** A comment says why the code does what it does, not what it does: the constraint, the edge case, the reason for a number. Keep comments up to date as the code changes. A comment that's no longer true is worse than none.
- **In a config file.** Its header lists every setting, with what it does and its limits. A new setting goes there, and in `config/README.md` if it's one people will change.
- **In the commit.** The subject says what changed, in the Conventional Commits form below. The body says why, and anything a reviewer would otherwise have to work out.
- **In the PR.** Fill in the template: what changed and why, the advantages, disadvantages and risks, the ticket, and how a reviewer can check it. For a page that looks different, include a screenshot.

## Development workflow

### Branching

Create a feature branch from up-to-date `main`. Prefer rebasing onto `main` rather than merging `main` into your branch, so history stays linear.

### Commits

This repo uses [Conventional Commits](https://www.conventionalcommits.org/) and commitlint. Examples:

- `feat: add consultee search filters`
- `fix: correct auth redirect after session expiry`
- `docs: clarify local database setup`
- `chore: add editorconfig and nvmrc`

Keep commits focused. Before requesting review, squash noisy WIP or fixup commits into a small, coherent set with clear subjects.

### Checks to run locally

```bash
npm run check-toolchain
npm run check-config         # the config/ files, in about a second
npm run playwright:install   # once — Chromium, Firefox, WebKit (+ OS deps on Linux)
npm run lint
npm run format-prettier-check
npm run check-types
npm test
```

`npm test` runs unit/integration tests (including GOV.UK Frontend fixtures and jsdom a11y smoke), the manage frontend 100% line coverage gate, and Playwright e2e + browser a11y. Visual regression is opt-in (`npm run test:visual`) — see [`kt-docs/testing.md`](./kt-docs/testing.md).

Husky runs lint-staged and commit-message checks on commit.

### Pull requests

- Rebase onto latest `main` and push with a clean history
- Fill in the pull request template (summary and linked issue)
- Do not commit secrets, `.env` files, or production data
- For UI changes, follow the [GOV.UK Design System](https://design-system.service.gov.uk/) and existing patterns in this repo

## UI and accessibility

This is a public-sector service. Prefer GOV.UK Frontend components and patterns already used in the manage app. Keep pages accessible: correct heading order, clear labels, keyboard operation, and visible focus.

## Reporting security issues

Please do not open public issues for security vulnerabilities. See [SECURITY.md](./SECURITY.md).

## Licence

This project is licensed under the [MIT Licence](./LICENSE).
