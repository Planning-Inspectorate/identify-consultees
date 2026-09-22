# Identify consultees

This is the monorepo for the Identify consultees service. This is a GIS tool for identifying consultees and managing the associated data.

## Getting started

* install Node 22+ (see `.nvmrc`)
* install Docker
* `npm i`
* `docker compose up` (to start a database)
* copy `packages/database/.env.example` to `.env`
* copy `apps/manage/.env.example` to `.env`
* Get the `AUTH_*` env vars from a dev and add to `apps/manage/.env` (or set `AUTH_DISABLED=true`)
* run `npm run db-migrate-dev` to setup the database
* run `apps/manage>npm run dev` to start the manage app

For contribution guidelines see [CONTRIBUTING.md](./CONTRIBUTING.md). To report a security vulnerability see [SECURITY.md](./SECURITY.md).

## Editor setup

VS Code / Cursor settings in `.vscode` point the TypeScript language service at the workspace compiler (`node_modules/@typescript/old/lib`). When prompted, choose **Use Workspace Version** so options such as `erasableSyntaxOnly` are recognised.

## WebStorm Run Configurations

Run configurations are included for most of the npm scripts. Node and npm must be configured for the project for them to work.
Go to Settings > Languages and Frameworks > Node.js and set the Node interpreter and package manager.
