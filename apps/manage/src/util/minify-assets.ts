import * as esbuild from 'esbuild';
import { createHash } from 'node:crypto';
import { readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as sass from 'sass';

/** Bump when minify tool majors change so immutable filenames retarget. */
export const MINIFY_PIPELINE_ID = `esbuild@${esbuild.version}`;

/**
 * True when this relative static path should be minified before write/compress.
 * Already-`.min` govuk / accessible-autocomplete assets are left alone.
 */
export function shouldMinifyAsset(relativePosixPath: string): boolean {
	if (/\.min\.(js|css)$/i.test(relativePosixPath)) {
		return false;
	}
	if (/^javascripts\/.+\.m?js$/i.test(relativePosixPath)) {
		return true;
	}
	if (/^vendor\/[\w-]+\/(js|css)\/index\.(js|css)$/i.test(relativePosixPath)) {
		return true;
	}
	return false;
}

/**
 * Content-hash input for fingerprinted assets we minify: unminified bytes plus
 * the pipeline id so a tool-only bump cannot leave stale minified bodies under
 * the same immutable filename.
 */
export function hashUnminifiedForMinify(unminified: string | Buffer): string {
	return createHash('sha256').update(unminified).update('\0').update(MINIFY_PIPELINE_ID).digest('hex').slice(0, 8);
}

/**
 * Minify JS. First-party modules under `javascripts/` keep ESM; Defra vendor
 * entries (UMD/webpack) are minified without a format rewrite so globals stay.
 */
export function minifyJs(source: string, relativePosixPath: string): string {
	const isFirstPartyEsm = relativePosixPath.startsWith('javascripts/');
	const result = esbuild.transformSync(source, {
		loader: 'js',
		minify: true,
		legalComments: 'none',
		target: 'es2022',
		...(isFirstPartyEsm ? { format: 'esm' as const } : {})
	});
	return result.code;
}

/**
 * Minify CSS with esbuild. Chosen over lightningcss because GOV.UK Frontend
 * emits media/supports queries lightningcss rejects as invalid.
 */
export function minifyCss(source: string, relativePosixPath = 'style.css'): string {
	const result = esbuild.transformSync(source, {
		loader: 'css',
		minify: true,
		legalComments: 'none',
		target: 'es2022',
		sourcefile: relativePosixPath
	});
	return result.code;
}

export function minifyAssetContent(source: string, relativePosixPath: string): string {
	const ext = path.posix.extname(relativePosixPath).toLowerCase();
	if (ext === '.css') {
		return minifyCss(source, relativePosixPath);
	}
	if (ext === '.js' || ext === '.mjs') {
		return minifyJs(source, relativePosixPath);
	}
	return source;
}

type VendorMinifyTransforms = {
	css: (source: string, relativePosixPath: string) => string;
	js: (source: string, relativePosixPath: string) => string;
};

/**
 * Minify a vendor webpack chunk in place. Returns null when minify did not
 * shrink the file (caller may skip writing). Never renames the file.
 * `transforms` is injectable for tests that force minify failures.
 */
export function minifyVendorChunkInPlace(
	source: string,
	filePath: string,
	transforms: VendorMinifyTransforms = { css: minifyCss, js: minifyJs }
): string | null {
	const ext = path.extname(filePath).toLowerCase();
	if (ext !== '.css' && ext !== '.js' && ext !== '.mjs') {
		return null;
	}
	try {
		// chunks are webpack runtime/UMD — do not force ESM (path is not under javascripts/)
		const minified =
			ext === '.css'
				? transforms.css(source, path.basename(filePath))
				: transforms.js(source, `vendor/chunk/${path.basename(filePath)}`);
		if (!minified || minified.length >= source.length) {
			return null;
		}
		return minified;
	} catch {
		// leave the chunk untouched if minify fails — sidecars still compress it
		return null;
	}
}

/**
 * Compile app Sass expanded, hash from unminified+pipelineId, minify with
 * esbuild CSS, write `style-{hash}.css`, and remove other style*.css artifacts
 * (including core's compressed `style-*.css` from runBuild).
 */
export async function emitFingerprintedStyleCss(options: {
	staticDir: string;
	srcDir: string;
	repoRoot: string;
}): Promise<string> {
	const styleFile = path.join(options.srcDir, 'app', 'sass', 'style.scss');
	const out = sass.compile(styleFile, {
		loadPaths: [options.repoRoot],
		style: 'expanded',
		quietDeps: true
	});
	const unminified = out.css;
	const hash = hashUnminifiedForMinify(unminified);
	const filename = `style-${hash}.css`;
	const minified = minifyCss(unminified, 'style.css');
	await writeFile(path.join(options.staticDir, filename), minified, 'utf8');

	const files = await readdir(options.staticDir);
	await Promise.all(
		files
			.filter((file) => file !== filename && /^style(-[0-9a-f]{8})?\.css(\.(br|gz))?$/i.test(file))
			.map((file) => rm(path.join(options.staticDir, file), { force: true }))
	);
	return filename;
}
