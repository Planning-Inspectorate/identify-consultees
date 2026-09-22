# Contributing

Thank you for contributing to Identify consultees. This guide covers how to set up the repo, make changes, and open a pull request.

## Prerequisites

- Node.js 22 or later (see `.nvmrc` and the `engines` field in `package.json`)
- npm (comes with Node)
- Docker (for the local database)

## Getting started

1. Clone the repository and install dependencies:

   ```bash
   npm i
   ```

2. Start the local database:

   ```bash
   docker compose up
   ```

3. Copy environment files and configure auth:

   - Copy `packages/database/.env.example` to `packages/database/.env`
   - Copy `apps/manage/.env.example` to `apps/manage/.env`
   - Add `AUTH_*` values from a teammate, or set `AUTH_DISABLED=true` for local work without Entra

4. Set up the database and start the manage app:

   ```bash
   npm run db-migrate-dev
   npm run dev --workspace identify-consultees-manage
   ```

More detail is in the [README](./README.md).

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
npm run lint
npm run format-prettier-check
npm run check-types
npm test
```

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
