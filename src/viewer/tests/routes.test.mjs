/**
 * The routed pages, from the table to the socket.
 *
 * The interface is three pages now, and the point of the exercise was to stop
 * one document from growing without bound. That only holds if the routes really
 * are separate: each serves its own body, loads its own module, shares one
 * layout and one navigation, and a path nobody claims answers 404 instead of
 * quietly falling back to the world page.
 *
 * The service is exercised over a real socket with a bridge that *throws* if it
 * is ever asked anything: a page is composed markup and static files, so a page
 * request that reached the core would be a page whose body depends on the world,
 * which is exactly what the split is supposed to prevent.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createViewerServer } from '../server.mjs';
import {
  LAYOUT_SLOTS,
  NAV_ITEMS,
  ROUTES,
  SHELL_SCRIPT,
  defaultPageRenderer,
  fragmentFor,
  routeFor,
  scriptsFor,
  slotsIn,
} from '../routes.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, '..', 'public');
const read = (relative) => readFileSync(path.join(publicDir, relative), 'utf8').replace(/\r\n/g, '\n');

const composed = new Map(ROUTES.map((route) => [route.id, defaultPageRenderer.render(route.paths[0])]));

/** The navigation block of a page, whitespace collapsed for comparison. */
function navOf(markup) {
  const block = /<nav[\s\S]*?<\/nav>/.exec(markup);
  assert.ok(block, 'every page must carry the navigation');
  return block[0];
}

/** A bridge that fails the test by being used at all. */
function inertBridge() {
  const calls = [];
  return {
    calls,
    representation: 'sparse',
    get running() {
      return false;
    },
    async stop() {},
    onEvent() {
      return () => {};
    },
    async request(cmd) {
      calls.push(cmd);
      throw new Error(`a page request must not talk to the core (asked for ${cmd})`);
    },
    async restart() {
      calls.push('restart');
      throw new Error('a page request must not restart the core');
    },
  };
}

async function startPages(t) {
  const bridge = inertBridge();
  const server = createViewerServer({ bridge, ownsBridge: false });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  t.after(async () => {
    await server.closeViewer();
  });
  return { url: `http://127.0.0.1:${server.address().port}`, bridge };
}

// -- the table ------------------------------------------------------------

test('the route table declares the three pages, and the paths each answers', () => {
  assert.deepEqual(
    ROUTES.map((route) => route.id),
    ['world', 'history', 'archives'],
  );
  // `/` is what a person types and what the launcher probes; `/world` is what
  // the navigation links to. One page, two names.
  assert.equal(routeFor('/')?.id, 'world');
  assert.equal(routeFor('/world')?.id, 'world');
  assert.equal(routeFor('/history')?.id, 'history');
  assert.equal(routeFor('/archives')?.id, 'archives');
  for (const unknown of ['/nope', '/world/', '/history/', '/index.html', '/static/app.js', '/api/state', '']) {
    assert.equal(routeFor(unknown), null, `${unknown} must not be served by a page route`);
  }
});

test('every fragment and every page module the table names exists', () => {
  for (const route of ROUTES) {
    assert.doesNotThrow(() => read(fragmentFor(route)), `${route.id} names a fragment that is missing`);
    assert.doesNotThrow(
      () => read(route.script.replace('/static/', '')),
      `${route.id} names a page module that is missing`,
    );
  }
});

test('each route loads the shell and exactly its own page module', () => {
  const pageScripts = new Set();
  for (const route of ROUTES) {
    const scripts = scriptsFor(route);
    assert.equal(scripts[0], SHELL_SCRIPT, `${route.id} must load the shell`);
    assert.equal(scripts.length, 2, `${route.id} must load exactly one page module`);
    assert.ok(!pageScripts.has(scripts[1]), `${route.id} shares a page module with another route`);
    pageScripts.add(scripts[1]);

    // And the page writes them in that order, so the shell is listening before
    // the page module asks for the context.
    const markup = composed.get(route.id);
    const shellAt = markup.indexOf(`src="${SHELL_SCRIPT}"`);
    const pageAt = markup.indexOf(`src="${route.script}"`);
    assert.ok(shellAt >= 0 && pageAt >= 0, `${route.id} must load both scripts`);
    assert.ok(shellAt < pageAt, `${route.id} must load the shell before its page module`);
  }
});

// -- the composition ------------------------------------------------------

test('the navigation is generated once and marks the current route', () => {
  const navs = new Map();
  for (const route of ROUTES) {
    const nav = navOf(composed.get(route.id));
    navs.set(route.id, nav);
    for (const item of NAV_ITEMS) {
      assert.ok(nav.includes(`href="${item.href}"`), `${route.id}: the navigation lacks ${item.href}`);
    }
    const current = [...nav.matchAll(/aria-current="page"/g)];
    assert.equal(current.length, 1, `${route.id}: exactly one tab is the current one`);
    assert.match(
      nav,
      new RegExp(`href="${route.href}"[^>]*aria-current="page"`),
      `${route.id}: the marker is on the wrong tab`,
    );
  }
  // One generator for all three: with the marker dropped, the navigation blocks
  // are byte for byte the same.
  const stripped = [...navs.values()].map((nav) => nav.replace(/\s*aria-current="page"/g, ''));
  assert.equal(new Set(stripped).size, 1, 'every route must carry the same navigation');
});

test('each route serves a body of its own, and the containers do not overlap', () => {
  const bodies = new Map();
  for (const route of ROUTES) {
    const markup = composed.get(route.id);
    bodies.set(route.id, markup);
    assert.match(
      markup,
      new RegExp(`class="stage page page-${route.id}"`),
      `${route.id} must be composed onto its own page class`,
    );
  }
  assert.notEqual(bodies.get('world'), bodies.get('history'));
  assert.notEqual(bodies.get('history'), bodies.get('archives'));
  assert.notEqual(bodies.get('world'), bodies.get('archives'));

  // The mutually exclusive containers: the world draws the world, the history
  // shows the tree beside its own preview, the archives manage files. A page
  // that carried another's containers would load a module to drive them.
  //
  // The history page *does* have a canvas of its own — the preview of the
  // selected generation — so what is exclusive is the world's canvas, by id,
  // rather than the element.
  const exclusive = [
    ['world', '<canvas id="grid"', true],
    ['world', 'id="preview"', false],
    ['world', 'id="archive-list"', false],
    ['world', 'id="timeline"', false],
    ['history', 'id="timeline"', true],
    ['history', '<canvas id="preview"', true],
    ['history', 'id="grid"', false],
    ['history', 'id="archive-list"', false],
    ['archives', 'id="archive-list"', true],
    ['archives', '<canvas', false],
    ['archives', 'id="timeline"', false],
  ];
  for (const [routeId, needle, expected] of exclusive) {
    const present = bodies.get(routeId).includes(needle);
    assert.equal(
      present,
      expected,
      `${routeId} must ${expected ? '' : 'not '}contain ${needle}`,
    );
  }
});

test('the composer uses the shared layout for every route', () => {
  const layout = defaultPageRenderer.layout();
  assert.deepEqual([...slotsIn(layout)].sort(), [...LAYOUT_SLOTS].sort());
  for (const [id, markup] of composed) {
    assert.ok(markup.includes('<h1>lifegame</h1>'), `${id} must carry the shared header`);
    assert.ok(markup.includes('id="locale"'), `${id} must carry the shared language control`);
    assert.ok(markup.includes('id="toggle-theme"'), `${id} must carry the shared theme control`);
    assert.ok(markup.includes('id="core-status"'), `${id} must carry the shared status line`);
  }
});

test('the route table is the only route table', () => {
  // The service must not know a page's file name: it asks the table for a
  // composed page and 404s when the answer is null. A second list in
  // server.mjs is how a route ends up served but not navigable, or the reverse.
  const serverSource = readFileSync(path.join(here, '..', 'server.mjs'), 'utf8');
  for (const route of ROUTES) {
    assert.ok(
      !serverSource.includes(path.basename(fragmentFor(route))),
      `server.mjs must not name ${fragmentFor(route)}; the table owns it`,
    );
    assert.ok(
      !serverSource.includes(route.script),
      `server.mjs must not name ${route.script}; the table owns it`,
    );
  }
  assert.doesNotMatch(serverSource, /index\.html/, 'the single page is gone; nothing may still serve it');
  assert.match(serverSource, /from '\.\/routes\.mjs'/, 'the service must compose from the route table');
});

// -- over a real socket ---------------------------------------------------

test('every routed path answers 200 with its own page', async (t) => {
  const { url, bridge } = await startPages(t);
  const seen = new Map();
  for (const route of ROUTES) {
    for (const routePath of route.paths) {
      const response = await fetch(`${url}${routePath}`);
      assert.equal(response.status, 200, `${routePath} answered ${response.status}`);
      assert.match(response.headers.get('content-type'), /text\/html/);
      const body = await response.text();
      assert.ok(body.includes(`page page-${route.id}`), `${routePath} served the ${route.id} page`);
      seen.set(routePath, body);
    }
  }
  // The two names of the world are the same page, composed twice.
  assert.equal(seen.get('/'), seen.get('/world'));
  assert.notEqual(seen.get('/world'), seen.get('/history'));
  assert.deepEqual(bridge.calls, [], 'composing a page must not reach the core');
});

test('an unclaimed path answers 404 and never a page', async (t) => {
  const { url } = await startPages(t);
  for (const unknown of ['/definitely-not-a-route', '/world/', '/history/', '/index.html']) {
    const response = await fetch(`${url}${unknown}`);
    assert.equal(response.status, 404, `${unknown} answered ${response.status}`);
    const body = await response.text();
    assert.ok(!body.includes('page page-'), `${unknown} must not fall back to a page`);
    assert.equal((await JSON.parse(body)).error, 'not_found');
  }
});
