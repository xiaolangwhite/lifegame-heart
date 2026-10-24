/**
 * The three probes: page health, geometry, and interaction.
 *
 * Each probe returns *measurements* — what was observed, in numbers — together
 * with *checks*, which are the expectations the caller declared. The
 * distinction is what keeps the report honest: a measurement is reported
 * whether or not it was expected, and only a declared expectation can fail the
 * run. That is why an unattached service with no `--expect-request` produces a
 * record of the requests the page made and no verdict about them.
 *
 * The three exist because the automated suite cannot see what they see. The
 * interface has been reported blank three times while every test passed; the
 * suite asserts markup, routing and module behaviour in Node, and none of those
 * can observe a black canvas, a row that never receives a press, a hover that
 * flickers, or a closed overlay drawn over a label.
 */

import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { agentSource, pageSnapshot } from './agent.mjs';
import { ToolError } from './errors.mjs';

/** The probes a caller can name, in the order they run. */
export const PROBE_NAMES = Object.freeze(['health', 'geometry', 'interaction']);

/** The routed paths to assume when the viewer's own route table cannot be read. */
export const FALLBACK_ROUTES = Object.freeze(['/', '/world', '/history', '/archives']);

/** A path no route may claim; used to prove the service still answers 404. */
export const DEFAULT_UNKNOWN_PATH = '/__browser-probe-unknown-route';

/** How long the page is given to finish its own start-up work after load. */
export const DEFAULT_SETTLE_MS = 800;

const REQUEST_TIMEOUT_MS = 10000;

/** Build one check record. `status` is `pass`, `fail` or `skip`. */
export function check(id, probe, status, fields = {}) {
  return { id, probe, status, ...fields };
}

/**
 * The route list, read from the service's own route table when it is there.
 *
 * Reading `src/viewer/routes.mjs` rather than repeating its paths is the same
 * choice the service itself makes when it derives the navigation from the
 * routes: two lists would drift, and the one that drifts is the one nobody
 * reads. The reader is defensive because it must not become the reason a probe
 * cannot run: a module that has moved, changed shape or throws yields the
 * built-in list and a notice saying so.
 *
 * @param {string} repoRoot
 * @returns {Promise<{routes: string[], source: string, notice: string|null}>}
 */
export async function readRouteTable(repoRoot) {
  const file = path.join(repoRoot, 'src', 'viewer', 'routes.mjs');
  if (!existsSync(file)) {
    return {
      routes: [...FALLBACK_ROUTES],
      source: 'built-in list',
      notice: `no route table at ${path.relative(repoRoot, file)}; using the built-in path list`,
    };
  }
  try {
    const module = await import(pathToFileURL(file).href);
    if (!Array.isArray(module.ROUTES)) {
      return {
        routes: [...FALLBACK_ROUTES],
        source: 'built-in list',
        notice: 'the route table exports no ROUTES array; using the built-in path list',
      };
    }
    const routes = [];
    for (const route of module.ROUTES) {
      for (const routePath of route?.paths ?? []) {
        if (typeof routePath === 'string' && !routes.includes(routePath)) routes.push(routePath);
      }
    }
    if (routes.length === 0) {
      return {
        routes: [...FALLBACK_ROUTES],
        source: 'built-in list',
        notice: 'the route table declares no paths; using the built-in path list',
      };
    }
    return { routes, source: 'src/viewer/routes.mjs', notice: null };
  } catch (error) {
    return {
      routes: [...FALLBACK_ROUTES],
      source: 'built-in list',
      notice: `the route table could not be read (${error.message}); using the built-in path list`,
    };
  }
}

/**
 * Ask the service for every routed page and for one path it does not serve.
 *
 * This needs no browser and no rendering: it is the HTTP half of the question
 * "does the interface exist". A page that answers 200 with an empty body, or
 * with something that is not HTML, is a failure here and is reported as one —
 * an empty body is exactly how a blank page starts.
 */
export async function probeHealth(options) {
  const { serviceUrl, routes, unknownPath, probe = 'health' } = options;
  const checks = [];
  const pages = [];

  for (const route of routes) {
    const url = `${serviceUrl}${route}`;
    let record = { route, url, status: null, contentType: null, bytes: 0, hasHtml: false, error: null };
    try {
      const response = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const body = await response.text();
      record = {
        ...record,
        status: response.status,
        contentType: response.headers.get('content-type'),
        bytes: Buffer.byteLength(body),
        hasHtml: /<html[\s>]/i.test(body),
      };
    } catch (error) {
      record.error = error.message;
    }

    const problems = [];
    if (record.error !== null) problems.push(`request failed: ${record.error}`);
    if (record.status !== 200) problems.push(`status ${record.status}`);
    if (record.bytes === 0) problems.push('the body was empty');
    if (record.contentType === null || !record.contentType.startsWith('text/html')) {
      problems.push(`content-type ${record.contentType}`);
    }
    if (record.bytes > 0 && !record.hasHtml) problems.push('the body is not an HTML document');

    pages.push(record);
    checks.push(
      check(`health.page:${route}`, probe, problems.length === 0 ? 'pass' : 'fail', {
        expected: '200, a non-empty HTML body',
        actual:
          record.error !== null
            ? record.error
            : `${record.status}, ${record.bytes} bytes, ${record.contentType}`,
        detail: problems.length === 0 ? null : problems.join('; '),
      }),
    );
  }

  let unknown = { path: unknownPath, status: null, error: null };
  try {
    const response = await fetch(`${serviceUrl}${unknownPath}`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    unknown = { path: unknownPath, status: response.status, error: null };
  } catch (error) {
    unknown = { path: unknownPath, status: null, error: error.message };
  }
  checks.push(
    check(`health.unknown:${unknownPath}`, probe, unknown.status === 404 ? 'pass' : 'fail', {
      expected: '404 for a path no route claims',
      actual: unknown.error === null ? `status ${unknown.status}` : unknown.error,
    }),
  );

  return { probe, measurements: { serviceUrl, routes, pages, unknown }, checks };
}

/** The checks that describe whether the page itself came up at all. */
export function pageChecks(snapshot, probe) {
  const checks = [];
  const viewport = snapshot.viewport ?? { width: 0, height: 0 };
  // The viewport is the layout's own fact, and the `html` element's box is not:
  // a page whose children are all absolutely positioned has a zero-height
  // `html` box and is perfectly well laid out. Requiring a positive `html`
  // rectangle would fail on the shape of a page rather than on its health.
  const loaded =
    snapshot.readyState === 'complete' &&
    viewport.width > 0 &&
    viewport.height > 0 &&
    snapshot.bodyChildren > 0;

  checks.push(
    check('page.loaded', probe, loaded ? 'pass' : 'fail', {
      expected: 'a complete document, a laid-out viewport and a body with content',
      actual: `readyState ${snapshot.readyState}, viewport ${viewport.width}x${viewport.height}, body children ${snapshot.bodyChildren}`,
    }),
  );

  const errors = snapshot.agent?.installed === true ? snapshot.agent.errors : [];
  checks.push(
    check('page.errors', probe, errors.length === 0 ? 'pass' : 'fail', {
      expected: 'no uncaught error and no unhandled rejection',
      actual: errors.length === 0 ? 'none' : errors.map((entry) => `${entry.kind}: ${entry.message}`).join(' | '),
    }),
  );

  return checks;
}

/**
 * Measure a page's geometry: rectangles, scroll metrics, and what a point hits.
 *
 * The topmost check is the one that catches the defect class this tool exists
 * for. `elementFromPoint` at an element's own centre returns whatever is drawn
 * above it, so an overlay that covers a label — closed, invisible in the
 * markup, and green in every Node test — turns into a failed check with two
 * numbers and two element descriptions.
 */
export async function probeGeometry(options) {
  const {
    client,
    url,
    selectors = [],
    topmost = [],
    points = [],
    container = null,
    settleMs = DEFAULT_SETTLE_MS,
    screenshot = true,
    outDir = null,
    slug = 'page',
    probe = 'geometry',
  } = options;

  await client.navigate(url);
  if (settleMs > 0) await new Promise((resolve) => setTimeout(resolve, settleMs));

  const params = JSON.stringify({ selectors, topmost, points, container });
  const snapshot = await client.evaluate(`(${pageSnapshot.toString()})(${params})`);

  const checks = [];
  for (const element of snapshot.elements) {
    if (element.error !== undefined) {
      checks.push(
        check(`geometry.element:${element.selector}`, probe, 'fail', {
          expected: 'a selector the page can answer',
          actual: element.error,
        }),
      );
      continue;
    }
    const ok = element.found && element.first !== null && element.first.visible;
    checks.push(
      check(`geometry.element:${element.selector}`, probe, ok ? 'pass' : 'fail', {
        expected: 'at least one match with a non-zero, visible box',
        actual: element.found
          ? `${element.count} match(es), first ${element.first?.width ?? 0}x${element.first?.height ?? 0} at (${element.first?.x ?? 0}, ${element.first?.y ?? 0})`
          : 'no match',
      }),
    );
  }

  for (const element of snapshot.topmost) {
    if (element.error !== undefined) {
      checks.push(
        check(`geometry.topmost:${element.selector}`, probe, 'fail', {
          expected: 'a selector the page can answer',
          actual: element.error,
        }),
      );
      continue;
    }
    const ok = element.found === true && element.isSelfOrDescendant === true;
    checks.push(
      check(`geometry.topmost:${element.selector}`, probe, ok ? 'pass' : 'fail', {
        expected: 'the element is the topmost at its own centre',
        actual:
          element.found === true
            ? `centre (${Math.round(element.center.x)}, ${Math.round(element.center.y)}) hits ${element.hit}`
            : 'no match',
        detail:
          element.found === true && element.isSelfOrDescendant !== true
            ? 'something is drawn over the element, or it is scrolled out of the viewport'
            : null,
      }),
    );
  }

  for (const point of snapshot.points) {
    checks.push(
      check(`geometry.point:${point.x},${point.y}`, probe, point.hit === 'none' ? 'fail' : 'pass', {
        expected: 'an element at the point',
        actual: point.hit,
      }),
    );
  }

  if (snapshot.container !== null) {
    const box = snapshot.container;
    checks.push(
      check(`geometry.container:${box.selector}`, probe, box.found ? 'pass' : 'fail', {
        expected: 'the scroll container exists',
        actual: box.found
          ? `scrollWidth ${box.scrollWidth}, clientWidth ${box.clientWidth}, clientHeight ${box.clientHeight}, scrollHeight ${box.scrollHeight}`
          : box.error ?? 'no match',
      }),
    );
  }

  let artifact = null;
  if (screenshot && outDir !== null) {
    const png = await client.screenshot();
    artifact = path.join(outDir, `${slug}-geometry.png`);
    writeFileSync(artifact, png);
  }

  return {
    probe,
    measurements: { url, snapshot, screenshot: artifact },
    checks,
    snapshot,
  };
}

/**
 * Press and release a real mouse button, then report what the page did.
 *
 * The press is dispatched through `Input.dispatchMouseEvent`, so the browser's
 * hit testing, its pointer-event synthesis and the page's own handlers all run.
 * A synthetic `dispatchEvent` from script would prove none of that, and it is
 * exactly the difference between "the row is wired up" and "the row selects
 * when a person clicks it".
 */
export async function probeInteraction(options) {
  const {
    client,
    url,
    click = null,
    drag = null,
    expectRequests = [],
    settleMs = DEFAULT_SETTLE_MS,
    allowInput = true,
    screenshot = true,
    outDir = null,
    slug = 'page',
    probe = 'interaction',
  } = options;

  if (!allowInput) {
    return {
      probe,
      measurements: { url, skipped: 'the input probe is off for an attached service' },
      checks: [
        check('interaction.press', probe, 'skip', {
          expected: 'a real press and release',
          actual: 'not run',
          detail: 'the service was named with --service, so this probe does not send input; pass --allow-input to enable it',
        }),
      ],
      snapshot: null,
    };
  }

  await client.navigate(url);
  if (settleMs > 0) await new Promise((resolve) => setTimeout(resolve, settleMs));

  const topmost = click !== null && click.kind === 'selector' ? [click.selector] : [];
  const before = await client.evaluate(
    `(${pageSnapshot.toString()})(${JSON.stringify({ selectors: [], topmost, points: [], container: null })})`,
  );

  if (before.agent?.installed !== true) {
    throw new ToolError(
      'the page agent is not installed, so no event or request could be recorded',
      { code: 'agent_missing' },
    );
  }

  let target;
  let hitNote = null;
  if (click === null) {
    target = { x: Math.round(before.viewport.width / 2), y: Math.round(before.viewport.height / 2), label: 'the viewport centre' };
  } else if (click.kind === 'point') {
    target = { x: click.x, y: click.y, label: `the point ${click.x},${click.y}` };
  } else {
    const element = before.topmost[0];
    if (element.found !== true) {
      return {
        probe,
        measurements: { url, target: { selector: click.selector }, loaded: before },
        checks: [
          check(`interaction.press:${click.selector}`, probe, 'fail', {
            expected: 'the element to press exists',
            actual: 'no match',
          }),
        ],
        snapshot: before,
      };
    }
    target = {
      x: Math.round(element.center.x),
      y: Math.round(element.center.y),
      label: `${click.selector} at its centre`,
    };
    if (element.isSelfOrDescendant !== true) {
      hitNote = `the press point hits ${element.hit}, not the element asked for`;
    }
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  // Load-time requests are already in `before`; clearing now makes the event
  // sequence belong to this press alone.
  await client.evaluate('globalThis.__browserProbe.reset()');

  await client.mouse('mouseMoved', target.x, target.y, { button: 'none' });
  await sleep(120);
  await client.mouse('mousePressed', target.x, target.y, { button: 'left', clickCount: 1, buttons: 1 });
  await sleep(80);

  let release = { x: target.x, y: target.y };
  if (drag !== null) {
    const steps = 6;
    for (let step = 1; step <= steps; step += 1) {
      const x = target.x + (drag.dx * step) / steps;
      const y = target.y + (drag.dy * step) / steps;
      await client.mouse('mouseMoved', x, y, { button: 'left', buttons: 1 });
      await sleep(20);
    }
    release = { x: target.x + drag.dx, y: target.y + drag.dy };
  }

  await client.mouse('mouseReleased', release.x, release.y, { button: 'left', clickCount: 1, buttons: 0 });
  await sleep(Math.max(settleMs, 400));

  const after = await client.evaluate(`(() => {
    const probe = globalThis.__browserProbe;
    return {
      events: probe.events.slice(-200),
      requests: probe.requests.slice(-200),
      errors: probe.errors.slice(-50),
    };
  })()`);

  const events = Array.isArray(after.events) ? after.events : [];
  const inputRequests = Array.isArray(after.requests) ? after.requests : [];
  const loadRequests = Array.isArray(before.agent.requests) ? before.agent.requests : [];
  const presses = events.filter((event) => event.type === 'pointerdown' || event.type === 'mousedown');
  const releases = events.filter((event) => event.type === 'pointerup' || event.type === 'mouseup');

  const checks = [];
  const sequence = events.map((event) => event.type).join(' > ');
  const countOf = (type) => events.filter((event) => event.type === type).length;
  checks.push(
    check('interaction.press', probe, presses.length > 0 && releases.length > 0 ? 'pass' : 'fail', {
      expected: 'a press and a release reach the page',
      actual:
        `pointerdown ${countOf('pointerdown')}, mousedown ${countOf('mousedown')}, ` +
        `pointerup ${countOf('pointerup')}, mouseup ${countOf('mouseup')}, click ${countOf('click')}`,
      detail: sequence === '' ? 'no event was recorded at all' : `sequence: ${sequence}`,
    }),
  );

  for (const element of before.topmost) {
    if (element.found !== true) continue;
    checks.push(
      check(`interaction.topmost:${element.selector}`, probe, element.isSelfOrDescendant === true ? 'pass' : 'fail', {
        expected: 'the pressed element is the topmost at its own centre',
        actual: `centre (${Math.round(element.center.x)}, ${Math.round(element.center.y)}) hits ${element.hit}`,
        detail: element.isSelfOrDescendant === true ? null : 'something is drawn over the element',
      }),
    );
  }

  const issued = [...loadRequests, ...inputRequests];
  for (const needle of expectRequests) {
    const found = issued.filter((entry) => String(entry.url).includes(needle));
    checks.push(
      check(`interaction.request:${needle}`, probe, found.length > 0 ? 'pass' : 'fail', {
        expected: `the page issues a request whose URL contains ${needle}`,
        actual: found.length > 0 ? `${found.length} request(s), first ${found[0].method} ${found[0].url}` : `${issued.length} request(s), none matching`,
        detail: issued.length === 0 ? 'the page issued no request at all' : null,
      }),
    );
  }

  let artifact = null;
  if (screenshot && outDir !== null) {
    const png = await client.screenshot();
    artifact = path.join(outDir, `${slug}-interaction.png`);
    writeFileSync(artifact, png);
  }

  return {
    probe,
    measurements: {
      url,
      target: { ...target, note: hitNote },
      drag,
      events,
      loadRequests,
      inputRequests,
      errors: after.errors ?? [],
      screenshot: artifact,
    },
    checks,
    // The snapshot is the pre-press one, with the errors observed afterwards
    // folded in: a page-level check must see a handler that threw during the
    // press, not only one that threw while loading.
    snapshot: {
      ...before,
      agent: { ...before.agent, errors: after.errors ?? before.agent.errors ?? [] },
    },
  };
}

/** The agent source every browser-side probe installs before its first navigation. */
export { agentSource };
