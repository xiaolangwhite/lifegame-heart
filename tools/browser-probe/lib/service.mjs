/**
 * Starting the viewer for a probe, or attaching to one that is already running.
 *
 * Two modes, and the difference is a safety property rather than a convenience:
 *
 * * **Started here** — the probe picks a free port, starts
 *   `src/viewer/server.mjs` with its output in a log file, waits until it
 *   answers, and reaps the whole tree when it is done. A history is off by
 *   default so a probe can never contend for the store an operator is using,
 *   which is the same choice `scripts/viewer.ps1 -SmokeTest` makes.
 * * **Attached** — the caller names a service (`--service <url>`). Nothing is
 *   started and nothing is stopped, because the process is not this tool's to
 *   end. The interaction probe is disabled in this mode unless `--allow-input`
 *   says otherwise: a real press on a service somebody is using can move their
 *   world, and a measurement must not have side effects the operator did not
 *   ask for.
 *
 * The port is chosen by binding port zero and releasing it, rather than read
 * from the service's own startup line: reading that line would mean piping a
 * child's stdout, and this tool deliberately never pipes to a child process.
 */

import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import path from 'node:path';

import { ToolError } from './errors.mjs';

/** Normalise a `--service` value into an origin with no trailing slash. */
export function parseServiceUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw new ToolError(`--service is not a URL: ${value}`, { code: 'bad_service', cause: error });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ToolError(`--service must be an http or https URL, got ${url.protocol}`, { code: 'bad_service' });
  }
  const origin = `${url.protocol}//${url.host}`;
  const base = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
  return { origin, base, raw: value };
}

/**
 * Wait until a URL answers, whatever the status.
 *
 * "Answers" and not "answers 200": the health probe is what judges status
 * codes, and a service that replies 500 is a service the probe can measure.
 * Only a connection that never completes is a start-up failure.
 *
 * @param {string} url
 * @param {{timeoutMs?: number, child?: import('node:child_process').ChildProcess, logPath?: string}} [options]
 */
export async function waitForHttp(url, options = {}) {
  const { timeoutMs = 30000, child = null, logPath = null } = options;
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child !== null && child.exitCode !== null) {
      throw new ToolError(
        `the viewer exited with code ${child.exitCode} before it answered ${url}` +
          (logPath === null ? '' : `; its log is ${logPath}`),
        { code: 'service_exited' },
      );
    }
    try {
      await fetch(url, { signal: AbortSignal.timeout(2000), redirect: 'manual' });
      return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new ToolError(
    `nothing answered ${url} within ${timeoutMs} ms` +
      (lastError === null ? '' : `; last error: ${lastError.message}`) +
      (logPath === null ? '' : `\nThe viewer's own log is ${logPath}.`),
    { code: 'service_timeout' },
  );
}

/**
 * Start the viewer on a free port and wait until it answers.
 *
 * @param {{serverPath: string, port: number, historyPath: string|null, logPath: string,
 *   readyTimeoutMs?: number}} options
 */
export async function startService(options) {
  const { serverPath, port, historyPath, logPath, readyTimeoutMs = 45000 } = options;
  const args = [serverPath, '--port', String(port), '--host', '127.0.0.1'];
  if (historyPath === null) args.push('--no-history');
  else args.push('--history', historyPath);

  const fd = openSync(logPath, 'a');
  let child;
  try {
    child = spawn(process.execPath, args, {
      stdio: ['ignore', fd, fd],
      windowsHide: true,
      detached: false,
    });
  } finally {
    closeSync(fd);
  }
  child.on('error', () => {
    // Surfaced by the readiness wait, which reports the exit state and the log.
  });

  const origin = `http://127.0.0.1:${port}`;
  await waitForHttp(origin, { timeoutMs: readyTimeoutMs, child, logPath });
  return { origin, base: '', child, port, args, logPath, started: true };
}

/**
 * The viewer's own path inside the repository.
 *
 * `src/viewer/server.mjs` is the service's documented entry point; the tool
 * starts the same module `scripts/viewer.ps1` starts, so a probe measures the
 * shipped service rather than a variant of it.
 */
export function viewerServerPath(repoRoot) {
  return path.join(repoRoot, 'src', 'viewer', 'server.mjs');
}
