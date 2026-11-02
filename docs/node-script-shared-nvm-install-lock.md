# Shared `nvm install` lock stalls pipelines when `nodeVersion` is not preinstalled on the agent image

Audience: the maintainers of `Planning-Inspectorate/common-pipeline-templates`
(`steps/node_script.yml`) and of the self-hosted agent image
(`Planning-Inspectorate/infrastructure-tooling` → `infrastructure-agents`).

Context: while moving a consuming repo from Node 24 to Node 26 LTS, every
`node_script` step hung on `Waiting for another install of v26.13.0 to finish...`
and would have failed after the 600s nvm lock timeout. This document explains the
mechanism, why it recurs on every LTS transition, and what we think should change
in the shared template and the agent image.

## TL;DR

- `node_script.yml` runs `nvm use <major> || nvm install <major>` — so for any
  major not preinstalled on the image, the template installs into the **shared**
  `/usr/local/nvm`.
- nvm serialises same-version installs on an `mkdir` lock at
  `$NVM_DIR/.cache/locks/<version>`:
  - `NVM_INSTALL_LOCK_TIMEOUT` defaults to **600s** — waiters then fail the step.
  - `NVM_INSTALL_LOCK_STALE` defaults to **0 (never steal)** — a crashed
    install's lock persists forever, so every later install of that version
    fails until the lock directory is removed by hand.
- Parallel jobs (ours and other pipelines' on the shared pool) all queue on the
  same lock; a dead holder turns it into deterministic, repeated failure.
- `NVM_DIR` cannot be redirected by a pipeline env var: the image's
  `/etc/skel/.bashrc` does `export NVM_DIR="/usr/local/nvm"` unconditionally, and
  the template sources `~/.bashrc` before calling nvm.

## Observed symptom

From a PR build (three validation jobs in parallel), every first Node step
logged:

```
[Host] Selected Node version: Node24 (Strategy: Node24Strategy)
N/A: version "v26" is not yet installed.
You need to run `nvm install 26` to install and use it.
Waiting for another install of v26.13.0 to finish...
```

and sat there until nvm's 600s timeout. (The `Node24Strategy` line is just the
Azure DevOps task execution handler for the CmdLine task itself — unrelated to
the toolchain your script runs.)

## Root cause, layer by layer

1. **Template** — `steps/node_script.yml` (verified identical through
   `release/3.30.2`):

   ```bash
   source ~/.bashrc
   nvm use ${{ parameters.nodeVersion }} || nvm install ${{ parameters.nodeVersion }}
   ${{ parameters.script }}
   ```

   When `nvm use` fails (version not preinstalled), the `|| nvm install`
   fallback runs in whatever `NVM_DIR` bashrc set — the shared `/usr/local/nvm` —
   before the caller's script can apply any workaround.

2. **Agent image** — `infrastructure-agents/configuration/tools.sh`:

   ```bash
   sudo mkdir /usr/local/nvm && chmod -R 777 /usr/local/nvm
   sudo curl -o- .../install.sh | NVM_DIR=/usr/local/nvm bash
   ...
   sudo tee /etc/skel/.bashrc > /dev/null <<"EOT"
   export NVM_DIR="/usr/local/nvm"
   [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
   ...
   nvm install 24
   nvm install 22
   nvm install 20
   ```

   - The dir is `chmod 777`, so jobs across the pool genuinely share it.
   - Only Node 24/22/20 are baked in — any newer major hits the install path.
   - The unconditional `export NVM_DIR=` means `environmentVariables:` on the
     step cannot override it.

3. **nvm lock semantics** (`nvm_acquire_install_lock` in `nvm.sh`):

   - Lock = `mkdir` at `$(nvm_cache_dir)/locks/<version>` — per `NVM_DIR`, so a
     private `NVM_DIR` has a private, contention-free lock.
   - Waiters loop up to `NVM_INSTALL_LOCK_TIMEOUT` (600s default) then exit 1 —
     the step dies with "Timed out after 600s waiting for another install…".
   - Stale locks are only removed when `NVM_INSTALL_LOCK_STALE` (minutes) is
     set — default 0 means **never**. A cancelled/timed-out build that dies
     between `mkdir` and `nvm_release_install_lock` leaves a lock that fails
     every subsequent install of that version until manual removal.

## Why it's a platform issue, not a repo issue

Any repo bumping `nodeVersion` to a major the image doesn't ship hits this on
every build until the image is rebuilt — weeks of flaky/failed pipelines per
LTS transition, across all consumers of the template.

## What we did in the consuming repo (works today)

Two complementary scripts in `scripts/` of identify-consultees, for reference:

- `ci-preinstall-node.sh <major>` — runs once per job **before** the first
  `node_script` step. Performs the shared install with
  `NVM_INSTALL_LOCK_STALE=15` and `NVM_INSTALL_LOCK_TIMEOUT=1200`, so waits are
  bounded and dead locks get stolen. Afterwards every template `nvm use` resolves
  an installed version and never touches the lock.
- `ci-use-latest-node.sh <major>` — sourced inside `npm ci` steps: if the
  resolved version fails `engines` it installs the true latest into a **private**
  `mktemp` `NVM_DIR` — immune to the shared lock entirely.

## Recommended fixes in `common-pipeline-templates`

### 1. (Preferred) Never install into the shared nvm dir from `node_script.yml`

Redirect `NVM_DIR` to a per-agent private dir **after** sourcing bashrc (which
hard-exports the shared path — order matters):

```bash
source ~/.bashrc
export NVM_DIR="${NVM_PRIVATE_DIR:-$(Agent.TempDirectory)/nvm}"
nvm use ${{ parameters.nodeVersion }} || nvm install ${{ parameters.nodeVersion }}
```

`nvm` resolves `NVM_DIR` at call time, so no image change is needed. The first
step on an agent pays one ~50MB download; `$(Agent.TempDirectory)` persists for
the job so later steps reuse it. Removes the shared lock from the critical path
entirely.

### 2. (Minimum) Set sane lock defaults inside the template

```bash
export NVM_INSTALL_LOCK_STALE="${NVM_INSTALL_LOCK_STALE:-15}"
export NVM_INSTALL_LOCK_TIMEOUT="${NVM_INSTALL_LOCK_TIMEOUT:-1200}"
```

Converts guaranteed-fail into bounded-wait: live holders finish (a binary
install takes well under a minute), stale locks get stolen at 15 minutes. Does
not remove serialization, but makes races self-healing.

### 3. Optional: expose a dedicated install step template

e.g. `steps/node_install.yml` that pre-warms a version once per job, so
consumers don't hand-roll seed steps.

## Recommended fixes in the agent image (`infrastructure-tooling` `tools.sh`)

- Append `export NVM_INSTALL_LOCK_STALE="${NVM_INSTALL_LOCK_STALE:-15}"` to
  `/etc/skel/.bashrc` so every consumer inherits self-healing behaviour.
- Use the conditional form `export NVM_DIR="${NVM_DIR:-/usr/local/nvm}"` so
  pipeline steps _can_ redirect installs via env vars when they need isolation.
- Bake new LTS majors into the image closer to their release — the entire race
  window exists only while the image lags the LTS line.

## Triaging the step log

| Log line                                                              | Meaning                                                   | Action                                                         |
| --------------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------- |
| `Waiting for another install of vX.Y.Z to finish...`                  | Another install holds the lock                            | Usually resolves within ~1 min if the holder is alive          |
| `Removing stale install lock for vX.Y.Z (older than N minute(s))`     | Stale-lock stealing is configured and working             | None                                                           |
| `Timed out after Ns waiting for another install of vX.Y.Z to finish.` | Lock never released in time (dead holder or >N s install) | Remove `/usr/local/nvm/.cache/locks/vX.Y.Z` on the agent VM(s) |
| `EACCES` / download errors during `nvm install`                       | Shared dir not writable / network issue                   | Agent-image or pool issue                                      |
| `EBADENGINE` inside `npm ci`                                          | `nvm use` resolved a version below `engines.node`         | Check what `nvm use <major>` actually resolved                 |
