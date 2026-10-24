/**
 * Finding a browser, starting it headless, and connecting to a page it serves.
 *
 * Discovery is by convention, never by a path written into this file. A
 * checkout on a different machine has its browser somewhere else, so the search
 * is: an explicit `--browser` path, then `LIFEGAME_BROWSER`, then the names on
 * `PATH`, then the installation directories the operating system defines
 * (`ProgramFiles`, `LOCALAPPDATA`, `/Applications`, `/usr/bin`). A machine with
 * no Chromium-family browser is not a failure of the interface under test — it
 * is the tool being unable to run, which is exit code 2 with a message that
 * names the two ways to point the tool at one.
 *
 * The browser is launched with a profile directory inside the run's own output
 * folder. Two reasons, and both are about attribution: a fresh profile cannot
 * inherit an extension, a cached page or a signed-in session from the person
 * running the probe, and the profile path is a string no other process on the
 * machine contains, which is what makes the browser's processes identifiable
 * when they are reaped.
 */

import { closeSync, existsSync, openSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

import { CdpClient } from './cdp.mjs';
import { ToolError } from './errors.mjs';

/** Environment variables that may name a browser, most specific first. */
const BROWSER_ENV_VARS = ['LIFEGAME_BROWSER', 'BROWSER_PROBE_BROWSER'];

const WINDOWS_NAMES = ['msedge.exe', 'chrome.exe', 'chromium.exe', 'brave.exe'];

const WINDOWS_DIRS = [
  ['ProgramFiles(x86)', 'Microsoft\\Edge\\Application'],
  ['ProgramFiles', 'Microsoft\\Edge\\Application'],
  ['LOCALAPPDATA', 'Microsoft\\Edge\\Application'],
  ['ProgramFiles', 'Google\\Chrome\\Application'],
  ['ProgramFiles(x86)', 'Google\\Chrome\\Application'],
  ['LOCALAPPDATA', 'Google\\Chrome\\Application'],
  ['ProgramFiles', 'BraveSoftware\\Brave-Browser\\Application'],
  ['ProgramFiles', 'Chromium\\Application'],
];

const POSIX_CANDIDATES = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
];

function isUsableFile(candidate) {
  try {
    return existsSync(candidate);
  } catch {
    return false;
  }
}

/**
 * Locate a Chromium-family browser.
 *
 * @param {string|undefined} explicit the `--browser` value, if any
 * @returns {{path: string, source: string}}
 */
export function findBrowser(explicit) {
  if (typeof explicit === 'string' && explicit.trim() !== '') {
    const resolved = path.resolve(explicit.trim());
    if (!isUsableFile(resolved)) {
      throw new ToolError(`the browser named on the command line does not exist: ${resolved}`, {
        code: 'browser_missing',
      });
    }
    return { path: resolved, source: 'command line' };
  }

  for (const name of BROWSER_ENV_VARS) {
    const value = process.env[name];
    if (typeof value === 'string' && value.trim() !== '') {
      const resolved = path.resolve(value.trim());
      if (isUsableFile(resolved)) return { path: resolved, source: `$${name}` };
      throw new ToolError(`$${name} names a browser that does not exist: ${resolved}`, {
        code: 'browser_missing',
      });
    }
  }

  const pathEntries = (process.env.PATH ?? '').split(path.delimiter).filter((entry) => entry !== '');
  const names = process.platform === 'win32' ? WINDOWS_NAMES : ['google-chrome', 'chromium', 'chromium-browser'];
  for (const entry of pathEntries) {
    for (const name of names) {
      const candidate = path.join(entry, name);
      if (isUsableFile(candidate)) return { path: candidate, source: 'PATH' };
    }
  }

  if (process.platform === 'win32') {
    for (const [variable, suffix] of WINDOWS_DIRS) {
      const base = process.env[variable];
      if (typeof base !== 'string' || base.trim() === '') continue;
      const directory = path.join(base, suffix);
      for (const name of WINDOWS_NAMES) {
        const candidate = path.join(directory, name);
        if (isUsableFile(candidate)) return { path: candidate, source: `%${variable}%` };
      }
    }
  } else {
    for (const candidate of POSIX_CANDIDATES) {
      if (isUsableFile(candidate)) return { path: candidate, source: 'system location' };
    }
  }

  throw new ToolError(
    'no Chromium-family browser was found.\n' +
      'The probe drives a real browser (Edge, Chrome, Chromium or Brave) and cannot run without one.\n' +
      'Point it at one explicitly, either way:\n' +
      '  --browser <path to msedge.exe or chrome.exe>\n' +
      '  LIFEGAME_BROWSER=<path to msedge.exe or chrome.exe>',
    { code: 'browser_missing' },
  );
}

/** Ask the operating system for a port nobody is listening on. */
export async function freePort() {
  const net = await import('node:net');
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

/** The arguments that make a Chromium browser headless, isolated and quiet. */
export function browserArguments(options) {
  const { cdpPort, profileDir, width, height } = options;
  return [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-default-apps',
    '--disable-sync',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-client-side-phishing-detection',
    '--disable-features=Translate,MediaRouter,OptimizationHints',
    '--metrics-recording-only',
    '--mute-audio',
    // A fixed scale factor keeps CSS pixels and device pixels the same size, so
    // the rectangles this probe reports mean the same thing on every machine.
    '--force-device-scale-factor=1',
    `--window-size=${width},${height}`,
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${cdpPort}`,
    '--remote-allow-origins=*',
    'about:blank',
  ];
}

/**
 * Start the browser with its output in a log file.
 *
 * Stdio is never a pipe: the harness this tool runs under can refuse a pipe to
 * a child process, and a log file is both allowed and more useful afterwards —
 * when a browser refuses to open its debugging port, its own explanation is in
 * that file.
 *
 * @returns {{child: import('node:child_process').ChildProcess, args: string[], logPath: string}}
 */
export function launchBrowser(options) {
  const { exe, cdpPort, profileDir, logPath, width = 1280, height = 900 } = options;
  const args = browserArguments({ cdpPort, profileDir, width, height });
  const fd = openSync(logPath, 'a');
  let child;
  try {
    child = spawn(exe, args, {
      stdio: ['ignore', fd, fd],
      windowsHide: true,
      detached: false,
    });
  } finally {
    closeSync(fd);
  }
  child.on('error', () => {
    // Reported by the readiness wait below, which reads the log file and the
    // child's exit state; an unhandled 'error' event would crash the process.
  });
  return { child, args, logPath };
}

/**
 * Wait until the browser's DevTools endpoint answers.
 *
 * @param {number} cdpPort
 * @param {{timeoutMs?: number, child?: import('node:child_process').ChildProcess, logPath?: string}} [options]
 */
export async function waitForDevTools(cdpPort, options = {}) {
  const { timeoutMs = 30000, child = null, logPath = null } = options;
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child !== null && child.exitCode !== null) {
      throw new ToolError(
        `the browser exited with code ${child.exitCode} before opening its debugging port` +
          (logPath === null ? '' : `; its log is ${logPath}`),
        { code: 'browser_exited' },
      );
    }
    try {
      const response = await fetch(`http://127.0.0.1:${cdpPort}/json/version`, {
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) return await response.json();
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new ToolError(
    `the browser did not open its debugging port (${cdpPort}) within ${timeoutMs} ms` +
      (lastError === null ? '' : `; last error: ${lastError.message}`) +
      (logPath === null ? '' : `\nIts own log is ${logPath}.`),
    { code: 'devtools_timeout' },
  );
}

/**
 * The WebSocket URL of a page target, creating one if the browser has none.
 *
 * A freshly launched browser normally has exactly one page (`about:blank`), but
 * a build that opens a different default page must not stop the probe: the
 * fallback creates a target through the browser-level endpoint.
 */
export async function pageTargetUrl(cdpPort) {
  const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
  const page = list.find((entry) => entry.type === 'page' && typeof entry.webSocketDebuggerUrl === 'string');
  if (page !== undefined) return page.webSocketDebuggerUrl;

  const version = await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json();
  const browserUrl = version.webSocketDebuggerUrl;
  if (typeof browserUrl !== 'string') {
    throw new ToolError('the browser offers no page target and no browser endpoint', { code: 'no_target' });
  }
  const browser = await CdpClient.connect(browserUrl);
  try {
    const created = await browser.send('Target.createTarget', { url: 'about:blank' });
    const again = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
    const target = again.find((entry) => entry.id === created.targetId);
    if (target === undefined || typeof target.webSocketDebuggerUrl !== 'string') {
      throw new ToolError('the browser created a target it does not list', { code: 'no_target' });
    }
    return target.webSocketDebuggerUrl;
  } finally {
    browser.close();
  }
}
