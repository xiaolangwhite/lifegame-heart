/**
 * browser-probe — proof that the instrument itself works.
 *
 * Why this file exists
 * --------------------
 * A measuring tool that is never checked is a source of confident nonsense: if
 * the geometry probe silently reported zero rectangles, or the interaction
 * probe never actually pressed anything, every run would look like a pass and
 * the interface would stay unobserved. This self-test therefore does not need
 * the viewer at all. It serves two pages of its own, on a port it binds itself,
 * and asserts against known numbers:
 *
 * * a **good page** whose box is at a position written in its own stylesheet,
 *   with a button that issues a request when it is pressed;
 * * a **covered page**, where an opaque element is drawn exactly over that box.
 *
 * The second page is the important one. The instrument must report the covered
 * box as a *failed* topmost check — the defect class this tool was built for —
 * so the self-test proves the probe can detect the problem, not merely that it
 * can report success.
 *
 * It also asserts the repository rule that makes this a tool rather than a
 * runtime dependency: nothing under `src/` may mention it.
 *
 * Exit codes match the tool's own contract: 0 passed, 1 an assertion failed,
 * 2 the self-test could not run (no browser, no Node WebSocket).
 */

import { createServer } from 'node:http';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { findBrowser, freePort } from './lib/browser.mjs';
import { ToolError, isToolError } from './lib/errors.mjs';
import { ensureDir, repoRoot, runStamp } from './lib/paths.mjs';
import { writeReports } from './lib/report.mjs';
import { createDeadline, runProbes } from './probe.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The box in both fixtures; its position is what the geometry probe must read. */
const BOX = Object.freeze({ x: 40, y: 30, width: 120, height: 60 });

const STYLE = `
  html, body { margin: 0; padding: 0; }
  #box { position: absolute; left: ${BOX.x}px; top: ${BOX.y}px; width: ${BOX.width}px; height: ${BOX.height}px; background: #123456; }
  #scroller { position: absolute; left: 300px; top: 30px; width: 100px; height: 50px; overflow: auto; }
  #scroller .wide { width: 400px; height: 20px; }
  #button { position: absolute; left: ${BOX.x}px; top: 200px; width: 160px; height: 40px; }`;

const GOOD_PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>browser-probe self-test</title>
<style>${STYLE}
  #veil { display: none; }</style>
</head>
<body>
  <div id="box">box</div>
  <div id="veil">veil</div>
  <div id="scroller"><div class="wide">wide</div></div>
  <button id="button" type="button">press</button>
  <script>
    document.getElementById('button').addEventListener('click', function () {
      fetch('/api/ping');
    });
  </script>
</body>
</html>`;

/**
 * The same page with the veil drawn over the box.
 *
 * `elementFromPoint` at the box's centre must therefore return the veil, and a
 * probe that cannot see that is a probe that cannot see the defect.
 */
const COVERED_PAGE = GOOD_PAGE.replace(
  '#veil { display: none; }',
  `#veil { position: absolute; left: ${BOX.x}px; top: ${BOX.y}px; width: ${BOX.width}px; height: ${BOX.height}px; background: #ffffff; }`,
);

const ROUTES = new Map([
  ['/', { type: 'text/html; charset=utf-8', body: GOOD_PAGE }],
  ['/covered', { type: 'text/html; charset=utf-8', body: COVERED_PAGE }],
  ['/api/ping', { type: 'application/json; charset=utf-8', body: '{"ok":true}\n' }],
]);

function startFixtureServer() {
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    const page = ROUTES.get(pathname);
    if (page === undefined) {
      response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
      response.end('{"ok":false,"error":"not_found"}\n');
      return;
    }
    response.writeHead(200, { 'content-type': page.type, 'cache-control': 'no-store' });
    response.end(page.body);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, port: address.port, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

/** Every file under a directory, as absolute paths. */
function walk(directory) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...walk(full));
    else if (entry.isFile()) found.push(full);
  }
  return found;
}

/**
 * The rule that keeps this a tool: `src/` must not know it exists.
 *
 * The check is textual and deliberately blunt. A probe that the product could
 * import would become part of the product's run path, with a browser
 * requirement on start-up and a second reason for the service to fail.
 */
function toolIsNotImported() {
  const sourceDir = path.join(repoRoot, 'src');
  if (!statSync(sourceDir, { throwIfNoEntry: false })?.isDirectory()) {
    return { ok: true, detail: 'src/ is absent' };
  }
  const offenders = [];
  for (const file of walk(sourceDir)) {
    const text = readFileSync(file, 'utf8');
    if (text.includes('browser-probe')) offenders.push(path.relative(repoRoot, file));
  }
  return {
    ok: offenders.length === 0,
    detail: offenders.length === 0 ? 'no file under src/ mentions browser-probe' : `mentioned by ${offenders.join(', ')}`,
  };
}

/** Run one scenario through the same code path the command line uses. */
async function runScenario(options) {
  const plan = {
    startedAt: new Date().toISOString(),
    command: ['selftest', options.route],
    mode: ['health', 'geometry', 'interaction'],
    service: options.service,
    browser: options.browser,
    route: options.route,
    routes: ['/', '/covered'],
    routesSource: 'selftest fixtures',
    unknown: '/__selftest-unknown',
    history: null,
    selectors: ['#box'],
    topmost: options.topmost,
    points: [{ x: 5, y: 5 }],
    container: '#scroller',
    click: options.click,
    drag: null,
    expectRequests: options.expectRequests,
    script: null,
    settle: 250,
    allowInput: true,
    screenshot: options.screenshot,
    outDir: options.outDir,
    scratchDir: options.outDir,
    deadline: createDeadline(120000),
    notices: [],
  };
  return runProbes(plan);
}

function findCheck(report, id) {
  return report.checks.find((entry) => entry.id === id) ?? null;
}

function eventTypes(report) {
  const events = report.probes.interaction?.events ?? [];
  return events.map((event) => event.type);
}

/**
 * The self-test entry point.
 *
 * @param {{out?: string, browser?: string, screenshot?: boolean}} [options]
 * @param {{stdout?: (text: string) => void, stderr?: (text: string) => void}} [io]
 */
export async function main(argv = [], io = {}) {
  const out = io.stdout ?? ((text) => process.stdout.write(text));
  const err = io.stderr ?? ((text) => process.stderr.write(text));

  const options = { out: null, browser: undefined, screenshot: true };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--out') options.out = argv[index + 1];
    else if (argv[index] === '--browser') options.browser = argv[index + 1];
    else if (argv[index] === '--no-screenshot') options.screenshot = false;
    else if (argv[index] === '--help') {
      out('usage: node tools/browser-probe/selftest.mjs [--out <dir>] [--browser <path>] [--no-screenshot]\n');
      return 0;
    }
  }

  const assertions = [];
  const expect = (name, ok, detail) => assertions.push({ name, ok: ok === true, detail: detail ?? '' });

  let fixture = null;
  let summary = null;
  try {
    if (typeof WebSocket !== 'function') {
      throw new ToolError(
        `this Node (${process.version}) has no global WebSocket; Node 22 or newer is required`,
        { code: 'no_websocket' },
      );
    }
    const found = findBrowser(options.browser);
    const outDir = ensureDir(
      options.out ?? path.join(process.env.TEMP ?? repoRoot, 'browser-probe', `selftest-${runStamp()}`),
      'report directory',
    );

    fixture = await startFixtureServer();
    const service = {
      origin: fixture.origin,
      base: '',
      started: false,
      child: null,
      port: fixture.port,
      logPath: null,
    };
    const cdpPort = await freePort();
    const browser = {
      exe: found.path,
      source: found.source,
      cdpPort,
      width: 1024,
      height: 768,
      profileDir: ensureDir(path.join(outDir, 'selftest-profile-1'), 'browser profile directory'),
      logPath: path.join(outDir, 'selftest-browser-1.log'),
    };

    out(`browser-probe self-test\nfixtures ${fixture.origin}\nbrowser  ${found.path}\nout      ${outDir}\n\n`);

    // ---- scenario 1: a page with nothing wrong with it --------------------
    const good = await runScenario({
      service,
      browser,
      route: '/',
      topmost: ['#box'],
      click: { kind: 'selector', selector: '#button' },
      expectRequests: ['/api/ping'],
      outDir,
      screenshot: options.screenshot,
    });
    const goodReport = good.report;

    expect('good page: exit code 0', goodReport.exitCode === 0, `status ${goodReport.status}, ${JSON.stringify(goodReport.summary)}`);
    expect(
      'good page: every check passed',
      goodReport.checks.every((entry) => entry.status === 'pass'),
      goodReport.checks.filter((entry) => entry.status !== 'pass').map((entry) => `${entry.id}=${entry.status}`).join(', ') || 'none',
    );
    expect(
      'good page: page.loaded and page.errors are checks that passed',
      findCheck(goodReport, 'page.loaded')?.status === 'pass' && findCheck(goodReport, 'page.errors')?.status === 'pass',
      `page.loaded=${findCheck(goodReport, 'page.loaded')?.status}, page.errors=${findCheck(goodReport, 'page.errors')?.status}`,
    );

    const measured = goodReport.probes.geometry?.snapshot?.elements?.[0]?.first ?? null;
    const geometryIsExact =
      measured !== null &&
      measured.x === BOX.x &&
      measured.y === BOX.y &&
      measured.width === BOX.width &&
      measured.height === BOX.height;
    expect(
      'geometry probe: the box is measured where the stylesheet puts it',
      geometryIsExact,
      measured === null ? 'no measurement' : `x ${measured.x}, y ${measured.y}, ${measured.width}x${measured.height}`,
    );

    const container = goodReport.probes.geometry?.snapshot?.container ?? null;
    expect(
      'geometry probe: the scroll container reports real scroll metrics',
      container !== null && container.found === true && container.scrollWidth > container.clientWidth,
      container === null ? 'no container measurement' : `scrollWidth ${container.scrollWidth}, clientWidth ${container.clientWidth}, clientHeight ${container.clientHeight}`,
    );

    const sequence = eventTypes(goodReport);
    expect(
      'interaction probe: a real press, release and click reach the page',
      sequence.includes('pointerdown') && sequence.includes('pointerup') && sequence.includes('click'),
      sequence.join(' > ') || 'no events',
    );
    expect(
      'interaction probe: the press is followed by the request the handler makes',
      (goodReport.probes.interaction?.inputRequests ?? []).some((entry) => String(entry.url).includes('/api/ping')),
      JSON.stringify((goodReport.probes.interaction?.inputRequests ?? []).map((entry) => `${entry.method} ${entry.url} ${entry.status}`)),
    );
    expect(
      'interaction probe: the declared request expectation passed',
      findCheck(goodReport, 'interaction.request:/api/ping')?.status === 'pass',
      findCheck(goodReport, 'interaction.request:/api/ping')?.actual ?? 'no check',
    );

    // ---- scenario 2: the same page, with the box covered ------------------
    const covered = await runScenario({
      service,
      browser: { ...browser, cdpPort: await freePort(), profileDir: ensureDir(path.join(outDir, 'selftest-profile-2'), 'browser profile directory'), logPath: path.join(outDir, 'selftest-browser-2.log') },
      route: '/covered',
      topmost: ['#box'],
      click: { kind: 'point', x: BOX.x + 10, y: BOX.y + 10 },
      expectRequests: [],
      outDir,
      screenshot: options.screenshot,
    });
    const coveredReport = covered.report;
    const topmost = findCheck(coveredReport, 'geometry.topmost:#box');

    expect(
      'covered page: the run reports a mismatch rather than a pass',
      coveredReport.exitCode === 1 && coveredReport.status === 'mismatch',
      `status ${coveredReport.status}, exit ${coveredReport.exitCode}`,
    );
    expect(
      'covered page: the topmost check fails and names the element on top',
      topmost?.status === 'fail' && String(topmost.actual).includes('#veil'),
      topmost === null ? 'no check' : `${topmost.status}: ${topmost.actual}`,
    );
    expect(
      'covered page: the page still loads, so only the occlusion failed',
      coveredReport.checks.filter((entry) => entry.status === 'fail').every((entry) => entry.id === 'geometry.topmost:#box'),
      coveredReport.checks.filter((entry) => entry.status === 'fail').map((entry) => entry.id).join(', ') || 'none failed',
    );

    // ---- scenario 3: the rule that keeps this a tool ----------------------
    const purity = toolIsNotImported();
    expect('repository rule: nothing under src/ mentions the probe', purity.ok, purity.detail);

    // ---- the reports the scenarios produced are real files ----------------
    const goodPaths = writeReports(goodReport, outDir);
    const coveredPaths = writeReports(coveredReport, path.join(outDir, 'covered'));
    const parsed = JSON.parse(readFileSync(goodPaths.json, 'utf8'));
    expect(
      'reports: report.json parses and carries the measured numbers',
      parsed.probes?.geometry?.snapshot?.elements?.[0]?.first?.width === BOX.width,
      goodPaths.json,
    );

    summary = { outDir, good: goodReport, covered: coveredReport, goodPaths, coveredPaths };
  } catch (error) {
    const reason = isToolError(error) ? error.message : (error.stack ?? error.message);
    err(`browser-probe self-test: not run: ${reason}\n`);
    return 2;
  } finally {
    if (fixture !== null) await new Promise((resolve) => fixture.server.close(resolve));
  }

  out('assertions\n');
  let failed = 0;
  for (const assertion of assertions) {
    if (assertion.ok) out(`  PASS  ${assertion.name}\n`);
    else {
      failed += 1;
      out(`  FAIL  ${assertion.name}${assertion.detail === '' ? '' : ` - ${assertion.detail}`}\n`);
    }
  }
  out(`\nreports ${summary?.goodPaths.json ?? ''}\n        ${summary?.goodPaths.text ?? ''}\n`);
  if (failed > 0) {
    out(`\nRESULT  self-test failed: ${failed} of ${assertions.length} assertion(s) (exit 1)\n`);
    return 1;
  }
  out(`\nRESULT  self-test passed: ${assertions.length} assertion(s) (exit 0)\n`);
  return 0;
}

const runDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.join(here, 'selftest.mjs');

if (runDirectly) {
  process.exitCode = await main(process.argv.slice(2));
}
