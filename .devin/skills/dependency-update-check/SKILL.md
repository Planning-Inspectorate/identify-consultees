---
name: dependency-update-check
description: Verify the build pipeline is green before and after updating dependencies (Dependabot PRs, npm bumps, lockfile regeneration, Terraform provider bumps)
triggers:
  - user
  - model
allowed-tools:
  - read
  - grep
  - glob
  - exec
---

# Dependency update check

Run this whenever you are asked to update, merge, or regenerate dependencies — Dependabot PRs,
`npm install` version bumps, `package-lock.json` regeneration, or Terraform provider updates.

The goal: only land dependency changes on a **green pipeline**, so a red build after the change can
be attributed to the update rather than a pre-existing failure.

## Toolchain rules — read, don't repeat

How to actually change dependencies (Node version, `npm ci` vs `npm install`, lockfile guards,
`check-toolchain`, `optionalDependencies`/`overrides` rules) is defined once in
[AGENTS.md](../../../AGENTS.md) → "Node and npm toolchain (match Azure Pipelines)". Follow that
section — do not duplicate its rules here or invent your own install steps.

## Step 1 — confirm `main` is green first

Check the most recent completed CI on `main` before starting:

```bash
# Azure Pipelines statuses posted back to GitHub + GitHub Actions (CodeQL)
gh api repos/Planning-Inspectorate/identify-consultees/commits/main/check-runs \
  --jq '.check_runs[] | "\(.name): \(.conclusion // .status)"'

# Azure DevOps side (equivalent, if you have az + the azure-devops extension)
az pipelines runs list --branch main --top 5 \
  --query '[].{pipeline: definition.name, result: result, finished: finishTime}' -o table
```

- If `main` is **red**, stop and report it. Do not stack a dependency change on a broken baseline —
  either fix `main` first (via its own PR) or confirm with the user that the failures are unrelated
  flakes before proceeding.
- If `main` is green, continue.

## Step 2 — check the dependency PR's own checks (Dependabot path)

When reviewing an open Dependabot PR:

```bash
gh pr list --author 'app/dependabot' --limit 20
gh pr checks <PR-number>
```

The Azure jobs report back as checks named `PR`, `PR (Validate Run Linting & Tests)`,
`PR (Validate Python Function Lint & Tests)`, `Infrastructure PR`, plus the `CodeQL` GitHub check.

- Every required check must be `SUCCESS` before merging. `NEUTRAL`/`SKIPPED` path-excluded checks
  (e.g. `Infrastructure PR` on an npm-only change) are fine.
- If the PR is failing, do not merge and hope — reproduce locally (`npm ci` then the failing
  script) and decide whether the bump is incompatible or needs a code fix.
- If Dependabot grouped several bumps together and one breaks, split that package out rather than
  reverting the whole group.

## Step 3 — apply the update

Follow the AGENTS.md toolchain section for the mechanics. In short: right Node/npm major, `npm ci`
to reproduce CI, `npm install` only when intentionally changing versions, `npm run check-toolchain`
after any lockfile change. The lockfile guards there are load-bearing — verify they survived.

## Step 4 — verify before handing over

- Run the same commands CI runs locally where feasible (`npm ci`, `check-types`, `lint`, tests) —
  see `.azure/pipelines/pr.yml` for the exact script list.
- Push the branch / rebase the Dependabot PR, then re-check the PR's checks go green (step 2).
- Report: state of `main` before, checks on the PR, what was bumped, and any failures seen with
  their cause.

## Never

- Merge or regenerate a dependency change while `main` CI is failing without flagging it first.
- Re-run CI blindly until it passes — investigate failures; note genuine flakes in the PR comment.
- Duplicate the toolchain rules from AGENTS.md into commit messages, PR bodies, or other rule files —
  link to the section instead.
