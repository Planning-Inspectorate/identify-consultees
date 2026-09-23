# Identify consultees

This is the monorepo for the Identify consultees service. This is a GIS tool for identifying consultees and managing the associated data.

## Getting started

* install Node 22+ (see `.nvmrc`)
* install Docker
* `npm i`
* `npm start` — creates local `.env` files if missing, starts SQL Server, runs migrations, and launches the manage app at http://localhost:8090

For Entra auth locally, set `AUTH_DISABLED=false` in `apps/manage/.env` and fill in the `AUTH_*` values from a teammate.

For contribution guidelines see [CONTRIBUTING.md](./CONTRIBUTING.md). To report a security vulnerability see [SECURITY.md](./SECURITY.md).

## Editor setup

VS Code / Cursor settings in `.vscode` point the TypeScript language service at the workspace compiler (`node_modules/@typescript/old/lib`). When prompted, choose **Use Workspace Version** so options such as `erasableSyntaxOnly` are recognised.

## WebStorm Run Configurations

Run configurations are included for most of the npm scripts. Node and npm must be configured for the project for them to work.
Go to Settings > Languages and Frameworks > Node.js and set the Node interpreter and package manager.
