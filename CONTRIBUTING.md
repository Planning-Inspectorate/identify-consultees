# Contributing

Thank you for contributing to Identify consultees. This guide covers how to set up the repo, make changes, and open a pull request.

## Prerequisites

- Node.js **22.23.2** and npm **10.9.8** (see `.nvmrc` and `package.json` `engines` / `packageManager` — same as Azure Pipelines)
- Docker (for the local database)

Use `nvm use` then `npm ci`. Do not regenerate the lockfile with Node 24 or npm 11. Run `npm run check-toolchain` if unsure. Toolchain rules for agents are in [AGENTS.md](./AGENTS.md).

## Getting started

Follow the day-one setup in the [README](./README.md) (`npm i` then `npm start`). That covers env files, SQL Server on port 1434, migrations, and the manage app at http://localhost:8090.

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
npm run playwright:install   # once — Chromium, Firefox, WebKit (+ OS deps on Linux)
npm run lint
npm run format-prettier-check
npm run check-types
npm test
```

`npm test` runs unit/integration tests (including GOV.UK Frontend fixtures and jsdom a11y smoke), the manage frontend 100% line coverage gate, and Playwright e2e + browser a11y. Visual regression is opt-in (`npm run test:visual`) — see [`docs/frontend-testing.md`](./docs/frontend-testing.md).

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
