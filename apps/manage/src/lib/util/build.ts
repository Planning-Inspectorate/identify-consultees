import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as sass from 'sass';
import { copyFile, copyFolder } from './copy.ts';

interface SassOptions {
	staticDir: string;
	srcDir: string;
	/**
	 * The root of the repository where `node_modules` can be found
	 */
	repoRoot: string;
	/**
	 * a file to update with the new css filename
	 */
	localsFile?: string;
	/**
	 * If true, the style file name will be 'style.css' and the version hash will be appended as a query string
	 * parameter (e.g. `style.css?v=<hash>`).
	 */
	useQueryStringForHash?: boolean;
}

interface BuildOptions extends SassOptions {
	accessibleAutocompleteRoot?: string;
	copyMoj?: boolean;
	/**
	 * If true, will append the version number to the copied asset files
	 * (govuk-frontend, moj-frontend, accessible-autocomplete)
	 */
	applyAssetVersioning?: boolean;
	/**
	 * If true, will generate a JSON manifest file in <staticDir>/manifest.json
	 * with JSON content of `style.css`: '<style-href>' mapping
	 */
	generateManifestFile?: boolean;
}

interface Manifest {
	'style.css': string;
	'govuk-frontend.min.js': string;
	'moj-frontend.min.js'?: string;
	'accessible-autocomplete.min.js'?: string;
	'accessible-autocomplete.min.css'?: string;
}

/**
 * Compile sass into a css file in the .static folder
 * Optionally, update a file which contains the css file name
 * Return the href to the generated css file
 *
 * @see https://sass-lang.com/documentation/js-api/#md:usage
 */
async function compileSass({
	staticDir,
	srcDir,
	repoRoot,
	localsFile,
	useQueryStringForHash
}: SassOptions): Promise<string> {
	const styleFile = path.join(srcDir, 'app', 'sass/style.scss');
	const out = sass.compile(styleFile, {
		// ensure scss can find the govuk-frontend folders
		loadPaths: [repoRoot],
		style: 'compressed',
		// don't show depreciate warnings for govuk
		// see https://frontend.design-system.service.gov.uk/importing-css-assets-and-javascript/#silence-deprecation-warnings-from-dependencies-in-dart-sass
		quietDeps: true
	});

	// cache-busting: generate a filename for the css based on the content
	const hash = crypto.createHash('sha256').update(out.css).digest('hex').slice(0, 8);
	const suffix = useQueryStringForHash ? '' : `-${hash}`;
	const filename = `style${suffix}.css`;
	const outputPath = path.join(staticDir, filename);

	// make sure the static directory exists
	await fs.mkdir(staticDir, { recursive: true });

	// write the css file
	await fs.writeFile(outputPath, out.css);

	const styleHref = useQueryStringForHash ? `${filename}?v=${hash}` : filename;
	if (localsFile) {
		// update the given file with the new css filename
		await replaceInFile(localsFile, [
			{
				// matches:
				// 'style.css'
				// 'style-<hash>.css'
				// 'style.css?v=<hash>'
				replace: /'style(-[0-9a-f]{8})?\.css(\?v=[0-9a-f]{8})?'/,
				with: `'${styleHref}'`
			}
		]);
	}

	await deleteOldCssFiles({ staticDir, filename });
	return styleHref;
}

/**
 * Delete any old style.css and style-${hash}.css files
 *
 * @param staticDir
 * @param filename
 */
async function deleteOldCssFiles({ staticDir, filename }: { staticDir: string; filename: string }): Promise<void> {
	const files = await fs.readdir(staticDir);
	const oldStyleFiles = files.filter(
		(file) => file !== filename && file.endsWith('.css') && file.match(/^style(-[0-9a-f]{8})?\.css$/)
	);
	const deleteTasks = [];
	for (const file of oldStyleFiles) {
		deleteTasks.push(fs.unlink(path.join(staticDir, file)));
	}
	await Promise.all(deleteTasks);
}

interface AssetsHrefs {
	govukBaseFileName: string;
	mojBaseFileName?: string;
}

/**
 * Copy govuk assets into the .static folder
 * Will also copy moj assets if copyMoj is set
 *
 * @see https://frontend.design-system.service.gov.uk/importing-css-assets-and-javascript/#copy-the-font-and-image-files-into-your-application
 */
async function copyAssets({
	staticDir,
	repoRoot,
	copyMoj,
	applyAssetVersioning
}: {
	staticDir: string;
	repoRoot: string;
	copyMoj?: boolean;
	applyAssetVersioning?: boolean;
}): Promise<AssetsHrefs> {
	const govukRoot = path.join(repoRoot, 'node_modules/govuk-frontend/dist/govuk');
	let govukBaseFileName = 'govuk-frontend';
	const images = path.join(govukRoot, 'assets/images');
	const fonts = path.join(govukRoot, 'assets/fonts');
	const js = path.join(govukRoot, 'govuk-frontend.min.js');
	const manifest = path.join(govukRoot, 'assets/manifest.json');

	if (applyAssetVersioning) {
		govukBaseFileName = await getVersionedName(
			path.join(repoRoot, 'node_modules/govuk-frontend/package.json'),
			govukBaseFileName
		);
	}

	const staticImages = path.join(staticDir, 'assets', 'images');
	const staticFonts = path.join(staticDir, 'assets', 'fonts');
	const staticJs = path.join(staticDir, 'assets', 'js', `${govukBaseFileName}.min.js`);
	const staticManifest = path.join(staticDir, 'assets', 'manifest.json');

	// copy all images and fonts for govuk-frontend
	await copyFolder(images, staticImages);
	await copyFolder(fonts, staticFonts);
	await copyFile(js, staticJs);
	await copyFile(manifest, staticManifest);

	const assetsHrefs: AssetsHrefs = {
		govukBaseFileName
	};

	if (copyMoj) {
		const mojRoot = path.join(repoRoot, 'node_modules/@ministryofjustice/frontend');
		let mojBaseFileName = 'moj-frontend';
		const mojImages = path.join(mojRoot, 'moj/assets/images');
		const mojJs = path.join(mojRoot, 'moj/moj-frontend.min.js');

		if (applyAssetVersioning) {
			mojBaseFileName = await getVersionedName(path.join(mojRoot, 'package.json'), mojBaseFileName);
		}
		const staticMojJs = path.join(staticDir, 'assets', 'js', `${mojBaseFileName}.min.js`);
		// copy images and js for @ministryofjustice/frontend
		await copyFolder(mojImages, staticImages);
		await copyFile(mojJs, staticMojJs);
		assetsHrefs.mojBaseFileName = mojBaseFileName;
	}

	return assetsHrefs;
}

/**
 * Copy accessible-autocomplete assets into the .static folder
 * @param staticDir
 * @param root - the root of the accessible-autocomplete package (where the minified js and css files are located)
 * @param [applyAssetVersioning] - if true, will append the version number to the copied autocomplete asset files
 */
async function copyAutocompleteAssets({
	staticDir,
	root,
	applyAssetVersioning
}: {
	staticDir: string;
	root: string;
	applyAssetVersioning?: boolean;
}): Promise<string> {
	const js = path.join(root, 'accessible-autocomplete.min.js');
	const css = path.join(root, 'accessible-autocomplete.min.css');

	let baseFileName = 'accessible-autocomplete';
	if (applyAssetVersioning) {
		baseFileName = await getVersionedName(path.join(root, 'package.json'), baseFileName);
	}

	const staticJs = path.join(staticDir, 'assets', 'js', `${baseFileName}.min.js`);
	const staticCss = path.join(staticDir, 'assets', 'css', `${baseFileName}.min.css`);

	await copyFile(js, staticJs);
	await copyFile(css, staticCss);

	return baseFileName;
}

/**
 * Replace content in files and overwrite them
 *
 * @param file
 * @param replacements
 */
async function replaceInFile(file: string, replacements: { replace: string | RegExp; with: string }[]): Promise<void> {
	let newContent = await fs.readFile(file, 'utf8');
	for (const replacement of replacements) {
		if (replacement.replace instanceof RegExp) {
			newContent = newContent.replace(replacement.replace, replacement.with);
		} else {
			newContent = newContent.replaceAll(replacement.replace, replacement.with);
		}
	}
	await fs.writeFile(file, newContent, 'utf8');
}

async function generateManifest(
	staticDir: string,
	options: { styleHref: string; assetsHrefs: AssetsHrefs; autocompleteBaseFilename?: string },
	generateManifestFile = false
): Promise<Manifest> {
	const manifest: Manifest = {
		'style.css': options.styleHref,
		'govuk-frontend.min.js': `${options.assetsHrefs.govukBaseFileName}.min.js`,
		...(options.assetsHrefs.mojBaseFileName && {
			'moj-frontend.min.js': `${options.assetsHrefs.mojBaseFileName}.min.js`
		}),
		...(options.autocompleteBaseFilename && {
			'accessible-autocomplete.min.js': `${options.autocompleteBaseFilename}.min.js`,
			'accessible-autocomplete.min.css': `${options.autocompleteBaseFilename}.min.css`
		})
	};

	if (generateManifestFile) {
		await fs.writeFile(path.join(staticDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
	}
	return manifest;
}

async function getVersionedName(packageJsonPath: string, basename: string): Promise<string> {
	try {
		const version = JSON.parse(await fs.readFile(packageJsonPath, 'utf8')).version;
		return `${basename}-${version}`;
	} catch {
		// if the package.json file doesn't exist, just return the unversioned name
		return basename;
	}
}

/**
 * Do all steps to run the build
 */
export async function runBuild({
	staticDir,
	srcDir,
	repoRoot,
	copyMoj,
	accessibleAutocompleteRoot,
	localsFile,
	useQueryStringForHash,
	generateManifestFile,
	applyAssetVersioning
}: BuildOptions): Promise<Manifest> {
	const [styleHref, assetsHrefs, autocompleteBaseFilename] = await Promise.all([
		compileSass({ staticDir, srcDir, repoRoot, localsFile, useQueryStringForHash }),
		copyAssets({ staticDir, repoRoot, copyMoj, applyAssetVersioning }),
		accessibleAutocompleteRoot
			? copyAutocompleteAssets({ staticDir, root: accessibleAutocompleteRoot, applyAssetVersioning })
			: Promise.resolve(undefined)
	]);

	return generateManifest(staticDir, { styleHref, assetsHrefs, autocompleteBaseFilename }, generateManifestFile);
}
