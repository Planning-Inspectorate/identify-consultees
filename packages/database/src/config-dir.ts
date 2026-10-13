import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The repository's `config/` folder: the rulesets, map styles and nearby-consultee distances - every
 * file a maintainer edits to change what the service does, rather than how (see config/README.md).
 * Resolved from this file, so it's the same locally and in the Docker image, which copies `config/`
 * alongside `packages/` (apps/manage/Dockerfile).
 *
 * Deliberately dependency-free: the manage app's config imports it at build time, before the
 * generated Prisma client exists.
 */
export const CONFIG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../config');
