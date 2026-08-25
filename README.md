# Identify consultees

This is the monorepo for the Identify consultees service. This is a GIS tool for identifying consultees and managing the associated data.

## Getting started

* install latest LTS Node
* install Docker
* `npm i`
* `docker compose up` (to start a database)
* copy `packages/database/.env.example` to `.env`
* copy `apps/manage/.env.example` to `.env`
* Get the `AUTH_*` env vars from a dev and add to `apps/manage/.env` (or set `AUTH_DISABLED=false`)
* run `npm run db-migrate-dev` to setup the database
* run `apps/manage>npm run dev` to start the manage app

## WebStorm Run Configurations

Run configurations are included for most of the npm scripts. Node and npm must be configured for the project for them to work.
Go to Settings > Languages and Frameworks > Node.js and set the Node interpreter and package manager.
