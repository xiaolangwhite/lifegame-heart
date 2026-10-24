/**
 * Where this tool is allowed to write, and what "inside the repository" means.
 *
 * The repository rule is absolute: no temporary file, cache or build
 * intermediate may be written outside the tree, and `scripts/env.ps1` is what
 * redirects the usual locations (`TEMP`, `TMP`, `TMPDIR`) into it. A probe that
 * writes its evidence to the operating system's temporary directory would break
 * that rule silently, so every output path is resolved and *checked* here
 * before anything is created, and a path outside the tree is a refusal rather
 * than a warning.
 */

import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ToolError } from './errors.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The repository root, derived from this file's own location. */
export const repoRoot = path.resolve(here, '..', '..', '..');

/** True when `candidate` resolves to the repository root or something below it. */
export function isInsideRepo(candidate) {
  const resolved = path.resolve(candidate);
  const root = repoRoot.endsWith(path.sep) ? repoRoot : repoRoot + path.sep;
  return resolved === repoRoot || resolved.startsWith(root);
}

/** True when `candidate` is the repository root itself. */
export function isRepoRoot(candidate) {
  return path.resolve(candidate) === repoRoot;
}

/**
 * Refuse a path the caller asked for that would leave the repository.
 *
 * @param {string} candidate resolved path
 * @param {string} what a short noun for the message, for example "report directory"
 */
export function requireInsideRepo(candidate, what) {
  if (!isInsideRepo(candidate)) {
    throw new ToolError(
      `the ${what} would be outside the repository: ${candidate}\n` +
        'This project may not write transient data outside its tree. Source scripts/env.ps1 ' +
        '(so TEMP points inside the repository) or pass a path inside the repository.',
      { code: 'out_of_tree' },
    );
  }
  return path.resolve(candidate);
}

/** A filesystem-safe UTC stamp, for naming one run's output directory. */
export function runStamp(now = new Date()) {
  const pad = (value, width = 2) => String(value).padStart(width, '0');
  return (
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`
  );
}

/**
 * The default output directory: one run's own folder under the redirected
 * temporary area, which `scripts/env.ps1` has already pointed inside the tree.
 */
export function defaultOutDir(stamp = runStamp()) {
  const base = process.env.TEMP || process.env.TMP || process.env.TMPDIR || '';
  if (base === '') {
    throw new ToolError(
      'no temporary directory is set (TEMP, TMP and TMPDIR are all empty).\n' +
        'Source scripts/env.ps1 first, or pass --out <directory inside the repository>.',
      { code: 'no_temp' },
    );
  }
  return path.join(base, 'browser-probe', stamp);
}

/**
 * Create a directory (and its parents) that must stay inside the repository.
 *
 * @param {string} candidate
 * @param {string} what
 */
export function ensureDir(candidate, what) {
  const resolved = requireInsideRepo(candidate, what);
  if (!existsSync(resolved)) mkdirSync(resolved, { recursive: true });
  return resolved;
}
