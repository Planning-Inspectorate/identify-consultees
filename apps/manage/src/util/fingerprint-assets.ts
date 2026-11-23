import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, readFileSync } from 'node:fs';
import { readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createBrotliCompress, constants as zlibConstants } from 'node:zlib';

/** Content-hash segment used in fingerprinted filenames (8 hex chars). */
const ASSET_HASH_PATTERN = /-[0-9a-f]{8}(?=\.[^.]+$)/i;

/** Compressible text-ish assets suitable for Brotli (sidecars or runtime compression). */
export const BROTLI_EXTENSIONS = new Set(['.css', '.js', '.mjs', '.svg', '.json', '.map', '.txt', '.xml', '.html']);

/** Files we fingerprint at build time (relative to staticDir, posix-style). */
const FINGERPRINT_GLOBS = [
	/^assets\/js\/.+\.js$/i,
	/^assets\/css\/.+\.css$/i,
	// .js entry points and the .mjs plugin modules they import; specifiers between
	// fingerprinted modules are rewritten to the hashed names during the build
	/^javascripts\/.+\.m?js$/i,
	// Defra vendor bundle entry points copied in at build time; webpack lazy
	// chunks under vendor/ are referenced by literal filename and must stay put
	/^vendor\/[\w-]+\/(js|css)\/index\.(js|css)$/i
];

/** Extensions whose files can hold ES module specifiers we rewrite at fingerprint time. */
const MODULE_EXTENSIONS = new Set(['.js', '.mjs']);

/**
 * A relative module specifier: `from './x'`, a bare `import './x'`, a dynamic
 * `import('./x')`. Absolute/bare specifiers (no leading dot) never match.
 */
const MODULE_SPECIFIER_PATTERN = /\b(?:from|import)\s*(?:\(\s*)?(['"])(\.[^'"]*)\1/g;

export type AssetManifest = {
	/** Logical path → fingerprinted public path (no leading slash). */
	assets: Record<string, string>;
};

/** The manifest the build writes into the static root, mapping logical → fingerprinted paths. */
export const ASSET_MANIFEST_FILENAME = 'asset-manifest.json';

/**
 * Every asset path literal config-middleware.ts emits, bound to the logical path the
 * build fingerprints it under. The build rewrites the literals from this table and the
 * runtime resolves the same properties from the manifest - one source of truth so the
 * two can never disagree.
 */
export const LOCALS_ASSET_BINDINGS: { logical: string; property: string }[] = [
	{ logical: 'style.css', property: 'styleFile' },
	{ logical: 'assets/js/govuk-frontend.min.js', property: 'govukFrontendJs' },
	{ logical: 'javascripts/consultees-map.js', property: 'consulteesMapJs' },
	{ logical: 'javascripts/consultee-autocomplete.js', property: 'consulteeAutocompleteJs' },
	{ logical: 'javascripts/consultee-select.js', property: 'consulteeSelectJs' },
	{ logical: 'javascripts/blob-upload.js', property: 'blobUploadJs' },
	{ logical: 'javascripts/sortable-table.js', property: 'sortableTableJs' },
	{ logical: 'javascripts/loading-spinner.js', property: 'loadingSpinnerJs' },
	{ logical: 'assets/js/accessible-autocomplete.min.js', property: 'accessibleAutocompleteJs' },
	{ logical: 'assets/css/accessible-autocomplete.min.css', property: 'accessibleAutocompleteCss' },
	{ logical: 'vendor/interactive-map/js/index.js', property: 'vendorInteractiveMapJs' },
	{ logical: 'vendor/interactive-map/css/index.css', property: 'vendorInteractiveMapCss' },
	{ logical: 'vendor/maplibre-provider/js/index.js', property: 'vendorMaplibreProviderJs' },
	{ logical: 'vendor/datasets-plugin/js/index.js', property: 'vendorDatasetsPluginJs' },
	{ logical: 'vendor/datasets-plugin/css/index.css', property: 'vendorDatasetsPluginCss' },
	{ logical: 'vendor/map-key-plugin/js/index.js', property: 'vendorMapKeyPluginJs' },
	{ logical: 'vendor/map-key-plugin/css/index.css', property: 'vendorMapKeyPluginCss' },
	{ logical: 'vendor/interact-plugin/js/index.js', property: 'vendorInteractPluginJs' },
	{ logical: 'vendor/draw-plugin/js/index.js', property: 'vendorDrawPluginJs' },
	{ logical: 'vendor/map-styles-plugin/js/index.js', property: 'vendorMapStylesPluginJs' },
	{ logical: 'vendor/map-styles-plugin/css/index.css', property: 'vendorMapStylesPluginCss' }
];

/**
 * True when a path or filename already includes an 8-char content hash segment.
 */
export function isFingerprintedAssetPath(filePath: string): boolean {
	const base = path.basename(filePath);
	// Ignore compression sidecars when detecting fingerprinting
	const withoutBr = base.endsWith('.br') ? base.slice(0, -3) : base;
	return ASSET_HASH_PATTERN.test(withoutBr);
}

export function shouldFingerprint(relativePosixPath: string): boolean {
	if (relativePosixPath.endsWith('.br')) {
		return false;
	}
	if (/\.test\.m?js$/.test(relativePosixPath)) {
		return false;
	}
	if (isFingerprintedAssetPath(relativePosixPath)) {
		return false;
	}
	return FINGERPRINT_GLOBS.some((pattern) => pattern.test(relativePosixPath));
}

export function shouldBrotli(relativePosixPath: string): boolean {
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
	return hashContent(content);
}

function hashContent(content: string | Buffer): string {
	return createHash('sha256').update(content).digest('hex').slice(0, 8);
}

/**
 * The fingerprinted-relative path a specifier resolves to from `importerRelative`
 * (`'./dep.mjs'` in `javascripts/app.js` -> `javascripts/dep.mjs`).
 */
function resolveSpecifier(importerRelative: string, specifier: string): string {
	return path.posix.normalize(path.posix.join(path.posix.dirname(importerRelative), specifier));
}

/**
 * importer -> the fingerprinted files it references via relative specifiers.
 * Specifiers resolving outside the fingerprinted set resolve at request time
 * and are left alone.
 */
async function fingerprintedModuleDependencies(
	fingerprintable: ReadonlyMap<string, string>
): Promise<Map<string, Set<string>>> {
	const dependencies = new Map<string, Set<string>>();
	for (const [relative, absolutePath] of fingerprintable) {
		if (!MODULE_EXTENSIONS.has(path.posix.extname(relative).toLowerCase())) {
			continue;
		}
		const content = await readFile(absolutePath, 'utf8');
		for (const match of content.matchAll(MODULE_SPECIFIER_PATTERN)) {
			const resolved = resolveSpecifier(relative, match[2]);
			if (fingerprintable.has(resolved)) {
				const set = dependencies.get(relative) ?? new Set<string>();
				set.add(resolved);
				dependencies.set(relative, set);
			}
		}
	}
	return dependencies;
}

/**
 * Fingerprintables ordered so each module comes after the fingerprinted modules
 * it imports - an importer's content (and so its hash) depends on its
 * dependencies' hashed names. Throws on a circular import: a cycle has no
 * content hash that satisfies all its members.
 */
function fingerprintOrder(relatives: Iterable<string>, dependencies: ReadonlyMap<string, Set<string>>): string[] {
	const ordered: string[] = [];
	const done = new Set<string>();
	const visiting = new Set<string>();
	const visit = (relative: string, trail: string[]): void => {
		if (done.has(relative)) {
			return;
		}
		if (visiting.has(relative)) {
			throw new Error(`circular import between fingerprinted assets: ${[...trail, relative].join(' -> ')}`);
		}
		visiting.add(relative);
		for (const dependency of dependencies.get(relative) ?? []) {
			visit(dependency, [...trail, relative]);
		}
		visiting.delete(relative);
		done.add(relative);
		ordered.push(relative);
	};
	for (const relative of relatives) {
		visit(relative, []);
	}
	return ordered;
}

/**
 * Point each relative specifier that targets an already-fingerprinted file at
 * the hashed path (`'./dep.mjs'` -> `'./dep-a1b2c3d4.mjs'`). `hashedPaths` must
 * already hold every dependency - guaranteed by processing in fingerprintOrder.
 */
function rewriteModuleSpecifiers(
	content: string,
	importerRelative: string,
	hashedPaths: ReadonlyMap<string, string>
): string {
	const importerDir = path.posix.dirname(importerRelative);
	return content.replace(MODULE_SPECIFIER_PATTERN, (match, quote: string, specifier: string) => {
		const hashed = hashedPaths.get(resolveSpecifier(importerRelative, specifier));
		if (!hashed) {
			return match;
		}
		let rewritten = path.posix.relative(importerDir, hashed);
		if (!rewritten.startsWith('.')) {
			rewritten = `./${rewritten}`;
		}
		return match.replace(`${quote}${specifier}${quote}`, `${quote}${rewritten}${quote}`);
	});
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
 *
 * Modules that import each other (`./dep.mjs`) are renamed dependencies-first and
 * each importer's specifiers rewritten to the hashed names before it is hashed.
 * An unfingerprinted module in the graph could be served stale (unfingerprinted
 * assets cache for a day) alongside a new importer - module linking then fails
 * outright (`SyntaxError: ... does not provide an export named ...`) and no code
 * in the graph runs at all.
 */
export async function fingerprintAndCompressStaticAssets(staticDir: string): Promise<AssetManifest> {
	const allFiles = await walkFiles(staticDir);
	const manifest: AssetManifest = { assets: {} };

	// Remove stale Brotli sidecars before renaming
	await Promise.all(
		allFiles.filter((filePath) => filePath.endsWith('.br')).map((filePath) => rm(filePath, { force: true }))
	);

	const filesAfterCleanup = await walkFiles(staticDir);

	const fingerprintable = new Map<string, string>();
	for (const absolutePath of filesAfterCleanup) {
		const relative = toPosixRelative(staticDir, absolutePath);
		if (shouldFingerprint(relative)) {
			fingerprintable.set(relative, absolutePath);
		}
	}

	const dependencies = await fingerprintedModuleDependencies(fingerprintable);
	const hashedPaths = new Map<string, string>();

	for (const relative of fingerprintOrder(fingerprintable.keys(), dependencies)) {
		const absolutePath = fingerprintable.get(relative) as string;
		let hash: string;
		if (dependencies.has(relative)) {
			// the specifier rewrite changes the content, so hash after rewriting;
			// writeFile rather than rename - the file's bytes differ from disk
			const rewritten = rewriteModuleSpecifiers(await readFile(absolutePath, 'utf8'), relative, hashedPaths);
			hash = hashContent(rewritten);
			await writeFile(path.join(staticDir, ...insertHashBeforeExtension(relative, hash).split('/')), rewritten);
			await rm(absolutePath);
		} else {
			hash = await hashFile(absolutePath);
			await rename(absolutePath, path.join(staticDir, ...insertHashBeforeExtension(relative, hash).split('/')));
		}
		const fingerprintedRelative = insertHashBeforeExtension(relative, hash);
		manifest.assets[relative] = fingerprintedRelative;
		hashedPaths.set(relative, fingerprintedRelative);
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

	const manifestPath = path.join(staticDir, ASSET_MANIFEST_FILENAME);
	await writeFile(manifestPath, `${JSON.stringify(manifest, null, '\t')}\n`, 'utf8');

	return manifest;
}

/**
 * Read the asset manifest a build left in `staticDir`. `null` when it is absent or
 * unreadable - callers fall back to the literals baked into config-middleware.ts,
 * which is the correct behaviour for a source tree that has never been built.
 */
export function loadAssetManifest(staticDir: string): AssetManifest | null {
	try {
		const parsed: unknown = JSON.parse(readFileSync(path.join(staticDir, ASSET_MANIFEST_FILENAME), 'utf8'));
		const assets = (parsed as AssetManifest | null)?.assets;
		if (!assets || typeof assets !== 'object') {
			return null;
		}
		return parsed as AssetManifest;
	} catch {
		return null;
	}
}

/**
 * Rewrite known asset path literals in a source file from the manifest.
 */
export async function applyAssetManifestToLocalsFile(localsFile: string, manifest: AssetManifest): Promise<void> {
	const original = await readFile(localsFile, 'utf8');
	let content = original;

	for (const { logical, property } of LOCALS_ASSET_BINDINGS) {
		const hashed = manifest.assets[logical];
		if (!hashed) {
			continue;
		}
		const propertyPattern = new RegExp(`(${property}\\s*:\\s*)'[^']*'`);
		if (propertyPattern.test(content)) {
			content = content.replace(propertyPattern, `$1'${hashed}'`);
		}
	}

	// rebuilding without an asset change must not touch the file - the dev
	// watcher keys off writes, and an unchanged rewrite would retrigger it
	if (content !== original) {
		// write-then-rename so a concurrent build or a mid-write kill can never
		// leave a torn or empty locals file (rename is atomic on the same volume)
		const tempFile = `${localsFile}.tmp`;
		await writeFile(tempFile, content, 'utf8');
		await rename(tempFile, localsFile);
	}
}

/**
 * The bound properties whose literal in `content` differs from `manifest` - the
 * check `npm run check-fingerprints` fails on. An empty list means the literals
 * are exactly what a fresh build produced. A literal present without a manifest
 * entry is a dead binding and counts as stale.
 */
export function staleLocalsAssetPaths(content: string, manifest: AssetManifest): string[] {
	return LOCALS_ASSET_BINDINGS.filter(({ logical, property }) => {
		const current = new RegExp(`${property}\\s*:\\s*'([^']*)'`).exec(content)?.[1];
		return current !== manifest.assets[logical];
	}).map(({ property }) => property);
}

/**
 * Ensure a directory exists and is empty enough to act as a no-op express.static root.
 */
export async function ensureEmptyStaticMountDir(mountDir: string): Promise<void> {
	await rm(mountDir, { recursive: true, force: true });
	const { mkdir } = await import('node:fs/promises');
	await mkdir(mountDir, { recursive: true });
}
