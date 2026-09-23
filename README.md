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

The root [`tsconfig.json`](./tsconfig.json) stays compatible with Cursor / VS Code’s bundled TypeScript language service. Stricter checks such as `erasableSyntaxOnly` live in [`tsconfig.check.json`](./tsconfig.check.json) and run via `npm run check-types` (TypeScript 7 from `@typescript/native`).

Optional: `.vscode` points `typescript.tsdk` at `node_modules/@typescript/old/lib`. If prompted, choose **Use Workspace Version** for workspace-aligned IntelliSense.

## WebStorm Run Configurations

Run configurations are included for most of the npm scripts. Node and npm must be configured for the project for them to work.
Go to Settings > Languages and Frameworks > Node.js and set the Node interpreter and package manager.
