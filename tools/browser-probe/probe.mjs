/**
 * browser-probe — measure the interface in a real browser, on demand.
 *
 * What this is for
 * ----------------
 * The viewer's automated tests run in Node against markup, a route table and
 * stub modules. None of them has a layout engine, a hit-test tree or a canvas,
 * so none of them can see a preview that paints black, a row that never
 * receives a press, a hover that flickers between two rows, or an overlay drawn
 * over a label it should not cover. The interface has been reported blank
 * three times while the whole suite was green; the last time, four real defects
 * were found by driving a browser by hand and reading numbers out of it.
 *
 * This tool is that hand-driven session, made repeatable: it starts the shipped
 * service, drives a real browser over the DevTools Protocol, reports what it
 * measured as JSON and as text, stops everything it started, and proves that
 * nothing was left behind.
 *
 * What it is not
 * --------------
 * It is a tool, not a runtime dependency. Nothing under `src/` imports it, it
 * is not on the product's start-up path, and it needs no package from a
 * registry: Node's own module set and a browser binary are the whole
 * requirement. Its output is evidence for a person or a gate, never input to
 * the simulation.
 *
 * Usage
 * -----
 *   node tools/browser-probe/probe.mjs [options]
 *   powershell -NoProfile -ExecutionPolicy Bypass -File tools/browser-probe/run.ps1
 *
 * Exit codes
 * ----------
 *   0  every check passed
 *   1  the tool ran and at least one declared expectation did not hold
 *   2  the tool could not run, or could not clean up after itself
 */

import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { findBrowser, freePort, launchBrowser, pageTargetUrl, waitForDevTools } from './lib/browser.mjs';
import { CdpClient } from './lib/cdp.mjs';
import { ToolError, isToolError } from './lib/errors.mjs';
import { defaultOutDir, ensureDir, repoRoot, requireInsideRepo, runStamp } from './lib/paths.mjs';
import {
  descendantsOf,
  isAlive,
  killAll,
  killAndVerify,
  listProcesses,
  matchingCommandLines,
} from './lib/procs.mjs';
import {
  DEFAULT_SETTLE_MS,
  DEFAULT_UNKNOWN_PATH,
  PROBE_NAMES,
  agentSource,
  pageChecks,
  probeGeometry,
  probeHealth,
  probeInteraction,
  readRouteTable,
} from './lib/probes.mjs';
import {
  addArtifact,
  addCheck,
  addNotice,
  asciiJson,
  createReport,
  finalize,
  renderText,
  setProbe,
  writeReports,
} from './lib/report.mjs';
import { parseServiceUrl, startService, viewerServerPath } from './lib/service.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

const USAGE = `browser-probe - drive a real browser against the viewer and report what it measures.

usage: node tools/browser-probe/probe.mjs [options]

service
  --service <url>        attach to a running service; nothing is started or stopped
  --port <n>             port for the service this tool starts (0 picks a free one, default 0)
  --history <path>       record a history there instead of running without one
  --route <path>         the page the geometry and interaction probes visit (default /)
  --unknown <path>       a path the service must answer 404 for

probes
  --mode <list>          health, geometry, interaction, all (default all)
  --select <selector>    report this element's box; repeatable
  --topmost <selector>   fail unless this element is the topmost at its own centre; repeatable
  --point <x,y>          report what elementFromPoint returns there; repeatable
  --container <selector> report this element's scrollWidth and client metrics
  --click <selector|x,y> press and release there (default: the viewport centre)
  --drag <dx,dy>         move the pressed mouse before releasing it
  --expect-request <s>   fail unless a request URL contains this text; repeatable
  --script <file>        an async function body evaluated in the page; its return goes in the report
  --settle <ms>          wait after load before measuring (default ${DEFAULT_SETTLE_MS})
  --allow-input          send real input to a service named with --service

browser and output
  --browser <path>       the browser executable (or set LIFEGAME_BROWSER)
  --cdp-port <n>         a fixed DevTools port (default: a free one)
  --window-size <w,h>    viewport size (default 1280,900)
  --out <dir>            where the reports and screenshots go (default: TEMP\\browser-probe\\<stamp>)
  --no-screenshot        do not write PNG evidence
  --timeout <ms>         the whole run's budget (default 120000)
  --json                 also print report.json to standard output
  --help                 this text

exit codes
  0  every check passed
  1  at least one declared expectation did not hold
  2  the tool could not run, or left a process behind
`;

/** Turn `a,b` into numbers, with a message that names the option when it cannot. */
function parsePair(value, option) {
  const parts = String(value).split(',');
  if (parts.length !== 2) throw new ToolError(`${option} needs two numbers separated by a comma, got ${value}`);
  const numbers = parts.map((part) => Number(part.trim()));
  if (numbers.some((number) => !Number.isFinite(number))) {
    throw new ToolError(`${option} needs two numbers separated by a comma, got ${value}`);
  }
  return numbers;
}

function parseInteger(value, option, minimum, maximum) {
  const number = Number.parseInt(String(value), 10);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new ToolError(`${option} must be an integer in ${minimum}..${maximum}, got ${value}`);
  }
  return number;
}

/**
 * Read the command line.
 *
 * Repeated options accumulate; a single option keeps the last value given. An
 * unknown option is refused rather than ignored: a misspelled `--select` that
 * silently measured nothing would look exactly like a page with no problem.
 */
export function parseArgs(argv) {
  const options = {
    mode: 'all',
    service: null,
    port: 0,
    history: null,
    route: '/',
    unknown: DEFAULT_UNKNOWN_PATH,
    selectors: [],
    topmost: [],
    points: [],
    container: null,
    click: null,
    drag: null,
    expectRequests: [],
    script: null,
    settle: DEFAULT_SETTLE_MS,
    allowInput: false,
    browser: undefined,
    cdpPort: 0,
    windowSize: [1280, 900],
    out: null,
    screenshot: true,
    timeout: 120000,
    json: false,
    help: false,
  };

  const value = (index, name) => {
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) throw new ToolError(`${name} needs a value`);
    return next;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--service':
        options.service = value(index, arg);
        index += 1;
        break;
      case '--port':
        options.port = parseInteger(value(index, arg), arg, 0, 65535);
        index += 1;
        break;
      case '--history':
        options.history = value(index, arg);
        index += 1;
        break;
      case '--route':
        options.route = value(index, arg);
        index += 1;
        break;
      case '--unknown':
        options.unknown = value(index, arg);
        index += 1;
        break;
      case '--mode':
        options.mode = value(index, arg);
        index += 1;
        break;
      case '--select':
        options.selectors.push(value(index, arg));
        index += 1;
        break;
      case '--topmost':
        options.topmost.push(value(index, arg));
        index += 1;
        break;
      case '--point': {
        const [x, y] = parsePair(value(index, arg), arg);
        options.points.push({ x: Math.round(x), y: Math.round(y) });
        index += 1;
        break;
      }
      case '--container':
        options.container = value(index, arg);
        index += 1;
        break;
      case '--click': {
        const raw = value(index, arg);
        options.click = /^\s*-?\d+\s*,\s*-?\d+\s*$/.test(raw)
          ? { kind: 'point', x: Math.round(parsePair(raw, arg)[0]), y: Math.round(parsePair(raw, arg)[1]) }
          : { kind: 'selector', selector: raw };
        index += 1;
        break;
      }
      case '--drag': {
        const [dx, dy] = parsePair(value(index, arg), arg);
        options.drag = { dx: Math.round(dx), dy: Math.round(dy) };
        index += 1;
        break;
      }
      case '--expect-request':
        options.expectRequests.push(value(index, arg));
        index += 1;
        break;
      case '--script':
        options.script = value(index, arg);
        index += 1;
        break;
      case '--settle':
        options.settle = parseInteger(value(index, arg), arg, 0, 60000);
        index += 1;
        break;
      case '--allow-input':
        options.allowInput = true;
        break;
      case '--browser':
        options.browser = value(index, arg);
        index += 1;
        break;
      case '--cdp-port':
        options.cdpPort = parseInteger(value(index, arg), arg, 0, 65535);
        index += 1;
        break;
      case '--window-size': {
        const [width, height] = parsePair(value(index, arg), arg);
        options.windowSize = [Math.round(width), Math.round(height)];
        index += 1;
        break;
      }
      case '--out':
        options.out = value(index, arg);
        index += 1;
        break;
      case '--no-screenshot':
        options.screenshot = false;
        break;
      case '--timeout':
        options.timeout = parseInteger(value(index, arg), arg, 5000, 900000);
        index += 1;
        break;
      case '--json':
        options.json = true;
        break;
      default:
        throw new ToolError(`unknown option ${arg}; run with --help to see the options`);
    }
  }

  return options;
}

/** Expand `--mode` into the ordered list of probes to run. */
export function resolveMode(value) {
  const requested = String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  if (requested.includes('all')) return [...PROBE_NAMES];
  const unknown = requested.filter((entry) => !PROBE_NAMES.includes(entry));
  if (unknown.length > 0) {
    throw new ToolError(`--mode does not know ${unknown.join(', ')}; it offers ${PROBE_NAMES.join(', ')}, all`);
  }
  return PROBE_NAMES.filter((name) => requested.includes(name));
}

/** A filename-safe form of a route, for naming the screenshots of one page. */
export function slugFor(route) {
  const slug = String(route).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return slug === '' ? 'root' : slug;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The second look at the processes of this run.
 *
 * A process can be mid-exit when the first verification runs, and a browser can
 * spawn a child while its parent is being killed. So anything still
 * attributable to this run — by parent chain or by the run's own marker strings
 * — is killed once more, and only what survives *that* is reported.
 *
 * @returns {Promise<{killed: number[], survivors: number[]}>}
 */
async function secondLook(roots, markers, scratchDir) {
  const snapshot = await listProcesses(scratchDir);
  const again = [
    ...new Set([...descendantsOf(snapshot, roots), ...matchingCommandLines(snapshot, markers)]),
  ].filter((pid) => isAlive(pid));
  if (again.length === 0) return { killed: [], survivors: [] };
  killAll(again);
  await sleep(700);
  return { killed: again.filter((pid) => !isAlive(pid)), survivors: again.filter((pid) => isAlive(pid)) };
}

/** A free port that is not one of the ports already reserved for this run. */
async function freePortExcept(taken) {  for (let attempt = 0; attempt < 8; attempt += 1) {
    const port = await freePort();
    if (!taken.includes(port)) return port;
  }
  throw new ToolError('could not find a second free port; pass --port and --cdp-port explicitly', {
    code: 'no_free_port',
  });
}

/** A budget for the whole run, so no single wait can hold it open forever. */
export function createDeadline(timeoutMs) {
  const end = Date.now() + timeoutMs;
  return {
    end,
    remaining() {
      return Math.max(0, end - Date.now());
    },
    assert(what) {
      if (Date.now() >= end) {
        throw new ToolError(`the run's time budget ran out before ${what}`, { code: 'deadline' });
      }
    },
    cap(preferred) {
      return Math.max(1000, Math.min(preferred, this.remaining()));
    },
  };
}

/**
 * Run every requested probe against a fully resolved plan and return the report.
 *
 * The plan is the whole input, which is what lets `selftest.mjs` exercise the
 * same probes against a page this tool serves itself: there is one code path
 * from a decision to a measurement, and no branch that only the self-test takes.
 *
 * @param {object} plan
 * @returns {Promise<{report: object, outDir: string}>}
 */
export async function runProbes(plan) {
  const { outDir, deadline } = plan;
  const report = createReport({
    startedAt: plan.startedAt ?? new Date().toISOString(),
    command: plan.command ?? [],
    target: {
      service: plan.service.origin,
      serviceStarted: plan.service.started === true,
      route: plan.route,
      routes: plan.routes,
      routesSource: plan.routesSource,
      history: plan.history,
    },
    browser: null,
    mode: plan.mode,
  });

  for (const notice of plan.notices ?? []) addNotice(report, notice);

  const roots = [];
  const markers = [];
  if (plan.service.started === true && plan.service.child) {
    roots.push(plan.service.child.pid);
    markers.push(String(plan.service.port));
    if (plan.service.logPath) markers.push(plan.service.logPath);
  }

  let browserChild = null;
  let browserClient = null;
  let client = null;

  try {
    deadline.assert('the first probe');

    if (plan.mode.includes('health')) {
      const health = await probeHealth({
        serviceUrl: plan.service.origin + plan.service.base,
        routes: plan.routes,
        unknownPath: plan.unknown,
      });
      setProbe(report, 'health', health.measurements);
      for (const entry of health.checks) addCheck(report, entry);
    }

    const needsBrowser = plan.mode.includes('geometry') || plan.mode.includes('interaction');
    let lastSnapshot = null;

    if (needsBrowser) {
      deadline.assert('the browser could be started');
      const browser = plan.browser;
      const launched = launchBrowser({
        exe: browser.exe,
        cdpPort: browser.cdpPort,
        profileDir: browser.profileDir,
        logPath: browser.logPath,
        width: browser.width,
        height: browser.height,
      });
      browserChild = launched.child;
      roots.push(browserChild.pid);
      markers.push(browser.profileDir, browser.logPath);

      const version = await waitForDevTools(browser.cdpPort, {
        timeoutMs: deadline.cap(30000),
        child: browserChild,
        logPath: browser.logPath,
      });
      // A second connection to the browser-level endpoint, kept only so the run
      // can ask the browser to shut itself down. Killing the process tree is
      // not enough on its own: a Chromium browser runs some of its children
      // with a restricted token, and such a child can survive `taskkill /T` and
      // even answer an empty command line to a scan. Asking the browser to
      // close takes its own children down the way it knows how.
      if (typeof version.webSocketDebuggerUrl === 'string') {
        browserClient = await CdpClient.connect(version.webSocketDebuggerUrl, {
          timeoutMs: deadline.cap(15000),
        }).catch(() => null);
      }
      const product = String(version.Browser ?? '');
      const slash = product.indexOf('/');
      report.browser = {
        path: browser.exe,
        source: browser.source,
        product: slash === -1 ? product : product.slice(0, slash),
        version: slash === -1 ? null : product.slice(slash + 1),
        protocolVersion: version['Protocol-Version'] ?? null,
        cdpPort: browser.cdpPort,
        profileDir: browser.profileDir,
        windowSize: `${browser.width}x${browser.height}`,
        userAgent: version['User-Agent'] ?? null,
        log: browser.logPath,
      };

      const targetUrl = await pageTargetUrl(browser.cdpPort);
      client = await CdpClient.connect(targetUrl, { timeoutMs: deadline.cap(15000) });
      await client.enable();
      await client.addInitScript(agentSource);

      const pageUrl = `${plan.service.origin}${plan.service.base}${plan.route}`;
      const slug = slugFor(plan.route);

      if (plan.mode.includes('geometry')) {
        deadline.assert('the geometry probe');
        const geometry = await probeGeometry({
          client,
          url: pageUrl,
          selectors: plan.selectors,
          topmost: plan.topmost,
          points: plan.points,
          container: plan.container,
          settleMs: plan.settle,
          screenshot: plan.screenshot,
          outDir,
          slug,
        });
        setProbe(report, 'geometry', geometry.measurements);
        for (const entry of geometry.checks) addCheck(report, entry);
        addArtifact(report, geometry.measurements.screenshot);
        lastSnapshot = geometry.snapshot;
      }

      if (plan.mode.includes('interaction')) {
        deadline.assert('the interaction probe');
        const interaction = await probeInteraction({
          client,
          url: pageUrl,
          click: plan.click,
          drag: plan.drag,
          expectRequests: plan.expectRequests,
          settleMs: plan.settle,
          allowInput: plan.allowInput,
          screenshot: plan.screenshot,
          outDir,
          slug,
        });
        setProbe(report, 'interaction', interaction.measurements);
        for (const entry of interaction.checks) addCheck(report, entry);
        addArtifact(report, interaction.measurements.screenshot);
        if (interaction.snapshot !== null) lastSnapshot = interaction.snapshot;
      }

      if (plan.script !== null) {
        deadline.assert('the page script');
        const source = readFileSync(plan.script, 'utf8');
        let outcome;
        try {
          const result = await client.evaluate(`(async () => {\n${source}\n})()`);
          outcome = { file: plan.script, ok: true, value: result ?? null };
        } catch (error) {
          outcome = { file: plan.script, ok: false, error: error.message };
        }
        setProbe(report, 'script', outcome);
      }

      if (lastSnapshot !== null) {
        for (const entry of pageChecks(lastSnapshot, plan.mode.includes('geometry') ? 'geometry' : 'interaction')) {
          addCheck(report, entry);
        }
      }
    }
  } catch (error) {
    report.failure = {
      code: isToolError(error) ? error.code : 'internal',
      message: error.message,
      stack: isToolError(error) ? null : (error.stack ?? null),
    };
  } finally {
    if (client !== null) client.close();

    // Shut the browser down the way it knows how, before any killing starts.
    // Its own shutdown reaps children that `taskkill` cannot reach, and it is
    // the difference between "the launch process is gone" and "the browser is
    // gone". The reply may never arrive — the browser is closing the very
    // socket the request is on — so the failure is expected and ignored.
    if (browserClient !== null) {
      await browserClient.send('Browser.close').catch(() => {});
      browserClient.close();
      await sleep(1500);
    } else if (browserChild !== null) {
      await sleep(300);
    }

    // Everything started here is attributed twice — by the parent chain and by
    // a marker string only this run can contain — and then killed as a tree.
    // The verification afterwards is the point: "it stopped" is a measurement,
    // not a claim, because a leaked child is how this repository lost a store.
    try {
      deadline.assert('cleanup');
    } catch {
      // Out of budget: cleanup still runs, with whatever time it needs.
    }
    if (roots.length > 0) {
      const scratchDir = ensureDir(plan.scratchDir ?? outDir, 'scratch directory');
      const before = await listProcesses(scratchDir);
      const attributed = [
        ...new Set([...roots, ...descendantsOf(before, roots), ...matchingCommandLines(before, markers)]),
      ];
      report.cleanup.pids = attributed;

      const result = await killAndVerify(attributed, { pauseMs: 600, attempts: 3 });
      const second = await secondLook(roots, markers, scratchDir);
      report.cleanup.stopped = [...new Set([...result.stopped, ...second.killed])];
      report.cleanup.leftBehind = second.survivors;

      if (report.cleanup.leftBehind.length > 0) {
        report.cleanup.notes.push(
          `${report.cleanup.leftBehind.length} process(es) still attributed to this run after the second look`,
        );
      }
    }

    // The profile directory is the last witness. A surviving child of the
    // browser holds files in it, so a directory that cannot be removed is
    // evidence of exactly the process class that can defeat command-line
    // matching. It is deleted rather than kept because it is scratch: the
    // screenshots and the logs are the evidence a person reads.
    const profileDir = plan.browser?.profileDir ?? null;
    if (profileDir !== null) {
      let removed = false;
      for (let attempt = 0; attempt < 3 && !removed; attempt += 1) {
        try {
          rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
          removed = true;
        } catch {
          await sleep(500);
        }
      }
      report.cleanup.profileRemoved = removed;
      if (!removed) {
        report.cleanup.notes.push(
          `the browser profile directory is still in use: ${profileDir}; a browser process may have survived`,
        );
      }
    }
  }

  finalize(report);
  return { report, outDir };
}

/**
 * The command-line entry point. Returns the process exit code.
 *
 * @param {string[]} argv
 * @param {{stdout?: (text: string) => void, stderr?: (text: string) => void}} [io]
 */
export async function main(argv, io = {}) {
  const out = io.stdout ?? ((text) => process.stdout.write(text));
  const err = io.stderr ?? ((text) => process.stderr.write(text));

  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    err(`browser-probe: ${error.message}\n`);
    return 2;
  }
  if (options.help) {
    out(USAGE);
    return 0;
  }

  const deadline = createDeadline(options.timeout);
  let outDir = null;
  let service = null;
  let report = null;
  let failure = null;
  let modeList = [];

  try {
    const mode = resolveMode(options.mode);
    modeList = mode;
    outDir = ensureDir(options.out ?? defaultOutDir(runStamp()), 'report directory');

    const history =
      options.history === null ? null : requireInsideRepo(path.resolve(options.history), 'history path');

    const table = await readRouteTable(repoRoot);
    const notices = table.notice === null ? [] : [table.notice];
    const needsBrowser = mode.includes('geometry') || mode.includes('interaction');
    if (!needsBrowser) {
      notices.push('no browser probe was requested, so this run measured the HTTP surface only');
    }

    // The browser is looked for before anything is started. Starting a service
    // and then failing on the browser would cost a Python core its start-up for
    // nothing, and on a machine without a browser this is the expected path.
    const found = needsBrowser ? findBrowser(options.browser) : null;

    if (options.service !== null) {
      const parsed = parseServiceUrl(options.service);
      service = { origin: parsed.origin, base: parsed.base, started: false, child: null, port: null, logPath: null };
    } else {
      const serverPath = viewerServerPath(repoRoot);
      if (!existsSync(serverPath)) {
        throw new ToolError(`the viewer is not where it is expected: ${serverPath}`, { code: 'no_viewer' });
      }
      const port = options.port === 0 ? await freePort() : options.port;
      service = await startService({
        serverPath,
        port,
        historyPath: history,
        logPath: path.join(outDir, 'service.log'),
        readyTimeoutMs: deadline.cap(45000),
      });
      service.base = '';
    }

    let browser = null;
    if (found !== null) {
      const occupied = service.started === true && Number.isInteger(service.port) ? [service.port] : [];
      const cdpPort = options.cdpPort === 0 ? await freePortExcept(occupied) : options.cdpPort;
      browser = {
        exe: found.path,
        source: found.source,
        cdpPort,
        width: options.windowSize[0],
        height: options.windowSize[1],
        profileDir: ensureDir(path.join(outDir, 'profile'), 'browser profile directory'),
        logPath: path.join(outDir, 'browser.log'),
      };
    }

    const plan = {
      startedAt: new Date().toISOString(),
      command: [process.execPath, path.join(here, 'probe.mjs'), ...argv],
      mode,
      service,
      browser,
      route: options.route,
      routes: table.routes,
      routesSource: table.source,
      unknown: options.unknown,
      history,
      selectors: options.selectors,
      topmost: options.topmost,
      points: options.points,
      container: options.container,
      click: options.click,
      drag: options.drag,
      expectRequests: options.expectRequests,
      script: options.script === null ? null : path.resolve(options.script),
      settle: options.settle,
      // Input against a service this tool did not start is opt-in: a real press
      // on somebody's running viewer can move their world, and a measurement
      // must not have side effects they did not ask for.
      allowInput: service.started === true || options.allowInput,
      screenshot: options.screenshot,
      outDir,
      scratchDir: outDir,
      deadline,
      notices,
    };

    const result = await runProbes(plan);
    report = result.report;
  } catch (error) {
    failure = {
      code: isToolError(error) ? error.code : 'internal',
      message: error.message,
      stack: isToolError(error) ? null : (error.stack ?? null),
    };
  }

  if (report === null) {
    // The run never reached a plan. A service started before the failure still
    // has to be reaped, or the tool would leak exactly what it promises not to.
    const earlyCleanup = { pids: [], stopped: [], leftBehind: [], notes: [] };
    let cleanupHeld = false;
    if (service !== null && service.started === true && service.child) {
      try {
        const scratch =
          outDir ?? ensureDir(path.join(repoRoot, 'TEMP', 'browser-probe'), 'scratch directory');
        const snapshot = await listProcesses(scratch);
        const pids = [
          ...new Set([
            service.child.pid,
            ...descendantsOf(snapshot, [service.child.pid]),
            ...matchingCommandLines(snapshot, [String(service.port), service.logPath ?? '']),
          ]),
        ];
        const outcome = await killAndVerify(pids, { pauseMs: 600, attempts: 3 });
        earlyCleanup.pids = pids;
        earlyCleanup.stopped = outcome.stopped;
        earlyCleanup.leftBehind = outcome.leftBehind;
        cleanupHeld = outcome.leftBehind.length > 0;
        if (cleanupHeld) {
          failure.message += `\nand ${outcome.leftBehind.length} process(es) could not be stopped: ${outcome.leftBehind.join(', ')}`;
        }
      } catch (cleanupError) {
        earlyCleanup.notes.push(`cleanup did not complete: ${cleanupError.message}`);
        failure.message += `\nand cleanup failed too: ${cleanupError.message}`;
      }
    }
    report = createReport({
      startedAt: new Date().toISOString(),
      command: [process.execPath, path.join(here, 'probe.mjs'), ...argv],
      target:
        service === null
          ? null
          : {
              service: service.origin,
              serviceStarted: service.started === true,
              route: options.route,
              routes: [],
              routesSource: 'not read',
              history: null,
            },
      browser: null,
      mode: modeList,
    });
    report.failure = failure;
    // The cleanup verdict is reported as measured, not assumed: a service that
    // was started and then stopped is not "nothing was started", and a process
    // that would not stop must not be hidden by a failure that came first.
    report.cleanup = { ...report.cleanup, ...earlyCleanup };
    report.cleanup.ok = !cleanupHeld;
    finalize(report);
  }

  // Reporting is the last thing that can fail, and a failure here must not
  // become an unhandled exception: the caller reads one exit code, and the
  // contract for "the tool could not run" is 2, not a stack trace.
  try {
    const paths = outDir === null ? null : writeReports(report, outDir);
    out(`${renderText(report)}\n`);
    if (paths !== null) {
      out(`\nreport   ${paths.json}\n`);
      out(`text     ${paths.text}\n`);
    }
    if (options.json) out(`\n${asciiJson(report)}\n`);
  } catch (error) {
    err(`browser-probe: the report could not be written: ${error.message}\n`);
    return 2;
  }
  if (report.failure !== null && report.failure.stack !== null) err(`${report.failure.stack}\n`);
  return report.exitCode;
}

const runDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (runDirectly) {
  const code = await main(process.argv.slice(2));
  process.exitCode = code;
}
