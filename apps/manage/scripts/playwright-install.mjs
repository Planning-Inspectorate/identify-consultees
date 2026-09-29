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
const MAX_LOCK_WAIT_ATTEMPTS = 60;
const LOCK_POLL_SECONDS = 5;

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

waitForAptLock();

const result = spawnSync('npx', ['playwright', 'install', '--with-deps', ...BROWSERS], {
	stdio: 'inherit',
	env: process.env,
	shell: false
});

process.exit(result.status ?? 1);
