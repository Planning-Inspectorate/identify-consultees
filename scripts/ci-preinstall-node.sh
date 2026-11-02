#!/usr/bin/env bash
# node_script.yml's `nvm use <major> || nvm install <major>` installs into the
# pool's shared /usr/local/nvm whenever the agent image has no matching version
# preinstalled - the case for every Node major the image does not ship yet.
# nvm serialises same-version installs on a per-version lock under
# $NVM_DIR/.cache/locks: concurrent jobs queue on it, and a holder that died
# mid-install leaves it forever (NVM_INSTALL_LOCK_STALE defaults to 0 = never
# steal), so every later install waits out the 600s timeout then fails.
#
# Run this once per job, before the first node_script step, so the install -
# and any lock wait - happens here, under a longer timeout with stale-lock
# stealing. Every later `nvm use <major>` then resolves an installed version
# and never touches the lock. Once the agent image ships <major> this is a
# fast no-op ("vX.Y.Z is already installed").
set -e

MAJOR="${1:?usage: bash scripts/ci-preinstall-node.sh <node-major>}"

# Give a live holder up to 20 minutes to finish (a binary install takes
# well under a minute), and steal the lock once it is 15 minutes stale so a
# crashed install cannot wedge every job that lands on this agent.
export NVM_INSTALL_LOCK_STALE="${NVM_INSTALL_LOCK_STALE:-15}"
export NVM_INSTALL_LOCK_TIMEOUT="${NVM_INSTALL_LOCK_TIMEOUT:-1200}"

export NVM_DIR="${NVM_DIR:-/usr/local/nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

nvm install "$MAJOR"
node --version
