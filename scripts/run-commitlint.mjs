#!/usr/bin/env node
/**
 * Lint commits on this branch since it diverged from origin/main.
 * Kept out of package.json so IDE npm task detection is not confused by nested $(...).
 */
import { execFileSync, execSync } from 'node:child_process';

const cherryLine = execSync('git cherry origin/main', { encoding: 'utf8' })
	.trim()
	.split('\n')
	.find((line) => line.length > 0);

if (!cherryLine) {
	console.log('No commits ahead of origin/main; nothing to commitlint.');
	process.exit(0);
}

const firstSha = cherryLine.slice(2).trim();
const from = execFileSync('git', ['rev-parse', `${firstSha}^1`], { encoding: 'utf8' }).trim();

execFileSync('npx', ['commitlint', `--from=${from}`], { stdio: 'inherit' });
