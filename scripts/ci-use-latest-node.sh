#!/usr/bin/env bash
# node_script.yml's `nvm use <major>` resolves to the newest matching version
# *preinstalled on the agent image*, which can lag upstream releases - the image
# carried 24.21.0 when engines.node already floored at ^24.22.1 (October 2026
# security release). Source this before `npm ci` (or any engines-gated step):
#
#   source scripts/ci-use-latest-node.sh 24 && npm ci
#
# When the newest installed <major>.x fails check-toolchain, it installs the
# true latest into a *private* nvm dir under mktemp. The pool shares
# /usr/local/nvm across jobs: parallel `nvm install` calls race on its
# per-version lock (losers wait out a 600s timeout then fail, and a dead holder
# leaves the lock stale), and the dir may not even be agent-writable. A private
# dir has neither problem - it just costs one ~50MB download on agents whose
# image is behind, and is a no-op once the image ships a compliant 24.x.
#
# Deliberately no `set -u`: sourced into the step's shell, it would leak.
MAJOR="${1:?usage: source scripts/ci-use-latest-node.sh <node-major>}"

export NVM_DIR="${NVM_DIR:-/usr/local/nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

toolchain_ok() {
	node "$(dirname "${BASH_SOURCE[0]}")/check-toolchain.mjs" >/dev/null 2>&1
}

nvm use "$MAJOR" >/dev/null 2>&1 || true
if ! toolchain_ok; then
	export NVM_DIR="$(mktemp -d)/nvm"
	nvm install "$MAJOR"
	nvm use "$MAJOR"
fi

node --version
if ! toolchain_ok; then
	echo "Could not get a Node satisfying engines.node - see check-toolchain output above"
	exit 1
fi
