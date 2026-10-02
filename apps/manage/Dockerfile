# Stage 1/2 - Builder
# Pinned to the repo toolchain (package.json engines / .nvmrc): node:22-alpine
# floats to newer patch releases whose npm no longer satisfies engine-strict.
FROM node:22.23.2-alpine AS base

# npm nags about newer npm releases on every command; the image ships the pinned
# toolchain so the notice is never actionable here.
ENV npm_config_update_notifier=false
# npm still needs a cache dir the runtime user can write
ENV npm_config_cache=/home/node/.npm

ARG GIT_SHA

# Build as the runtime user: installing and copying as node means no 15s+
# `chown -R` pass at the end (which also wrote a full duplicate-metadata layer,
# inflating image export). Single-level only: /usr/src/app itself must be
# node-writable for node_modules; COPY --chown below keeps the rest node-owned.
RUN install -d -o node -g node /usr/src/app
WORKDIR /usr/src/app

USER node

COPY --chown=node:node package.json .
COPY --chown=node:node package-lock.json .
# repo npm config (engine-strict, fund/audit off, legacy-peer-deps off) so the
# install behaves exactly like CI and stays quiet
COPY --chown=node:node .npmrc .

# scripts/ is needed for deps:patch-maplibre below (it lives in the root package.json)
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node packages ./packages
COPY --chown=node:node apps/manage ./apps/manage

# --ignore-scripts skips the root postinstall, which is required: it also runs
# check-toolchain.mjs, which intentionally fails under the image's npm-major-only
# environment check expectations differ from CI - but skipping it means the
# MapLibre sanitize patch (CVE-2026-85061, see scripts/patch-maplibre-sanitize.ts)
# is never applied. The app serves Defra's vendored MapLibre UMD straight from
# node_modules (see src/app/maps/vendor.ts), so the patch must be applied here or
# the deployed image ships the vulnerable bundle.
RUN npm ci --loglevel notice --workspace=identify-consultees-manage --ignore-scripts
RUN npm run deps:patch-maplibre

ENV NODE_ENV=production
ENV GIT_SHA=$GIT_SHA

RUN npm run build --workspace=identify-consultees-manage
RUN npm run db-generate

# --------------------------------

# Stage 2/2 - App run
FROM base

ARG GIT_SHA

WORKDIR /usr/src/app/apps/manage

ENV NODE_ENV=production
ENV GIT_SHA=$GIT_SHA

# Drop root: the app only needs to read its own tree plus write the empty
# .core-static-noop mount dir under src/.static at startup (see
# src/util/fingerprint-assets.ts ensureEmptyStaticMountDir). Everything is
# already node-owned from the builder stage.
USER node

# TODO: Perhaps use `RUN npm ci --production` to shrink the size of the container

EXPOSE 8080

# Exec form (not `npm run start`): node must be PID 1 so SIGTERM reaches it for
# graceful shutdown during slot swaps and scaling.
ENTRYPOINT ["node", "src/server.ts"]
