/**
 * Process discovery, tree termination, and proof that nothing was left behind.
 *
 * Why this module exists at all
 * -----------------------------
 * This repository has already been bitten by an orphaned world core: the Python
 * child of the viewer outlived the Node service that started it, kept the
 * history store open, and could become a second writer on it. A probe that
 * starts a service and a browser inherits that risk twice over, so "it stopped"
 * is never asserted here — it is *measured*, and a leftover is reported as a
 * tool failure rather than a successful cleanup.
 *
 * Three facts shape the implementation:
 *
 * 1. **The pid that was launched is not always the pid that must be stopped.**
 *    A Chromium browser may hand off to another process. Every process is
 *    therefore attributed twice: by the parent chain rooted at the pids this
 *    tool started, and by a unique marker string in its command line (the
 *    run's own profile directory, log file or port). Either attribution is
 *    enough to own it.
 * 2. **No pipes.** `child_process` with piped stdio can fail with EPERM under a
 *    restricted harness, so the process list is written to a file by
 *    `processes.ps1` and read from that file, and every process this tool
 *    starts has its output redirected to a log file instead of a pipe.
 * 3. **Nothing outside the tree is touched.** The kill set is exactly the pids
 *    attributed above. Another run's service, or an operator's own viewer, is
 *    never a candidate: the same discipline `scripts/viewer.ps1` follows.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ToolError } from './errors.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const helperPath = path.join(here, 'processes.ps1');

let scanCounter = 0;

/** True when a process with this pid exists (ours to signal, or someone else's). */
export function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means it exists but belongs to another user; that still counts.
    return error.code === 'EPERM';
  }
}

function normalizeRows(text) {
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  if (trimmed === '') return [];
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new ToolError(`the process snapshot is not valid JSON: ${error.message}`, {
      code: 'process_snapshot',
      cause: error,
    });
  }
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows
    .filter((row) => row !== null && typeof row === 'object')
    .map((row) => ({
      pid: Number(row.pid),
      ppid: Number(row.ppid),
      name: typeof row.name === 'string' ? row.name : '',
      commandLine: typeof row.commandLine === 'string' ? row.commandLine : '',
    }))
    .filter((row) => Number.isInteger(row.pid) && row.pid > 0);
}

function snapshotPosix(target) {
  const command = 'ps -eo pid=,ppid=,args= > "$1"';
  const result = spawnSync('sh', ['-c', command, 'browser-probe', target], { stdio: 'ignore' });
  if (result.error) {
    throw new ToolError(`cannot run ps to list processes: ${result.error.message}`, {
      code: 'process_snapshot',
      cause: result.error,
    });
  }
  if (result.status !== 0) {
    throw new ToolError(`ps exited with ${result.status} while listing processes`, {
      code: 'process_snapshot',
    });
  }
  return readFileSync(target, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      const match = /^(\d+)\s+(\d+)\s+(.*)$/.exec(line);
      if (match === null) return null;
      const commandLine = match[3];
      return {
        pid: Number(match[1]),
        ppid: Number(match[2]),
        name: path.basename(commandLine.split(' ')[0] ?? ''),
        commandLine,
      };
    })
    .filter((row) => row !== null);
}

function snapshotWindows(target) {
  const shells = ['powershell', 'pwsh'];
  const failures = [];
  for (const shell of shells) {
    const result = spawnSync(
      shell,
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        helperPath,
        '-OutPath',
        target,
      ],
      { stdio: 'ignore', windowsHide: true, timeout: 60000 },
    );
    if (result.error) {
      failures.push(`${shell}: ${result.error.message}`);
      continue;
    }
    if (result.status !== 0) {
      failures.push(`${shell}: exited ${result.status}`);
      continue;
    }
    if (!existsSync(target)) {
      failures.push(`${shell}: wrote no snapshot`);
      continue;
    }
    return normalizeRows(readFileSync(target, 'utf8'));
  }
  throw new ToolError(
    `cannot list processes: ${failures.join('; ')}\n` +
      'The probe needs one process snapshot to attribute the browser and the service to itself.',
    { code: 'process_snapshot' },
  );
}

/**
 * One snapshot of every process, so attributions can be computed in JavaScript.
 *
 * @param {string} scratchDir a directory inside the repository for the snapshot file
 * @returns {Array<{pid: number, ppid: number, name: string, commandLine: string}>}
 */
export function listProcesses(scratchDir) {
  scanCounter += 1;
  const target = path.join(scratchDir, `processes-${scanCounter}.json`);
  return process.platform === 'win32' ? snapshotWindows(target) : snapshotPosix(target);
}

/**
 * Every process below one of `roots`, found transitively.
 *
 * The whole set must be computed *before* anything is killed: once a parent is
 * gone its living children are reparented, and the chain that identified them
 * is gone with it. That is exactly how an orphan becomes unattributable.
 *
 * @param {Array<{pid: number, ppid: number}>} processes
 * @param {number[]} roots
 * @returns {number[]} descendants, roots excluded
 */
export function descendantsOf(processes, roots) {
  const children = new Map();
  for (const entry of processes) {
    if (!children.has(entry.ppid)) children.set(entry.ppid, []);
    children.get(entry.ppid).push(entry.pid);
  }
  const found = new Set();
  const queue = [...roots];
  while (queue.length > 0) {
    const pid = queue.shift();
    for (const child of children.get(pid) ?? []) {
      if (found.has(child) || roots.includes(child)) continue;
      found.add(child);
      queue.push(child);
    }
  }
  return [...found];
}

/**
 * Processes whose command line contains one of `markers`.
 *
 * The marker is a string only this run can produce: its own profile directory,
 * its own log file, or its own port. This is how a browser that replaced the
 * process which was launched is still recognised as ours.
 *
 * @param {Array<{pid: number, commandLine: string}>} processes
 * @param {string[]} markers
 * @returns {number[]}
 */
export function matchingCommandLines(processes, markers) {
  const wanted = markers.filter((marker) => typeof marker === 'string' && marker !== '');
  if (wanted.length === 0) return [];
  return processes
    .filter((entry) => entry.commandLine !== '' && wanted.some((marker) => entry.commandLine.includes(marker)))
    .map((entry) => entry.pid);
}

/**
 * Stop one process and everything below it.
 *
 * `taskkill /T` is the supported way to take a tree down on Windows, and it is
 * what `scripts/viewer.ps1` uses for the same reason: stopping the Node service
 * alone can leave its Python core holding the store. A process that has already
 * exited is not a failure — that is the common case — so the outcome is decided
 * by the verification that follows, never by this call.
 */
export function killTree(pid) {
  if (!isAlive(pid)) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
      timeout: 30000,
    });
    return;
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // Already gone, or not ours to signal; the verification decides.
  }
}

/** Stop every pid in the list, deepest last. */
export function killAll(pids) {
  for (const pid of pids) killTree(pid);
}

/**
 * Kill the given pids, then prove they are gone.
 *
 * A second look after a short pause is deliberate: a browser or a core takes a
 * moment to release its handles, and a single instantaneous check would report
 * a leftover that is on its way out. Whatever is still alive after the second
 * look is reported to the caller so it can fail loudly.
 *
 * @param {number[]} pids
 * @param {{pauseMs?: number, attempts?: number}} [options]
 * @returns {Promise<{stopped: number[], leftBehind: number[]}>}
 */
export async function killAndVerify(pids, options = {}) {
  const { pauseMs = 600, attempts = 3 } = options;
  const wanted = [...new Set(pids.filter((pid) => Number.isInteger(pid) && pid > 0))];
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  killAll(wanted);
  let leftBehind = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await sleep(pauseMs);
    leftBehind = wanted.filter((pid) => isAlive(pid));
    if (leftBehind.length === 0) break;
    killAll(leftBehind);
  }
  return { stopped: wanted.filter((pid) => !leftBehind.includes(pid)), leftBehind };
}
