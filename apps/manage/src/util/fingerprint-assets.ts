import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createBrotliCompress, constants as zlibConstants } from 'node:zlib';

/** Content-hash segment used in fingerprinted filenames (8 hex chars). */
export const ASSET_HASH_PATTERN = /-[0-9a-f]{8}(?=\.[^.]+$)/i;

/** Compressible text-ish assets suitable for Brotli sidecars. */
const BROTLI_EXTENSIONS = new Set(['.css', '.js', '.mjs', '.svg', '.json', '.map', '.txt', '.xml', '.html']);

/** Files we fingerprint at build time (relative to staticDir, posix-style). */
const FINGERPRINT_GLOBS = [/^assets\/js\/.+\.js$/i, /^assets\/css\/.+\.css$/i, /^javascripts\/.+\.js$/i];

export type AssetManifest = {
	/** Logical path → fingerprinted public path (no leading slash). */
	assets: Record<string, string>;
};

/**
 * True when a path or filename already includes an 8-char content hash segment.
 */
export function isFingerprintedAssetPath(filePath: string): boolean {
	const base = path.basename(filePath);
	// Ignore compression sidecars when detecting fingerprinting
	const withoutBr = base.endsWith('.br') ? base.slice(0, -3) : base;
	return ASSET_HASH_PATTERN.test(withoutBr);
}

function shouldFingerprint(relativePosixPath: string): boolean {
	if (relativePosixPath.endsWith('.br')) {
		return false;
	}
	if (relativePosixPath.endsWith('.test.js')) {
		return false;
	}
	if (isFingerprintedAssetPath(relativePosixPath)) {
		return false;
	}
	return FINGERPRINT_GLOBS.some((pattern) => pattern.test(relativePosixPath));
}

function shouldBrotli(relativePosixPath: string): boolean {
	if (relativePosixPath.endsWith('.br')) {
		return false;
	}
	const ext = path.extname(relativePosixPath).toLowerCase();
	return BROTLI_EXTENSIONS.has(ext);
}

async function walkFiles(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await walkFiles(fullPath)));
		} else if (entry.isFile()) {
			files.push(fullPath);
		}
	}
	return files;
}

function toPosixRelative(staticDir: string, absolutePath: string): string {
	return path.relative(staticDir, absolutePath).split(path.sep).join('/');
}

function insertHashBeforeExtension(relativePosixPath: string, hash: string): string {
	const ext = path.posix.extname(relativePosixPath);
	const stem = relativePosixPath.slice(0, relativePosixPath.length - ext.length);
	return `${stem}-${hash}${ext}`;
}

async function hashFile(absolutePath: string): Promise<string> {
	const content = await readFile(absolutePath);
	return createHash('sha256').update(content).digest('hex').slice(0, 8);
}

async function brotliCompressFile(absolutePath: string): Promise<void> {
	const brPath = `${absolutePath}.br`;
	await pipeline(
		createReadStream(absolutePath),
		createBrotliCompress({
			params: {
				[zlibConstants.BROTLI_PARAM_QUALITY]: 11,
				[zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT
			}
		}),
		createWriteStream(brPath)
	);
}

/**
 * Fingerprint selected assets, write Brotli sidecars for fingerprinted compressible files,
 * and emit `asset-manifest.json` for template wiring.
 */
export async function fingerprintAndCompressStaticAssets(staticDir: string): Promise<AssetManifest> {
	const allFiles = await walkFiles(staticDir);
	const manifest: AssetManifest = { assets: {} };

	// Remove stale Brotli sidecars before renaming
	await Promise.all(
		allFiles.filter((filePath) => filePath.endsWith('.br')).map((filePath) => rm(filePath, { force: true }))
	);

	const filesAfterCleanup = await walkFiles(staticDir);

	for (const absolutePath of filesAfterCleanup) {
		const relative = toPosixRelative(staticDir, absolutePath);
		if (!shouldFingerprint(relative)) {
			continue;
		}

		const hash = await hashFile(absolutePath);
		const fingerprintedRelative = insertHashBeforeExtension(relative, hash);
		const fingerprintedAbsolute = path.join(staticDir, ...fingerprintedRelative.split('/'));
		await rename(absolutePath, fingerprintedAbsolute);
		manifest.assets[relative] = fingerprintedRelative;
	}

	// CSS from core is already fingerprinted as style-XXXXXXXX.css at the static root
	const styleFiles = (await readdir(staticDir)).filter((name) => /^style-[0-9a-f]{8}\.css$/i.test(name));
	for (const styleFile of styleFiles) {
		manifest.assets['style.css'] = styleFile;
	}

	const afterFingerprint = await walkFiles(staticDir);
	for (const absolutePath of afterFingerprint) {
		const relative = toPosixRelative(staticDir, absolutePath);
		if (!isFingerprintedAssetPath(relative) || !shouldBrotli(relative)) {
			continue;
		}
		await brotliCompressFile(absolutePath);
	}

	const manifestPath = path.join(staticDir, 'asset-manifest.json');
	await writeFile(manifestPath, `${JSON.stringify(manifest, null, '\t')}\n`, 'utf8');

	return manifest;
}

/**
 * Rewrite known asset path literals in a source file from the manifest.
 */
export async function applyAssetManifestToLocalsFile(localsFile: string, manifest: AssetManifest): Promise<void> {
	let content = await readFile(localsFile, 'utf8');

	const replacements: { logical: string; property: string }[] = [
		{ logical: 'assets/js/govuk-frontend.min.js', property: 'govukFrontendJs' },
		{ logical: 'javascripts/consultees-map.js', property: 'consulteesMapJs' },
		{ logical: 'javascripts/map-layers-demo.js', property: 'mapLayersDemoJs' },
		{ logical: 'assets/js/accessible-autocomplete.min.js', property: 'accessibleAutocompleteJs' },
		{ logical: 'assets/css/accessible-autocomplete.min.css', property: 'accessibleAutocompleteCss' }
	];

	for (const { logical, property } of replacements) {
		const hashed = manifest.assets[logical];
		if (!hashed) {
			continue;
		}
		const propertyPattern = new RegExp(`(${property}\\s*:\\s*)'[^']*'`);
		if (propertyPattern.test(content)) {
			content = content.replace(propertyPattern, `$1'${hashed}'`);
		}
	}

	const styleHashed = manifest.assets['style.css'];
	if (styleHashed) {
		content = content.replace(/styleFile\s*:\s*'[^']*'/, `styleFile: '${styleHashed}'`);
	}

	await writeFile(localsFile, content, 'utf8');
}

/**
 * Ensure a directory exists and is empty enough to act as a no-op express.static root.
 */
export async function ensureEmptyStaticMountDir(mountDir: string): Promise<void> {
	await rm(mountDir, { recursive: true, force: true });
	const { mkdir } = await import('node:fs/promises');
	await mkdir(mountDir, { recursive: true });
	const probe = await stat(mountDir);
	if (!probe.isDirectory()) {
		throw new Error(`Expected empty static mount directory at ${mountDir}`);
	}
}
