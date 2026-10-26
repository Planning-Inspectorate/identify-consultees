#!/usr/bin/env node
/**
 * Install Playwright browsers (and OS deps on Linux).
 *
 * On shared Ubuntu agents, `playwright install --with-deps` races with
 * unattended-upgrades holding /var/lib/dpkg/lock-frontend and fails with
 * apt exit code 100. Wait for the lock / apt processes before installing.
 */
import { spawnSync } from 'node:child_process';
import { platform } from 'node:os';

const BROWSERS = ['chromium', 'firefox', 'webkit'];
/**
 * CI runs every project headless, where the chromium headless shell is enough - skip
 * the ~190MB full-Chrome download there. Local installs keep it for headed debugging.
 */
const SHELL_ONLY = Boolean(process.env.CI || process.env.TF_BUILD);
/**
 * unattended-upgrades can hold the dpkg locks for minutes on a cold shared agent, so be patient:
 * ~2 minutes total (24 × 5s) of polite waiting before attempting install anyway - apt's own lock
 * timeout below covers the longer tail.
 */
const MAX_LOCK_WAIT_ATTEMPTS = 24;
const LOCK_POLL_SECONDS = 5;
/**
 * apt 1.9+ supports DPkg::Lock::Timeout: make apt-get itself block on the dpkg lock (up to 10
 * minutes per attempt) instead of exiting 100 the moment the lock is held. The install's internal
 * apt-get inherits it via a drop-in in apt.conf.d.
 */
const APT_LOCK_TIMEOUT_SECONDS = 600;
/**
 * If the lock is held past both waits the install still fails - wait again and retry rather than
 * failing the job outright.
 */
const MAX_INSTALL_ATTEMPTS = 3;

/**
 * @returns {boolean}
 */
function linuxAptBusy() {
	if (platform() !== 'linux') {
		return false;
	}

	const checks = [
		['fuser', ['/var/lib/dpkg/lock-frontend']],
		['fuser', ['/var/lib/dpkg/lock']],
		['fuser', ['/var/cache/apt/archives/lock']],
		['pgrep', ['-x', 'unattended-upgr']],
		['pgrep', ['-x', 'apt-get']],
		['pgrep', ['-x', 'dpkg']]
	];

	return checks.some(([cmd, args]) => {
		const result = spawnSync(cmd, args, { encoding: 'utf8' });
		return result.status === 0;
	});
}

function waitForAptLock() {
	if (platform() !== 'linux') {
		return;
	}

	for (let attempt = 1; attempt <= MAX_LOCK_WAIT_ATTEMPTS; attempt += 1) {
		if (!linuxAptBusy()) {
			if (attempt > 1) {
				console.log('dpkg/apt lock released; continuing Playwright install.');
			}
			return;
		}
		console.log(`Waiting for dpkg/apt lock (unattended-upgrades)... (${attempt}/${MAX_LOCK_WAIT_ATTEMPTS})`);
		spawnSync('sleep', [String(LOCK_POLL_SECONDS)], { stdio: 'ignore' });
	}

	console.warn('Timed out waiting for dpkg/apt lock; attempting Playwright install anyway.');
}

/**
 * Write a drop-in so the apt-get playwright shells out to waits on the dpkg lock itself rather
 * than erroring under it. Needs passwordless sudo (present on the CI agents, which already run
 * playwright's deps install as root); skipped everywhere else.
 */
function configureAptLockTimeout() {
	if (platform() !== 'linux') {
		return;
	}

	const dropIn = '/etc/apt/apt.conf.d/99-ci-dpkg-lock-timeout';
	const result = spawnSync('sudo', ['-n', 'tee', dropIn], {
		input: `DPkg::Lock::Timeout "${APT_LOCK_TIMEOUT_SECONDS}";\n`,
		encoding: 'utf8',
		stdio: ['pipe', 'ignore', 'inherit']
	});
	if (result.status === 0) {
		console.log(`Configured apt to wait up to ${APT_LOCK_TIMEOUT_SECONDS}s on the dpkg lock.`);
	} else {
		console.warn('Could not configure the apt dpkg lock timeout - relying on the pre-install wait and retries.');
	}
}

configureAptLockTimeout();
waitForAptLock();

let status = 1;
for (let attempt = 1; attempt <= MAX_INSTALL_ATTEMPTS; attempt += 1) {
	const args = ['playwright', 'install', '--with-deps'];
	if (SHELL_ONLY) {
		args.push('--only-shell');
	}
	const result = spawnSync('npx', [...args, ...BROWSERS], {
		stdio: 'inherit',
		env: process.env,
		shell: false
	});
	status = result.status ?? 1;
	if (status === 0 || attempt === MAX_INSTALL_ATTEMPTS || !linuxAptBusy()) {
		break;
	}
	console.warn(
		`Playwright install failed while the apt lock was held; retrying (${attempt}/${MAX_INSTALL_ATTEMPTS})...`
	);
	waitForAptLock();
}

process.exit(status);
