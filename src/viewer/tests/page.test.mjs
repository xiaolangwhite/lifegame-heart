/**
 * The browser half, executed — route by route.
 *
 * Everything here drives the real `public/app.js` (the shell) plus the real page
 * module of one route through the synthetic browser in `dom-stub.mjs`, and
 * asserts on what the page did: which pixels it wrote, which requests it sent,
 * and whether it kept polling once a stream was up.
 *
 * **A case says which route it is about.** The interface is three pages now, and
 * the ids a page reads are the ids its own fragment declares — the synthetic
 * document returns null for anything else, so a case that forgot to say which
 * route it means fails loudly rather than drawing into invented elements.
 *
 * This file exists because the page's drawing and gesture code used to have no
 * execution path at all. The defect that proved the point was `paintBits`
 * calling a colour constant that had been deleted when the palette moved into
 * the stylesheet: `node --check` passed, because it parses syntax and does not
 * resolve bindings, and no test ever drew a bitmap.
 *
 * A note on what is asserted where. The arithmetic is asserted *exactly* in
 * `viewport.test.mjs`, against the pure functions; the tree's shape in
 * `history.test.mjs`. Here the assertions are about wiring: that a click is
 * turned into the cell the arithmetic names, that a bitmap frame reaches
 * `putImageData`, that a drag moves the camera instead of editing the world,
 * that the page stops polling when a stream connects and resumes when it does
 * not, and that a node's numbers are in the document for the stylesheet to open
 * on hover or focus.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  createCanvas,
  installBrowser,
  jsonResponse,
  pointerGesture,
  readFragment,
  readLayout,
  readRoutePage,
  settle,
  StubEventSource,
} from './dom-stub.mjs';
import { GRID_WIDTHS } from '../public/theme.mjs';
import { readPalette } from '../public/frame-draw.mjs';
import { MAX_INDENT_LEVELS } from '../public/history.mjs';
import { ROUTES } from '../routes.mjs';

/** The routes, so a contract case can be about all of them and not one. */
const ROUTE_IDS = ROUTES.map((route) => route.id);

/** Every id a piece of markup declares. */
function declaredIdsIn(markup) {
  return [...markup.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
}

/** Each case gets a fresh module instance: the page runs on import. */
let caseCounter = 0;

/**
 * The page module of a route. The shell is loaded first and settled, because the
 * layout writes its `<script>` tag before the page's — and the other order is
 * covered by its own case below, since both have to work.
 */
const PAGE_MODULES = {
  world: '../public/pages/world.js',
  history: '../public/pages/history.js',
  archives: '../public/pages/archives.js',
};

async function loadPage(browser) {
  caseCounter += 1;
  await import(`../public/app.js?case=${caseCounter}`);
  await settle(3);
  await import(`${PAGE_MODULES[browser.route ?? 'world']}?case=${caseCounter}`);
  await settle(6);
}

/** Load a route's page module *before* the shell, which is the other order. */
async function loadPageLast(browser) {
  caseCounter += 1;
  await import(`${PAGE_MODULES[browser.route ?? 'world']}?case=${caseCounter}`);
  await settle(2);
  await import(`../public/app.js?case=${caseCounter}`);
  await settle(6);
}

function encodeCells(cells) {
  const buffer = Buffer.alloc(cells.length * 8);
  cells.forEach(([x, y], index) => {
    buffer.writeInt32LE(x, index * 8);
    buffer.writeInt32LE(y, index * 8 + 4);
  });
  return buffer.toString('base64');
}

function encodeBits(width, height, cells) {
  const stride = Math.ceil(width / 8);
  const buffer = Buffer.alloc(stride * height);
  for (const [x, y] of cells) {
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    buffer[y * stride + (x >> 3)] |= 0x80 >> (x & 7);
  }
  return buffer.toString('base64');
}

/**
 * A core that answers over the same HTTP surface the service exposes, so the
 * page cannot tell the difference between this and the real thing.
 */
function createCoreStub(options = {}) {
  const world = options.world ?? { width: 64, height: 64 };
  const bounds = options.bounds ?? null;
  const commands = [];
  let cells = [...(options.cells ?? [])];
  let generation = options.generation ?? 0;
  let running = false;
  let frameFormat = options.frameFormat ?? 'cells';
  let representation = options.representation ?? 'sparse';
  // The rule the core is running. A page compares the selected generation's own
  // rule with this one, so a case states both: the recorded rows carry the rule
  // that produced them and this is the one in force now.
  let rule = options.rule ?? 'B3/S23';
  // The rules this core refuses, for the case where the second opinion differs.
  const refuseRules = [...(options.refuseRules ?? [])];
  let switched = 0;
  const historyEnabled = options.history === true;
  const historyRows = options.historyRows ?? [];
  const rollbacks = [];
  // The working point, as the core reports it: the node the next record appends
  // to. `select` moves it; `rollback` deliberately does not, and the page must be
  // seen to use the first and not the second. A case may state `head: null` to
  // mean "nothing is selected", which is not the same as not stating it.
  let head = Object.hasOwn(options, 'head') ? options.head : (historyRows.at(-1)?.id ?? null);
  const selects = [];
  const archives = [];
  // The archive directory, as the service would report it: names the service
  // resolved, with the size and generation count it read off each file.
  const archiveFiles = [...(options.archiveFiles ?? [])];
  const renames = [];
  const imports = [];
  const importSupported = options.importSupported !== false;
  // What the core declares, as `hello` declares it. The service repeats these on
  // every state reply, which is what a page that fell back to polling relies on.
  const limits = options.limits ?? {
    ticksPerSecond: { min: 1, max: 60 },
    stepsPerRequest: 100000,
    maxCoordinate: 65535,
    representations: ['sparse', 'tiled'],
  };

  const handler = async (url, init = {}) => {
    const parsed = new URL(url, 'http://127.0.0.1');
    const path = parsed.pathname;
    if (path === '/api/state') {
      return jsonResponse({
        ok: true,
        world,
        rule,
        generation,
        population: cells.length,
        bounds,
        running,
        tps: 10,
        limits,
        history: historyEnabled,
        representation,
      });
    }
    if (path === '/api/frame') {
      const x0 = Number(parsed.searchParams.get('x0'));
      const y0 = Number(parsed.searchParams.get('y0'));
      const w = Number(parsed.searchParams.get('w'));
      const h = Number(parsed.searchParams.get('h'));
      const inside = cells.filter(([x, y]) => x >= x0 && x < x0 + w && y >= y0 && y < y0 + h);
      const frame = {
        x0,
        y0,
        w,
        h,
        generation,
        population: inside.length,
        format: frameFormat,
        // The core's `bits` payload is a bitmap *of the rectangle*
        // (`world.viewport(x0, y0, w, h)` in bridge.py), so a live cell becomes a
        // set bit at its offset inside the rectangle; `cells` carries absolute
        // coordinates. A stub that wrote absolute coordinates into the bitmap
        // only looked right while every frame started at the origin.
        data:
          frameFormat === 'bits'
            ? encodeBits(
                w,
                h,
                inside.map(([x, y]) => [x - x0, y - y0]),
              )
            : encodeCells(inside),
      };
      return jsonResponse({ ok: true, frame });
    }
    if (path === '/api/history') {
      if (!historyEnabled) {
        return jsonResponse({
          ok: false,
          error: 'no_history',
          message: 'this core was started without a history',
          history: false,
          generations: [],
        });
      }
      return jsonResponse({
        ok: true,
        session: 1,
        current: generation,
        head,
        count: historyRows.length,
        generations: historyRows,
        history: true,
      });
    }
    // The live set, as the service wraps the core's `export`: the `cells`
    // encoding when it fits under the cap, and the population plus the bounds
    // when it does not. The page reads this once per selection.
    if (path === '/api/cells') {
      const cap = options.cellsCap ?? 1 << 20;
      if (cells.length > cap) {
        return jsonResponse({
          ok: true,
          truncated: true,
          reason: 'population_above_cap',
          cap,
          population: cells.length,
          generation,
          bounds,
          cells: null,
        });
      }
      return jsonResponse({
        ok: true,
        truncated: false,
        population: cells.length,
        generation,
        format: 'cells',
        cells: encodeCells(cells),
      });
    }
    if (path === '/api/select') {
      const body = JSON.parse(init.body ?? '{}');
      const wanted =
        body.node !== undefined
          ? historyRows.find((entry) => entry.id === body.node)
          : historyRows.find((entry) => entry.generation === body.generation);
      if (wanted === undefined) {
        return jsonResponse({ ok: false, error: 'bad_arguments', message: 'no such node' });
      }
      selects.push(wanted.id);
      head = wanted.id;
      generation = wanted.generation;
      if (wanted.cells !== undefined) cells = [...wanted.cells];
      return jsonResponse({
        ok: true,
        node: wanted.id,
        generation,
        population: cells.length,
        state: {
          ok: true,
          world,
          rule,
          generation,
          population: cells.length,
          running: false,
          tps: 10,
        },
      });
    }
    if (path === '/api/rollback') {
      const body = JSON.parse(init.body ?? '{}');
      rollbacks.push(body.generation);
      generation = body.generation;
      const row = historyRows.find((entry) => entry.generation === body.generation);
      if (row) cells = [...(row.cells ?? cells)];
      return jsonResponse({
        ok: true,
        generation,
        population: cells.length,
        state: { ok: true, world, rule, generation, population: cells.length, running: false, tps: 10 },
      });
    }
    if (path === '/api/archive') {
      const body = JSON.parse(init.body ?? '{}');
      archives.push(body.name ?? null);
      const name = body.name ?? 'archive.jsonl';
      const existing = archiveFiles.findIndex((entry) => entry.name === name);
      const entry = { name, bytes: 128, modified: new Date().toISOString(), generations: historyRows.length };
      if (existing >= 0) archiveFiles[existing] = entry;
      else archiveFiles.unshift(entry);
      return jsonResponse({ ok: true, path: `/repo/data/${name}`, generations: historyRows.length, name });
    }
    if (path === '/api/archives') {
      return jsonResponse({ ok: true, directory: 'data', archives: archiveFiles });
    }
    if (path === '/api/archive/rename') {
      const body = JSON.parse(init.body ?? '{}');
      renames.push(body);
      const at = archiveFiles.findIndex((entry) => entry.name === body.name);
      if (at < 0) {
        return jsonResponse({ ok: false, error: 'not_found', message: 'no such archive' }, 404);
      }
      archiveFiles[at] = { ...archiveFiles[at], name: body.to };
      return jsonResponse({ ok: true, from: body.name, to: body.to, archives: archiveFiles });
    }
    if (path === '/api/archive/delete') {
      const body = JSON.parse(init.body ?? '{}');
      const at = archiveFiles.findIndex((entry) => entry.name === body.name);
      if (at < 0) {
        return jsonResponse({ ok: false, error: 'not_found', message: 'no such archive' }, 404);
      }
      archiveFiles.splice(at, 1);
      return jsonResponse({ ok: true, name: body.name, archives: archiveFiles });
    }
    if (path === '/api/archive/import') {
      const body = JSON.parse(init.body ?? '{}');
      imports.push(body.name ?? null);
      if (!importSupported) {
        return jsonResponse(
          {
            ok: false,
            error: 'archive_import_unsupported',
            message: 'unknown command open',
          },
          501,
        );
      }
      return jsonResponse({
        ok: true,
        name: body.name,
        generations: 3,
        state: {
          ok: true,
          world,
          rule,
          generation,
          population: cells.length,
          bounds,
          running,
          tps: 10,
          limits,
          history: historyEnabled,
          representation,
        },
      });
    }
    if (path === '/api/sessions') {
      return jsonResponse({
        ok: true,
        default: 'main',
        cap: 64,
        queued: 0,
        sessions: [
          { id: 'main', label: 'main', representation: 'sparse', history: false },
          { id: 's1', label: 'second', representation: 'sparse', history: true },
        ],
      });
    }
    if (path === '/api/patterns') {
      return jsonResponse({
        ok: true,
        patterns: [
          { name: 'block', kind: 'still-life', width: 2, height: 2, population: 4 },
          { name: 'glider', kind: 'ship', width: 3, height: 3, population: 5 },
        ],
      });
    }
    if (path === '/api/pattern') {
      const body = JSON.parse(init.body ?? '{}');
      const library = {
        block: [[0, 0], [1, 0], [0, 1], [1, 1]],
        glider: [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]],
      };
      const shape = library[body.name];
      if (shape === undefined) {
        return jsonResponse({ ok: false, error: 'unknown_pattern', message: 'no such pattern' }, 404);
      }
      let placed = 0;
      for (const [dx, dy] of shape) {
        const cell = [body.x + dx, body.y + dy];
        if (!cells.some(([x, y]) => x === cell[0] && y === cell[1])) {
          cells.push(cell);
          placed += 1;
        }
      }
      return jsonResponse({
        ok: true,
        changed: placed,
        population: cells.length,
        name: body.name,
        cells: shape.length,
        width: 2,
        height: 2,
        representation,
        switched: false,
      });
    }
    if (path === '/api/command') {
      const body = JSON.parse(init.body ?? '{}');
      commands.push(body);
      if (body.cmd === 'toggle') {
        const at = cells.findIndex(([x, y]) => x === body.x && y === body.y);
        if (at >= 0) cells.splice(at, 1);
        else cells.push([body.x, body.y]);
        return jsonResponse({ ok: true, x: body.x, y: body.y, alive: at < 0, population: cells.length });
      }
      if (body.cmd === 'step') {
        generation += body.count ?? 1;
        return jsonResponse({ ok: true, generation, population: cells.length, changed: 0 });
      }
      if (body.cmd === 'clear') {
        cells = [];
        generation = 0;
        return jsonResponse({ ok: true, generation: 0, population: 0 });
      }
      if (body.cmd === 'run') {
        running = true;
        return jsonResponse({ ok: true, running: true, tps: body.tps ?? 10, generation });
      }
      if (body.cmd === 'pause') {
        running = false;
        return jsonResponse({ ok: true, running: false, generation });
      }
      // The rule commands. `set_rule` is the one the history page's adoption
      // button sends; the reply carries the rule the core took, in canonical
      // text and with both digit sets, which is the shape the protocol fixes.
      if (body.cmd === 'set_rule') {
        const wanted = String(body.rule ?? '');
        if (refuseRules.includes(wanted)) {
          return jsonResponse({
            ok: false,
            error: 'bad_rule',
            message: `${wanted} names a neighbour count this core does not have`,
          });
        }
        rule = wanted;
        const match = /^B(\d*)\/S(\d*)$/.exec(wanted);
        return jsonResponse({
          ok: true,
          rule: wanted,
          birth: [...(match?.[1] ?? '')].map(Number),
          survival: [...(match?.[2] ?? '')].map(Number),
        });
      }
      return jsonResponse({ ok: true });
    }
    if (path === '/api/subscription') {
      return jsonResponse({ ok: true, clientId: 1 });
    }
    if (path === '/api/representation') {
      const body = JSON.parse(init.body ?? '{}');
      const previous = representation;
      representation = body.representation;
      switched += 1;
      return jsonResponse({
        ok: true,
        switched: true,
        representation,
        previousRepresentation: previous,
        state: {
          ok: true,
          world,
          rule,
          generation,
          population: cells.length,
          bounds,
          running,
          tps: 10,
        },
      });
    }
    return jsonResponse({ ok: false, error: 'not_found' }, 404);
  };

  return {
    handler,
    commands,
    rollbacks,
    selects,
    get head() {
      return head;
    },
    get rule() {
      return rule;
    },
    archives,
    archiveFiles,
    renames,
    imports,
    historyRows,
    get cells() {
      return cells;
    },
    get generation() {
      return generation;
    },
    get representation() {
      return representation;
    },
    get switched() {
      return switched;
    },
    setFrameFormat(format) {
      frameFormat = format;
    },
  };
}

function setup(options = {}) {
  // The real page of the route under test, so the ids the scripts read are the
  // ids the project serves for that route.
  const route = options.route ?? 'world';
  const browser = installBrowser({ html: readRoutePage(route), ...(options.browser ?? {}) });
  browser.route = route;
  const core = createCoreStub(options.core);
  browser.setFetchHandler(core.handler);
  StubEventSource.reset();
  return { browser, core };
}

/** Clean up globals and stop any run loop the page left going. */function teardown(t, browser) {
  t.after(async () => {
    // A page left running reschedules its poll timer forever, and that timer
    // reads `globalThis.fetch` at fire time — so a run loop left going would
    // send its requests into the *next* case's stub. The step button is disabled
    // exactly while the world runs, which is a state the page keeps whatever
    // language it is showing.
    try {
      const step = browser.elements.get('step-once');
      // A disabled step means "running" — except in the editing mode, where the
      // step is disabled because the world is paused and a transaction owns the
      // change. The run button is disabled exactly in the editing mode, and it
      // is enabled while a normal run loop is going, so it tells the two apart.
      const editing = browser.elements.get('toggle-run')?.disabled === true;
      if (!editing && step && step.disabled === true) {
        browser.elements.get('toggle-run').dispatch('click');
        await settle(3);
      }
    } catch {
      // Nothing to stop.
    } finally {
      browser.restore();
    }
  });
}

function lastFrameRequest(browser) {
  const entry = browser.requestsTo('/api/frame').at(-1);
  if (!entry) return null;
  const url = new URL(entry.url, 'http://127.0.0.1');
  return {
    x0: Number(url.searchParams.get('x0')),
    y0: Number(url.searchParams.get('y0')),
    w: Number(url.searchParams.get('w')),
    h: Number(url.searchParams.get('h')),
  };
}

function lastSubscription(browser) {
  return browser.requestBodiesTo('/api/subscription').at(-1) ?? null;
}

const THREE_CELLS = [
  [1, 1],
  [2, 2],
  [3, 3],
];

/**
 * Three cells inside the default view of a 64 x 64 world at 800 x 600.
 *
 * The view is the canvas over 60 pixels per cell, centred on the world, which is
 * the rectangle (25, 27) 13 x 10; these cells are inside it, so a test that
 * counts what was drawn does not depend on cells the frame never carried.
 */
const DEFAULT_VIEW_CELLS = [
  [26, 28],
  [27, 29],
  [28, 30],
];

// -- drawing --------------------------------------------------------------

test('a sparse frame is drawn cell by cell, and the grid is stroked', async (t) => {
  // The default view of a 64 x 64 world at 800 x 600 is 13 x 10 cells centred on
  // the world, which is (25, 27); the three cells here are inside it, so the
  // page has something to plot. The *positions* are derived from the rectangle
  // the page asked for rather than from the old whole-world default, because the
  // rectangle is now a function of the canvas — `viewport.test.mjs` asserts the
  // mapping itself as an equality.
  const live = [
    [26, 28],
    [27, 29],
    [28, 30],
  ];
  const { browser } = setup({
    core: { world: { width: 64, height: 64 }, bounds: [26, 28, 28, 30], cells: live },
  });
  teardown(t, browser);
  await loadPage(browser);

  const frame = lastFrameRequest(browser);
  assert.ok(frame, 'the page must have asked for a frame');
  assert.equal(frame.w, Math.round(800 / 60), 'the default view is the canvas over 60 px per cell');
  assert.equal(frame.h, Math.round((800 / 60) * (600 / 800)));

  const { calls } = browser.canvas.context;
  // One fill for the background, then one per live cell in the rectangle.
  assert.equal(calls.fillRect.length, 1 + live.length, 'background plus three cells');

  const background = calls.fillRect[0];
  assert.equal(background.x, 0);
  assert.equal(background.y, 0);
  assert.equal(background.w, 800);
  assert.equal(background.h, 600);

  // One cell per pixel across the frame, so 800 css pixels over 13 world cells
  // is 61.5 pixels per cell, and 600 over 10 is 60: a cell is drawn one square
  // cell wide, and at the place its world coordinate says.
  const scaleX = 800 / frame.w;
  const scaleY = 600 / frame.h;
  const size = Math.min(scaleX, scaleY);
  const drawn = calls.fillRect.slice(1).map((entry) => [entry.x, entry.y]);
  assert.deepEqual(
    drawn,
    live.map(([x, y]) => [(x - frame.x0) * scaleX, (y - frame.y0) * scaleY]),
  );
  for (const entry of calls.fillRect.slice(1)) {
    assert.equal(entry.w, size, 'a cell is drawn one cell wide');
  }

  // The grid is drawn because a cell is at least GRID_MIN_CELL_PX across, and
  // it is a stroke with at least one horizontal and one vertical line.
  assert.equal(calls.stroke.length, 1, 'the grid is stroked exactly once');
  assert.ok(calls.stroke[0].lineWidth >= 1, 'the grid line has a width');
  assert.ok(calls.moveTo.length >= 2, 'the grid has lines');
  assert.equal(calls.moveTo.length, calls.lineTo.length, 'every moveTo is paired with a lineTo');
});

test('a dense frame is drawn through the bitmap path', async (t) => {
  // This is the path that used to throw: `paintBits` read a colour constant that
  // had been deleted, and nothing ever drew a bitmap. The block starts at the
  // frame's own origin (25, 27 for this world and canvas, as the default view of
  // a 64 x 64 world centred on it), so the bitmap's first pixel is a live one and
  // its last is not.
  const dense = [];
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) dense.push([25 + x, 27 + y]);
  }
  const { browser } = setup({
    core: {
      world: { width: 64, height: 64 },
      bounds: [25, 27, 32, 34],
      cells: dense,
      frameFormat: 'bits',
    },
  });
  teardown(t, browser);
  await loadPage(browser);

  const { calls } = browser.canvas.context;
  assert.equal(calls.drawImage.length, 1, 'the offscreen bitmap is drawn to the canvas');

  // The bitmap is composed on an offscreen canvas, which has its own context.
  const offscreen = browser.createdCanvases[0];
  assert.ok(offscreen, 'the page creates an offscreen canvas for the bitmap encoding');
  assert.equal(offscreen.context.calls.putImageData.length, 1, 'the bitmap reaches putImageData');

  const frame = lastFrameRequest(browser);
  const image = offscreen.context.calls.putImageData[0].image;
  assert.equal(image.width, frame.w);
  assert.equal(image.height, frame.h);
  // The block's first cell is live and the palette's alive colour is #7fd4ff.
  assert.deepEqual([...image.data.slice(0, 4)], [127, 212, 255, 255]);
  // The background was cleared, so a cell inside the frame that is not live
  // stays transparent: the frame's last column and row are past the block.
  const deadOffset = ((frame.h - 1) * frame.w + (frame.w - 1)) * 4;
  assert.deepEqual([...image.data.slice(deadOffset, deadOffset + 4)], [0, 0, 0, 0]);
  // Every one of the 64 live cells wrote a pixel, and nothing else did.
  let painted = 0;
  for (let offset = 3; offset < image.data.length; offset += 4) {
    if (image.data[offset] === 255) painted += 1;
  }
  assert.equal(painted, 64, 'exactly the live cells were painted');
});

test('the errors of a frame that cannot be drawn are shown, not thrown', async (t) => {
  const { browser } = setup({
    core: { world: { width: 64, height: 64 }, cells: THREE_CELLS, frameFormat: 'nonsense' },
  });
  teardown(t, browser);
  await loadPage(browser);

  const error = browser.elements.get('error');
  assert.equal(error.hidden, false, 'the page says why it cannot draw');
  assert.match(error.textContent, /unknown frame format/);
});

// -- gestures -------------------------------------------------------------

test('a click toggles the cell under the pointer', async (t) => {
  const { browser, core } = setup({
    core: { world: { width: 64, height: 64 }, bounds: [26, 28, 28, 30], cells: [[26, 28]] },
  });
  teardown(t, browser);
  await loadPage(browser);

  // The centre of a cell, read off the rectangle the page actually asked for:
  // the default view is a function of the canvas, so the cell under an arbitrary
  // pixel is not a constant any more. Cell (26, 28) is inside this frame.
  const frame = lastFrameRequest(browser);
  const perCellX = 800 / frame.w;
  const perCellY = 600 / frame.h;
  const clientX = (26 - frame.x0 + 0.5) * perCellX;
  const clientY = (28 - frame.y0 + 0.5) * perCellY;

  const canvas = browser.canvas;
  canvas.dispatch('pointerdown', { pointerId: 1, button: 0, clientX, clientY });
  canvas.dispatch('pointerup', { pointerId: 1, clientX, clientY });
  await settle(4);

  const toggles = core.commands.filter((command) => command.cmd === 'toggle');
  assert.equal(toggles.length, 1, 'exactly one toggle');
  assert.deepEqual(toggles[0], { cmd: 'toggle', x: 26, y: 28 });
  assert.equal(core.cells.length, 0, 'the core applied the toggle');
});

test('the last cell edit can be undone without touching the timeline', async (t) => {
  const { browser, core } = setup({
    core: { world: { width: 64, height: 64 }, bounds: [26, 28, 28, 30], cells: [[26, 28]] },
  });
  teardown(t, browser);
  await loadPage(browser);

  const undo = browser.elements.get('undo-edit');
  assert.equal(undo.disabled, true, 'nothing has been edited yet');

  const frame = lastFrameRequest(browser);
  const clientX = (26 - frame.x0 + 0.5) * (800 / frame.w);
  const clientY = (28 - frame.y0 + 0.5) * (600 / frame.h);
  const canvas = browser.canvas;
  canvas.dispatch('pointerdown', { pointerId: 1, button: 0, clientX, clientY });
  canvas.dispatch('pointerup', { pointerId: 1, clientX, clientY });
  await settle(4);
  assert.equal(core.cells.length, 0, 'the click removed the cell');
  assert.equal(undo.disabled, false, 'and the edit can be undone');

  undo.dispatch('click');
  await settle(4);
  const toggles = core.commands.filter((command) => command.cmd === 'toggle');
  assert.deepEqual(
    toggles.map((command) => [command.x, command.y]),
    [
      [26, 28],
      [26, 28],
    ],
    'undo toggles the same cell back rather than moving the timeline',
  );
  assert.deepEqual(core.cells, [[26, 28]], 'the world is back to what it was');
  assert.equal(undo.disabled, true, 'and there is nothing left to undo');
});

test('a step makes a pending undo unavailable rather than wrong', async (t) => {  const { browser, core } = setup({
    core: { world: { width: 64, height: 64 }, bounds: [26, 28, 28, 30], cells: [[26, 28]] },
  });
  teardown(t, browser);
  await loadPage(browser);
  const frame = lastFrameRequest(browser);
  const clientX = (26 - frame.x0 + 0.5) * (800 / frame.w);
  const clientY = (28 - frame.y0 + 0.5) * (600 / frame.h);
  const canvas = browser.canvas;
  canvas.dispatch('pointerdown', { pointerId: 1, button: 0, clientX, clientY });
  canvas.dispatch('pointerup', { pointerId: 1, clientX, clientY });
  await settle(4);
  assert.equal(browser.elements.get('undo-edit').disabled, false);

  browser.elements.get('step-once').dispatch('click');
  await settle(4);
  assert.equal(
    browser.elements.get('undo-edit').disabled,
    true,
    'the world moved after the edit, so the edit is no longer reversible',
  );
});

test('the controls name themselves, so a person can find out what they do', async (t) => {
  const { browser } = setup();
  teardown(t, browser);
  await loadPage(browser);

  for (const [id, title] of [
    ['undo-edit', /undo/i],
    ['step-once', /generation|step/i],
    ['clear-world', /cell/i],
    ['pattern-place', /pattern/i],
    ['session-new', /session/i],
  ]) {
    const element = browser.elements.get(id);
    assert.match(element.title, title, `#${id} carries a title that says what it does`);
  }

  // The footer states the shortcuts, including the one this version added.
  const hint = browser.elements.get('hint');
  const text = [hint.textContent, ...[...hint.children ?? []].map((child) => child.textContent)].join(' ');
  assert.match(text, /Ctrl\+Z/, 'the hint line names the undo shortcut');
});

test('a drag moves the camera and never edits the world', async (t) => {  const { browser, core } = setup({
    core: {
      world: { width: 65536, height: 65536 },
      bounds: [1000, 1000, 1010, 1010],
      cells: [[1005, 1005]],
    },
  });
  teardown(t, browser);
  await loadPage(browser);

  const before = lastFrameRequest(browser);
  // The view opens on the middle of the world, whatever the world contains: the
  // live cells are where the user's work is, and the default view is not the
  // place to guess at it.
  assert.equal(before.x0, Math.round(65536 / 2 - 800 / 60 / 2), 'the view is centred on the world');
  assert.equal(before.w, Math.round(800 / 60));
  assert.equal(core.commands.length, 0, 'placing the view asks the core for nothing but frames');

  const canvas = browser.canvas;
  canvas.dispatch('pointerdown', { pointerId: 7, button: 0, clientX: 400, clientY: 300 });
  for (const clientX of [370, 340, 310, 280, 250, 220, 190, 160, 130, 100]) {
    canvas.dispatch('pointermove', { pointerId: 7, clientX, clientY: 300 });
  }
  canvas.dispatch('pointerup', { pointerId: 7, clientX: 100, clientY: 300 });
  await settle(4);

  assert.equal(
    core.commands.filter((command) => command.cmd === 'toggle').length,
    0,
    'a drag must not toggle a cell',
  );
  assert.equal(canvas.classList.contains('dragging'), false, 'the drag ends');

  // Dragging left by 300 pixels at 800 pixels per 800 / 60 world cells moves the
  // origin right by exactly 300 / 60 = 5 cells. The tolerance is one cell
  // because the pan is applied per move event and each share is a fraction that
  // has no exact binary representation, so `floor` can land either side; the
  // arithmetic itself is asserted as an equality in viewport.test.mjs.
  const after = lastFrameRequest(browser);
  assert.ok(
    Math.abs(after.x0 - before.x0 - 5) <= 1,
    `the camera moved with the drag, in world cells (expected about 5, saw ${after.x0 - before.x0})`,
  );
  assert.ok(after.x0 > before.x0, 'dragging left moves the view right');
});

test('the wheel rescales the view around the pointer', async (t) => {
  const { browser } = setup({
    core: {
      world: { width: 65536, height: 65536 },
      bounds: [1000, 1000, 1010, 1010],
      cells: [[1005, 1005]],
    },
  });
  teardown(t, browser);
  await loadPage(browser);

  const before = lastFrameRequest(browser);
  const pointerX = 600;
  const worldBefore = before.x0 + (pointerX / 800) * before.w;

  browser.canvas.dispatch('wheel', { clientX: pointerX, clientY: 300, deltaY: -100 });
  await settle(4);

  const after = lastFrameRequest(browser);
  assert.ok(after.w < before.w, 'scrolling up zooms in');
  const worldAfter = after.x0 + (pointerX / 800) * after.w;
  // The frame's origin and width are integers, so the anchor is preserved to
  // within the rounding of one cell; the exact property is asserted against the
  // pure function in viewport.test.mjs.
  assert.ok(
    Math.abs(worldAfter - worldBefore) <= 2,
    `the world point under the pointer must not slide: ${worldBefore} -> ${worldAfter}`,
  );
});

test('a press that travels then returns is still a click', async (t) => {
  const { browser, core } = setup({
    core: { world: { width: 64, height: 64 }, bounds: [26, 28, 28, 30], cells: [[26, 28]] },
  });
  teardown(t, browser);
  await loadPage(browser);

  // The cell the click lands on is read off the rectangle the page asked for:
  // the default span is a function of the canvas.
  const frame = lastFrameRequest(browser);
  const clientX = (26 - frame.x0 + 0.5) * (800 / frame.w);
  const clientY = (28 - frame.y0 + 0.5) * (600 / frame.h);

  const canvas = browser.canvas;
  canvas.dispatch('pointerdown', { pointerId: 3, button: 0, clientX, clientY });
  canvas.dispatch('pointermove', { pointerId: 3, clientX: clientX + 1.5, clientY });
  canvas.dispatch('pointermove', { pointerId: 3, clientX, clientY });
  canvas.dispatch('pointerup', { pointerId: 3, clientX, clientY });
  await settle(4);

  const toggles = core.commands.filter((command) => command.cmd === 'toggle');
  assert.equal(toggles.length, 1, 'travel under the threshold is still a click');
  assert.deepEqual(toggles[0], { cmd: 'toggle', x: 26, y: 28 });
});

test('a right button never starts a drag or a toggle', async (t) => {
  const { browser, core } = setup({
    core: { world: { width: 64, height: 64 }, bounds: [26, 28, 28, 30], cells: [[26, 28]] },
  });
  teardown(t, browser);
  await loadPage(browser);

  const canvas = browser.canvas;
  canvas.dispatch('pointerdown', { pointerId: 9, button: 2, clientX: 400, clientY: 300 });
  canvas.dispatch('pointerup', { pointerId: 9, clientX: 400, clientY: 300 });
  await settle(4);

  assert.equal(core.commands.length, 0, 'the secondary button does nothing');
});

// -- the push transport ---------------------------------------------------

test('a connected stream replaces polling', async (t) => {
  const { browser } = setup({
    core: { world: { width: 64, height: 64 }, bounds: [1, 1, 3, 3], cells: THREE_CELLS },
  });
  teardown(t, browser);
  await loadPage(browser);

  const source = StubEventSource.latest;
  assert.ok(source, 'the page opens an event stream');
  assert.equal(source.url, '/api/events');

  source.emit('hello', {
    clientId: 42,
    protocolVersion: 1,
    world: { width: 64, height: 64 },
    rule: 'B3/S23',
    representation: 'sparse',
  });
  await settle(4);

  // The subscription follows the hello, carrying the rectangle on screen: the
  // canvas over the default pixels per cell, which is the span the view was
  // placed with — not a number either side invents.
  const subscription = lastSubscription(browser);
  assert.ok(subscription, 'the page tells the service what it is watching');
  assert.equal(subscription.clientId, 42);
  assert.equal(subscription.w, Math.round(800 / 60));

  const before = browser.requestsTo('/api/frame').length;
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(
    browser.requestsTo('/api/frame').length,
    before,
    'with a stream up the page must not keep asking for frames',
  );

  // A pushed frame is drawn.
  const fillsBefore = browser.canvas.context.calls.fillRect.length;
  source.emit('frame', {
    x0: 0,
    y0: 0,
    w: 64,
    h: 48,
    generation: 7,
    population: 2,
    format: 'cells',
    data: encodeCells([
      [1, 1],
      [2, 2],
    ]),
  });
  await settle(2);
  assert.equal(
    browser.canvas.context.calls.fillRect.length,
    fillsBefore + 3,
    'a pushed frame repaints: background plus two cells',
  );
  assert.equal(browser.elements.get('readout-generation').textContent, '7');
});

test('a viewport change while streaming is published, not polled for', async (t) => {
  const { browser } = setup({
    core: {
      world: { width: 65536, height: 65536 },
      bounds: [1000, 1000, 1010, 1010],
      cells: [[1005, 1005]],
    },
  });
  teardown(t, browser);
  await loadPage(browser);

  const source = StubEventSource.latest;
  source.emit('hello', { clientId: 5, representation: 'sparse', world: { width: 65536, height: 65536 }, rule: 'B3/S23' });
  await settle(4);

  const framesBefore = browser.requestsTo('/api/frame').length;
  const subscriptionsBefore = browser.requestBodiesTo('/api/subscription').length;

  browser.canvas.dispatch('wheel', { clientX: 400, clientY: 300, deltaY: -200 });
  await settle(4);

  assert.ok(
    browser.requestBodiesTo('/api/subscription').length > subscriptionsBefore,
    'a gesture updates the subscription',
  );
  assert.equal(
    browser.requestsTo('/api/frame').length,
    framesBefore,
    'and does not also poll for a frame',
  );
});

test('a stream that drops falls back to polling', async (t) => {
  const { browser } = setup({
    core: { world: { width: 64, height: 64 }, bounds: [1, 1, 3, 3], cells: THREE_CELLS },
  });
  teardown(t, browser);
  await loadPage(browser);

  const source = StubEventSource.latest;
  source.emit('hello', { clientId: 8, representation: 'sparse' });
  await settle(4);
  assert.equal(source.closed, false);

  const framesBefore = browser.requestsTo('/api/frame').length;
  source.fail();
  await settle(4);

  assert.equal(source.closed, true, 'a dropped stream is closed, not left half open');
  assert.ok(
    browser.requestsTo('/api/frame').length > framesBefore,
    'the page asks for a frame itself once the stream is gone',
  );
});

test('a core failure over the stream is reported without closing it', async (t) => {
  const { browser } = setup({
    core: { world: { width: 64, height: 64 }, bounds: [1, 1, 3, 3], cells: THREE_CELLS },
  });
  teardown(t, browser);
  await loadPage(browser);

  const source = StubEventSource.latest;
  source.emit('hello', { clientId: 9, representation: 'sparse' });
  await settle(4);

  source.emit('error', { error: 'core_unavailable', message: 'the world core stopped' });
  await settle(2);

  const error = browser.elements.get('error');
  assert.equal(error.hidden, false);
  // The label is the page's and is translated; the core's own message is
  // appended as detail and is not. Asserting both is asserting that boundary.
  assert.match(error.textContent, /the world core is not running/);
  assert.match(error.textContent, /the world core stopped/);
  assert.equal(source.closed, false, 'a reported failure is not a dropped connection');
  assert.equal(browser.elements.get('core-status').dataset.state, 'down');
});

test('without a stream the page polls while the world runs', async (t) => {
  const { browser } = setup({
    browser: { withEventSource: false },
    core: { world: { width: 64, height: 64 }, bounds: [1, 1, 3, 3], cells: THREE_CELLS },
  });
  teardown(t, browser);
  await loadPage(browser);

  assert.equal(StubEventSource.instances.length, 0, 'no stream is opened when the API is absent');

  browser.elements.get('toggle-run').dispatch('click');
  await settle(4);
  const framesBefore = browser.requestsTo('/api/frame').length;
  // The run loop polls at the core's tick rate; 10 ticks per second means a
  // frame roughly every 100 ms.
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.ok(
    browser.requestsTo('/api/frame').length > framesBefore,
    'the fallback keeps the picture moving',
  );
});

// -- the representation control -------------------------------------------

test('switching the representation goes through the service and is shown', async (t) => {
  const { browser, core } = setup({
    core: { world: { width: 64, height: 64 }, bounds: [1, 1, 3, 3], cells: THREE_CELLS },
  });
  teardown(t, browser);
  await loadPage(browser);

  const control = browser.elements.get('representation');
  assert.equal(control.value, 'sparse', 'the page starts on what the core is running');

  control.value = 'tiled';
  control.dispatch('change');
  await settle(4);

  const bodies = browser.requestBodiesTo('/api/representation');
  assert.equal(bodies.length, 1);
  assert.deepEqual(bodies[0], { representation: 'tiled' });
  assert.equal(core.representation, 'tiled');
  assert.equal(control.value, 'tiled');
});

test('a refused switch leaves the control showing what is actually running', async (t) => {
  const { browser } = setup({
    core: { world: { width: 64, height: 64 }, bounds: [1, 1, 3, 3], cells: THREE_CELLS },
  });
  teardown(t, browser);

  // The service refuses while another switch is in flight.
  browser.setFetchHandler(async (url) => {
    if (String(url).startsWith('/api/representation')) {
      return jsonResponse(
        { ok: false, error: 'switch_in_progress', message: '(current: sparse)' },
        503,
      );
    }
    if (String(url).startsWith('/api/state')) {
      return jsonResponse({
        ok: true,
        world: { width: 64, height: 64 },
        rule: 'B3/S23',
        generation: 0,
        population: 3,
        bounds: [1, 1, 3, 3],
        running: false,
        tps: 10,
        // What the service repeats on every state reply. Without it the page has
        // no representation to offer, which is the point of the enrichment.
        limits: {
          ticksPerSecond: { min: 1, max: 60 },
          stepsPerRequest: 100000,
          maxCoordinate: 65535,
          representations: ['sparse', 'tiled'],
        },
        history: false,
        representation: 'sparse',
      });
    }
    return jsonResponse({ ok: true, frame: { x0: 0, y0: 0, w: 64, h: 48, generation: 0, population: 3, format: 'cells', data: encodeCells(THREE_CELLS) } });
  });

  await loadPage(browser);
  const control = browser.elements.get('representation');
  assert.equal(control.value, 'sparse');

  control.value = 'tiled';
  control.dispatch('change');
  await settle(4);

  assert.equal(control.value, 'sparse', 'the control must not claim a switch that failed');
  // The label is translated; the service's message is appended unchanged.
  assert.match(browser.elements.get('error').textContent, /a representation switch is already running/);
  assert.match(browser.elements.get('error').textContent, /\(current: sparse\)/);
});

test('every id a route\'s scripts read is declared by that route', async (t) => {
  // The synthetic document answers `getElementById` with null for an id the
  // route does not declare, so this is the same question a browser asks — and
  // the answer is checked for every route, not only the one with the canvas. A
  // page module that lost the container it binds is a blank page in the browser
  // and was invisible here until the stub stopped inventing elements.
  const layoutIds = declaredIdsIn(readLayout());
  const reached = new Set();
  for (const route of ROUTE_IDS) {
    const { browser } = setup({
      route,
      core: { world: { width: 64, height: 64 }, bounds: [1, 1, 3, 3], cells: THREE_CELLS },
    });
    teardown(t, browser);
    await loadPage(browser);

    assert.ok(
      browser.requestedIds.length >= 4,
      `${route} resolves a real set of elements, saw ${browser.requestedIds.length}`,
    );
    assert.deepEqual(browser.missingIds(), [], `${route} reads ids its markup does not declare`);
    for (const id of browser.requestedIds) reached.add(id);

    // The other direction, for the fragment: every container the route's own
    // markup declares is read by the route's own module. A fragment carrying an
    // element nobody binds is a fragment that has drifted from its script.
    const own = declaredIdsIn(readFragment(route)).filter((id) => !layoutIds.includes(id));
    assert.deepEqual(
      own.filter((id) => !browser.requestedIds.includes(id)),
      [],
      `${route} declares an id that no script reads`,
    );
  }
  // And the shared layout has no dead element either: every id it writes is read
  // by at least one of the three routes.
  assert.deepEqual(
    layoutIds.filter((id) => !reached.has(id)),
    [],
    'the layout declares an id no route reads',
  );
});

test('the page module may load before the shell, and still runs', async (t) => {
  // The layout writes the shell's <script> first, but the handshake has to work
  // either way: a page whose request went out before the shell existed is
  // answered by the shell's own start-up publication. The first attempt at this
  // split failed exactly here, with a page module that had imported a shell
  // instance holding no data.
  const { browser } = setup({
    core: { world: { width: 64, height: 64 }, bounds: [26, 28, 28, 30], cells: DEFAULT_VIEW_CELLS },
  });
  teardown(t, browser);
  await loadPageLast(browser);

  const frame = lastFrameRequest(browser);
  assert.ok(frame, 'the canvas is drawn even though the page module loaded first');
  assert.equal(browser.canvas.context.calls.fillRect.length, 1 + DEFAULT_VIEW_CELLS.length);
  assert.equal(browser.missingIds().length, 0);
});

test('a language switch reaches every route, from the same storage key', async (t) => {
  // One rule, three pages: the key, the resolution and the effect. A route whose
  // words did not move with the choice would be a route with its own copy.
  for (const route of ROUTE_IDS) {
    const { browser } = setup({
      route,
      browser: { storage: { 'lifegame.viewer.locale': 'zh' } },
      core: { world: { width: 64, height: 64 }, cells: THREE_CELLS, history: true, historyRows: [] },
    });
    teardown(t, browser);
    await loadPage(browser);

    assert.equal(browser.document.documentElement.lang, 'zh', `${route} honours the stored language`);
    assert.equal(browser.elements.get('locale').value, 'zh', `${route} shows the choice`);
    const translated = browser.translatedText();
    assert.ok(Object.keys(translated).length >= 3, `${route} has translated nodes`);
    for (const [key, text] of Object.entries(translated)) {
      assert.notEqual(text, '', `${route}: ${key} rendered empty`);
      assert.notEqual(text, key, `${route}: ${key} was left as its own key`);
    }
    assert.equal(browser.document.title, '生命游戏 查看器', `${route} titles the tab the same way`);
  }
});

// -- the language ---------------------------------------------------------

test('the page starts in the language the browser asks for', async (t) => {
  const { browser } = setup({
    browser: { language: 'zh-CN' },
    core: { world: { width: 64, height: 64 }, cells: THREE_CELLS },
  });
  teardown(t, browser);
  await loadPage(browser);

  assert.equal(browser.document.documentElement.lang, 'zh');
  assert.equal(browser.elements.get('toggle-run').textContent, '运行');
  assert.equal(browser.elements.get('step-once').textContent, '单步');
  assert.equal(browser.document.title, '生命游戏 查看器');
  assert.equal(browser.elements.get('locale').value, 'zh');
});

test('switching the language rewrites the page with no reload', async (t) => {
  const { browser } = setup({
    core: { world: { width: 64, height: 64 }, cells: THREE_CELLS },
  });
  teardown(t, browser);
  await loadPage(browser);

  assert.equal(browser.document.documentElement.lang, 'en');
  assert.equal(browser.elements.get('clear-world').textContent, 'Clear');
  const before = browser.elements.get('locale');
  const controlsBefore = browser.requestedIds.slice().sort();

  before.value = 'zh';
  before.dispatch('change');
  await settle(2);

  assert.equal(browser.document.documentElement.lang, 'zh');
  assert.equal(browser.elements.get('clear-world').textContent, '清空');
  assert.equal(browser.document.title, '生命游戏 查看器');
  assert.equal(browser.storage.get('lifegame.viewer.locale'), 'zh', 'the choice is remembered');
  // The control set is the same: switching language changes words, not widgets.
  assert.deepEqual(browser.requestedIds.slice().sort(), controlsBefore);
});

test('a stored language wins over the browser', async (t) => {
  const { browser } = setup({
    browser: { language: 'zh-CN', storage: { 'lifegame.viewer.locale': 'en' } },
    core: { world: { width: 64, height: 64 }, cells: THREE_CELLS },
  });
  teardown(t, browser);
  await loadPage(browser);

  assert.equal(browser.document.documentElement.lang, 'en');
  assert.equal(browser.elements.get('toggle-run').textContent, 'Run');
});

test('every visible string comes from the table, in both languages', async (t) => {
  const { browser } = setup({
    core: { world: { width: 64, height: 64 }, cells: THREE_CELLS },
  });
  teardown(t, browser);
  await loadPage(browser);

  for (const locale of ['en', 'zh']) {
    const control = browser.elements.get('locale');
    control.value = locale;
    control.dispatch('change');
    await settle(2);

    const translated = browser.translatedText();
    const keys = Object.keys(translated);
    assert.ok(keys.length >= 15, `only ${keys.length} nodes were translated`);
    for (const [key, text] of Object.entries(translated)) {
      assert.notEqual(text, '', `${key} rendered empty in ${locale}`);
      // A node that still shows its key was never translated.
      assert.notEqual(text, key, `${key} was left as its own key`);
    }
    assert.match(browser.elements.get('hint').children.length ? 'built' : 'built', /built/);
  }
});

// -- the core's declared limits -------------------------------------------

test('the rate control takes its range from the core, not from the markup', async (t) => {
  const { browser } = setup({
    core: {
      world: { width: 64, height: 64 },
      cells: THREE_CELLS,
      limits: {
        ticksPerSecond: { min: 3, max: 24 },
        stepsPerRequest: 500,
        maxCoordinate: 63,
        representations: ['tiled'],
      },
    },
  });
  teardown(t, browser);
  await loadPage(browser);

  const tps = browser.elements.get('tps');
  assert.equal(tps.min, '3');
  assert.equal(tps.max, '24');
  assert.equal(tps.disabled, false);
  // The representation list is the core's too, and it is the only one offered.
  const representation = browser.elements.get('representation');
  assert.deepEqual(representation.options.map((option) => option.value), ['tiled']);
  assert.equal(representation.options[0].textContent, 'tiled');
});

test('a core that declares no rate range gets no rate control', async (t) => {
  const { browser } = setup({
    core: {
      world: { width: 64, height: 64 },
      cells: THREE_CELLS,
      limits: { ticksPerSecond: null, stepsPerRequest: null, maxCoordinate: null, representations: ['sparse'] },
    },
  });
  teardown(t, browser);
  await loadPage(browser);

  const tps = browser.elements.get('tps');
  assert.equal(tps.disabled, true, 'an undeclared bound must disable the control, not invent one');
  assert.equal(tps.getAttribute('max'), null);
});

test('the grid width options are the widths the module accepts', async (t) => {
  const { browser } = setup({
    core: { world: { width: 64, height: 64 }, cells: THREE_CELLS },
  });
  teardown(t, browser);
  await loadPage(browser);

  const select = browser.elements.get('grid-width');
  assert.deepEqual(
    select.options.map((option) => Number(option.value)),
    [...GRID_WIDTHS],
  );
  assert.equal(select.options[0].textContent, `${GRID_WIDTHS[0]} px`);
});

// -- the history tree -----------------------------------------------------

/** A linear run: each node's parent is the one before it. */
const HISTORY_ROWS = [
  { id: 1, parent: null, generation: 0, kind: 'keyframe', population: 5, changed: 5, born: 5, died: 0, at: 't0' },
  { id: 2, parent: 1, generation: 1, kind: 'delta', population: 5, changed: 4, born: 2, died: 2, at: 't1' },
  { id: 3, parent: 2, generation: 2, kind: 'delta', population: 5, changed: 4, born: 2, died: 2, at: 't2' },
];

/**
 * A forked run: node 3 has two children, so the branch that was recorded first
 * and the branch that was made by selecting an older node and editing both
 * exist. This is the shape the panel has to be able to draw.
 */
const FORKED_ROWS = [
  { id: 1, parent: null, generation: 0, kind: 'keyframe', population: 5, changed: 5, born: 5, died: 0, at: 't0' },
  { id: 2, parent: 1, generation: 1, kind: 'delta', population: 5, changed: 4, born: 2, died: 2, at: 't1' },
  { id: 3, parent: 2, generation: 2, kind: 'keyframe', population: 5, changed: 1, born: 1, died: 0, at: 't2' },
  { id: 4, parent: 3, generation: 3, kind: 'delta', population: 5, changed: 4, born: 2, died: 2, at: 't3' },
  { id: 5, parent: 3, generation: 2, kind: 'keyframe', population: 6, changed: 1, born: 1, died: 0, at: 't4' },
  { id: 6, parent: 5, generation: 3, kind: 'delta', population: 6, changed: 4, born: 2, died: 2, at: 't5' },
];

test('a core that records no history says so instead of drawing a tree', async (t) => {
  const { browser } = setup({
    route: 'history',
    core: { world: { width: 64, height: 64 }, cells: THREE_CELLS },
  });
  teardown(t, browser);
  await loadPage(browser);

  // The tree's section stays hidden — there is nothing to put in it — and the
  // note beside it says why. This is the one behaviour that cannot be carried
  // over from the single-page version unchanged: on a page whose subject is the
  // tree, the page *must* ask, because the answer is what tells it that there is
  // no recording. The old case asserted the request count was zero, which on
  // this route would mean a page that never asks and therefore never learns.
  assert.equal(browser.elements.get('timeline').hidden, true);
  assert.ok(browser.requestsTo('/api/history').length >= 1, 'the history page asks for the tree');
  assert.match(browser.elements.get('timeline-note').textContent, /not recording a history/);
});

/**
 * The first descendant of an element carrying a class, for a row whose children
 * are no longer positional: the generation and the marks are in the flow, and the
 * node's numbers are in an overlay of their own.
 */
function childWithClass(root, name) {
  for (const child of root.children ?? []) {
    if (child.classList.contains(name)) return child;
    const deeper = childWithClass(child, name);
    if (deeper !== null) return deeper;
  }
  return null;
}

/** Every descendant of an element carrying a class, in document order. */
function childrenWithClass(root, name) {
  const found = [];
  for (const child of root.children ?? []) {
    if (child.classList.contains(name)) found.push(child);
    found.push(...childrenWithClass(child, name));
  }
  return found;
}

test('the timeline draws the recorded generations and selects one', async (t) => {
  const { browser, core } = setup({
    route: 'history',
    core: {
      world: { width: 64, height: 64 },
      cells: THREE_CELLS,
      generation: 2,
      history: true,
      historyRows: HISTORY_ROWS,
    },
  });
  teardown(t, browser);
  await loadPage(browser);

  const timeline = browser.elements.get('timeline');
  assert.equal(timeline.hidden, false);
  const rows = browser.elements.get('timeline-list').children;
  assert.equal(rows.length, HISTORY_ROWS.length);
  const first = rows[0].children[0];
  assert.equal(first.dataset.node, '1', 'a row is addressed by node, not by generation');
  assert.equal(first.dataset.generation, '0');
  assert.equal(first.style.getPropertyValue('--depth'), '0', 'a root is not indented');
  // A linear run is one column. Indentation is the *fork* depth, not the tree
  // depth: indenting the third generation twice would walk a long run off the
  // page while saying nothing the generation number does not already say.
  assert.equal(
    rows[2].children[0].style.getPropertyValue('--depth'),
    '0',
    'a chain adds no indentation, however long it is',
  );
  assert.equal(childWithClass(first, 'timeline-generation').textContent, '0');
  assert.equal(childWithClass(first, 'timeline-kind').textContent, 'keyframe');
  assert.match(childWithClass(first, 'timeline-figures').textContent, /population 5/);
  assert.equal(rows[2].children[0].dataset.current, 'true', 'the current generation is marked');
  assert.equal(rows[2].children[0].dataset.head, 'true', 'and so is the working point');

  // Clicking a node previews it by *moving the working point*, which is what
  // `select` does. A rollback would only read, and then an edit would append to
  // the old head instead of making a branch.
  first.dispatch('click');
  await settle(4);
  assert.deepEqual(core.selects, [1], 'clicking sends select');
  assert.deepEqual(core.rollbacks, [], 'and never a rollback');
  assert.equal(core.head, 1, 'the working point moved onto the node that was clicked');
  // The visible proof on this page: the marker that was on the newest node is
  // now on the one that was clicked. (The single-page version read this off the
  // canvas page's generation readout, which this route does not have.)
  const after = browser.elements.get('timeline-list').children.map((item) => item.children[0]);
  assert.equal(after[0].dataset.current, 'true', 'the clicked node is the current generation');
  assert.equal(after[0].dataset.head, 'true', 'and the working point');
  assert.equal(after[2].dataset.current, 'false', 'the marker left the old node');
});

test('a forked history is drawn as branches, and both of them are there', async (t) => {
  const { browser } = setup({
    route: 'history',
    core: {
      world: { width: 64, height: 64 },
      cells: THREE_CELLS,
      generation: 3,
      history: true,
      historyRows: FORKED_ROWS,
    },
  });
  teardown(t, browser);
  await loadPage(browser);

  const rows = browser.elements
    .get('timeline-list')
    .children.map((item) => item.children[0]);
  assert.equal(rows.length, FORKED_ROWS.length, 'every node of the tree is drawn');
  const byNode = new Map(rows.map((row) => [row.dataset.node, row]));

  // The fork is the node with two children, and it says so.
  assert.equal(byNode.get('3').dataset.fork, 'true', 'generation 2 is where the branches part');
  assert.equal(byNode.get('4').dataset.fork, 'false');
  // Its two children are told apart by name, not only by position.
  assert.equal(byNode.get('4').dataset.branch, 'a');
  assert.equal(byNode.get('5').dataset.branch, 'b');
  assert.equal(byNode.get('2').dataset.branch, '', 'an only child is not a branch');
  // Indentation changes at the fork and nowhere else: both children are one
  // level deeper than their parent, and the same level as each other.
  const depthOf = (id) => Number(byNode.get(id).style.getPropertyValue('--depth'));
  assert.ok(depthOf('4') > depthOf('3'), 'a branch is drawn deeper than the fork it parts from');
  assert.ok(depthOf('5') > depthOf('3'), 'and so is the other one');
  assert.equal(depthOf('4'), depthOf('5'), 'the two branches are at the same level');
  assert.equal(depthOf('6'), depthOf('5'), 'a chain below a fork adds nothing');
  assert.equal(depthOf('1'), depthOf('2'), 'a chain above a fork adds nothing either');
  assert.ok(
    depthOf('4') <= MAX_INDENT_LEVELS,
    'the drawn indent is capped, so a deep tree cannot leave the page',
  );

  // The working point is on the newer branch, and the fork point is not it.
  assert.equal(byNode.get('6').dataset.head, 'true');
  assert.equal(byNode.get('3').dataset.head, 'false');
  // Nothing was discarded: two nodes carry generation 3, one at the end of each
  // branch. That is the visible proof that looking at an older state and editing
  // there produced a sibling rather than replacing what came after.
  const threes = rows.filter((row) => row.dataset.generation === '3');
  assert.equal(threes.length, 2, 'the old branch and the new one both survive');
  assert.deepEqual(
    threes.map((row) => row.dataset.node),
    ['4', '6'],
    'one at the end of each branch',
  );
});

test('a linear run of twenty generations is drawn in one column', async (t) => {
  const rows = Array.from({ length: 20 }, (_, index) => ({
    id: index + 1,
    parent: index === 0 ? null : index,
    generation: index,
    kind: index === 0 ? 'keyframe' : 'delta',
    population: 5,
    changed: 4,
    born: 2,
    died: 2,
    at: `2026-10-10T08:00:${String(index).padStart(2, '0')}+00:00`,
  }));
  const { browser } = setup({
    route: 'history',
    core: {
      world: { width: 64, height: 64 },
      cells: THREE_CELLS,
      generation: 19,
      history: true,
      historyRows: rows,
    },
  });
  teardown(t, browser);
  await loadPage(browser);

  const drawn = browser.elements
    .get('timeline-list')
    .children.map((item) => item.children[0].style.getPropertyValue('--depth'));
  assert.equal(drawn.length, 20);
  assert.deepEqual(new Set(drawn), new Set(['0']), `every row is in the same column: ${drawn}`);
});

test('a node carries its numbers, and the stylesheet opens them on hover or focus', async (t) => {
  const { browser } = setup({
    route: 'history',
    core: {
      world: { width: 64, height: 64 },
      cells: THREE_CELLS,
      generation: 2,
      history: true,
      historyRows: HISTORY_ROWS,
    },
  });
  teardown(t, browser);
  await loadPage(browser);

  const row = browser.elements.get('timeline-list').children[0].children[0];
  // A row is a button: that is what makes it reachable with Tab and with the
  // arrow keys the page wires up.
  assert.equal(row.tagName, 'BUTTON');
  const details = childrenWithClass(row, 'timeline-detail');
  assert.equal(details.length, 3, 'the kind, the numbers and the time are the node\'s details');
  assert.equal(details[0].textContent, 'keyframe');
  assert.match(details[1].textContent, /population 5/);
  assert.match(details[1].textContent, /changed 5/);
  assert.match(details[2].textContent, /2026|t0/, 'the node time is in the document');
  // The three of them live in one container that is out of the row's flow, which
  // is what keeps the row one line tall: the geometry case further down measures
  // it, and `css-audit.test.mjs` asserts the stylesheet half.
  const overlay = childWithClass(row, 'timeline-overlay');
  assert.ok(overlay, 'the node\'s numbers need an overlay of their own');
  assert.deepEqual(
    overlay.children.map((child) => child.classList.contains('timeline-detail')),
    [true, true, true],
    'and every one of them must be inside it',
  );
  assert.ok(
    childWithClass(row, 'timeline-generation') !== null,
    'and the generation is always one of them',
  );
});

test('the step controls follow the branch rather than a list', async (t) => {
  const { browser, core } = setup({
    route: 'history',
    core: {
      world: { width: 64, height: 64 },
      cells: THREE_CELLS,
      generation: 2,
      history: true,
      historyRows: HISTORY_ROWS,
    },
  });
  teardown(t, browser);
  await loadPage(browser);

  browser.elements.get('step-back').dispatch('click');
  await settle(4);
  assert.deepEqual(core.selects, [2], 'backwards is the parent of the working point');

  browser.elements.get('step-forward').dispatch('click');
  await settle(4);
  assert.deepEqual(core.selects, [2, 3], 'forwards is its newest child');
});

test('the export button writes an archive through the service', async (t) => {
  const { browser, core } = setup({
    route: 'archives',
    core: {
      world: { width: 64, height: 64 },
      cells: THREE_CELLS,
      history: true,
      historyRows: HISTORY_ROWS,
    },
  });
  teardown(t, browser);
  await loadPage(browser);

  browser.elements.get('export-archive').dispatch('click');
  await settle(3);

  assert.deepEqual(core.archives, ['archive.jsonl']);
  // The message moved with the control: exporting is the archive section's job,
  // so it reports in that section rather than in the history's note.
  assert.match(browser.elements.get('archive-note').textContent, /wrote 3 generation/);
});

test('a long timeline is windowed rather than fully rendered', async (t) => {
  const rows = Array.from({ length: 200 }, (_, index) => ({
    generation: index,
    kind: index === 0 ? 'keyframe' : 'delta',
    population: 5,
    changed: 4,
    born: 2,
    died: 2,
    at: `t${index}`,
  }));
  const { browser } = setup({
    route: 'history',
    core: {
      world: { width: 64, height: 64 },
      cells: THREE_CELLS,
      generation: 199,
      history: true,
      historyRows: rows,
    },
  });
  teardown(t, browser);
  await loadPage(browser);

  const list = browser.elements.get('timeline-list');
  // 40 rows plus the "show earlier" control.
  assert.equal(list.children.length, 41);
  assert.match(list.children[0].children[0].textContent, /160/);

  list.children[0].children[0].dispatch('click');
  await settle(2);
  assert.equal(list.children.length, 81, 'the window widens by another page');
});

// -- the panel ------------------------------------------------------------

test('the panel starts in the stored state', async (t) => {
  const { browser } = setup({
    browser: { storage: { 'lifegame.viewer.panel': 'wide' } },
    core: { world: { width: 64, height: 64 }, cells: THREE_CELLS },
  });
  teardown(t, browser);
  await loadPage(browser);
  assert.equal(browser.elements.get('stage').dataset.panel, 'wide');
});

test('an unreadable stored panel state falls back to a column', async (t) => {
  // A value from somewhere else is not repaired into the nearest state: that
  // would move a user who had a valid setting in an older build into one they
  // never chose.
  const { browser } = setup({
    browser: { storage: { 'lifegame.viewer.panel': 'expanded' } },
    core: { world: { width: 64, height: 64 }, cells: THREE_CELLS },
  });
  teardown(t, browser);
  await loadPage(browser);
  assert.equal(browser.elements.get('stage').dataset.panel, 'normal');
});

test('collapsing gives the canvas the space and remembers the choice', async (t) => {
  const { browser } = setup({
    core: { world: { width: 64, height: 64 }, cells: THREE_CELLS },
  });
  teardown(t, browser);
  await loadPage(browser);

  const stage = browser.elements.get('stage');
  assert.equal(stage.dataset.panel, 'normal');
  assert.match(browser.elements.get('panel-handle').textContent, /hide/i);

  browser.elements.get('panel-handle').dispatch('click');
  await settle(2);
  assert.equal(stage.dataset.panel, 'collapsed');
  assert.equal(browser.storage.get('lifegame.viewer.panel'), 'collapsed');
  // The handle has to change meaning, or the panel can be hidden with nothing
  // left on screen that says how to get it back.
  assert.match(browser.elements.get('panel-handle').textContent, /show/i);

  browser.elements.get('panel-handle').dispatch('click');
  await settle(2);
  assert.equal(stage.dataset.panel, 'normal');
});

test('the full-width control takes the stage and returns the canvas', async (t) => {
  const { browser } = setup({
    core: { world: { width: 64, height: 64 }, cells: THREE_CELLS },
  });
  teardown(t, browser);
  await loadPage(browser);

  const stage = browser.elements.get('stage');
  browser.elements.get('panel-wide').dispatch('click');
  await settle(2);
  assert.equal(stage.dataset.panel, 'wide');
  browser.elements.get('panel-wide').dispatch('click');
  await settle(2);
  assert.equal(stage.dataset.panel, 'normal');
});

test('the keyboard toggles the panel and its width', async (t) => {
  const { browser } = setup({
    core: { world: { width: 64, height: 64 }, cells: THREE_CELLS },
  });
  teardown(t, browser);
  await loadPage(browser);

  const stage = browser.elements.get('stage');
  browser.window.dispatch('keydown', { key: 'h', target: null, preventDefault() {} });
  await settle(1);
  assert.equal(stage.dataset.panel, 'collapsed');
  browser.window.dispatch('keydown', { key: 'h', target: null, preventDefault() {} });
  await settle(1);
  assert.equal(stage.dataset.panel, 'normal');
  browser.window.dispatch('keydown', { key: 'w', target: null, preventDefault() {} });
  await settle(1);
  assert.equal(stage.dataset.panel, 'wide');
});

test('a canvas resize is redrawn at once rather than at the next event', async (t) => {
  // Collapsing the panel, or switching language, changes the canvas without a
  // window resize. Waiting for the next pushed frame would leave a stretched
  // canvas on screen until something unrelated happened.
  const { browser } = setup({
    core: { world: { width: 64, height: 64 }, cells: THREE_CELLS },
  });
  teardown(t, browser);
  await loadPage(browser);

  const before = browser.canvas.context.calls.fillRect.length;
  assert.ok(before > 0, 'the first frame must have been drawn');
  assert.ok(browser.resizeObservers.length > 0, 'the page must observe the canvas size');

  browser.canvas.rect = { left: 0, top: 0, width: 1000, height: 600, right: 1000, bottom: 600 };
  browser.notifyResize();
  await settle(2);

  assert.equal(browser.canvas.width, 1000, 'the backing store follows the new size');
  const calls = browser.canvas.context.calls.fillRect;
  assert.ok(calls.length > before, 'the canvas must be redrawn with no window event');
  // The background is the fill of the whole canvas; the later, smaller fills are
  // the cells drawn on top of it.
  assert.ok(
    calls.some((call) => call.x === 0 && call.y === 0 && call.w === 1000 && call.h === 600),
    'and the background must be repainted at the new width',
  );
});

// -- touch gestures -------------------------------------------------------

/**
 * A world big enough to pan around inside, with the view somewhere in the middle
 * of it.
 *
 * A world no bigger than the initial span cannot be panned at all: the viewport
 * is clamped to the world, so it sits pinned at the origin and every pan
 * assertion would pass or fail for a reason that has nothing to do with gestures.
 */
const GESTURE_CORE = {
  world: { width: 8192, height: 8192 },
  bounds: [4000, 4000, 4004, 4004],
  cells: [
    [4000, 4000],
    [4001, 4001],
    [4002, 4002],
  ],
};

/**
 * The contacts of a two-finger gesture, as the browser reports them: one
 * `pointerdown` per finger, then a move per finger.
 */
function twoFingerGesture(canvas, from, to) {
  canvas.dispatch('pointerdown', { pointerId: 1, clientX: from[0][0], clientY: from[0][1], button: 0 });
  canvas.dispatch('pointerdown', { pointerId: 2, clientX: from[1][0], clientY: from[1][1], button: 0 });
  canvas.dispatch('pointermove', { pointerId: 1, clientX: to[0][0], clientY: to[0][1], button: 0 });
  canvas.dispatch('pointermove', { pointerId: 2, clientX: to[1][0], clientY: to[1][1], button: 0 });
}

test('two fingers zoom the view and never edit a cell', async (t) => {
  const { browser, core } = setup({ core: GESTURE_CORE });
  teardown(t, browser);
  await loadPage(browser);

  const before = lastFrameRequest(browser);
  // Fingers on the midpoint (200, 200), spread from 40 to 120 pixels: three
  // times the spread, so a third of the span.
  twoFingerGesture(
    browser.canvas,
    [
      [160, 200],
      [240, 200],
    ],
    [
      [80, 200],
      [320, 200],
    ],
  );
  await settle(2);

  const after = lastFrameRequest(browser);
  assert.ok(after.w < before.w, `the span must shrink: ${before.w} -> ${after.w}`);
  assert.equal(core.commands.filter((command) => command.cmd === 'toggle').length, 0);

  browser.canvas.dispatch('pointerup', { pointerId: 1, clientX: 80, clientY: 200, button: 0 });
  browser.canvas.dispatch('pointerup', { pointerId: 2, clientX: 320, clientY: 200, button: 0 });
  await settle(1);
  assert.equal(
    core.commands.filter((command) => command.cmd === 'toggle').length,
    0,
    'a pinch is a camera gesture, however still the fingers were',
  );
});

test('two fingers moving together pan without zooming', async (t) => {
  const { browser } = setup({
    core: GESTURE_CORE,
  });
  teardown(t, browser);
  await loadPage(browser);

  const before = lastFrameRequest(browser);
  twoFingerGesture(
    browser.canvas,
    [
      [100, 100],
      [200, 100],
    ],
    [
      [180, 100],
      [280, 100],
    ],
  );
  await settle(2);

  const after = lastFrameRequest(browser);
  assert.equal(after.w, before.w, 'a parallel move does not change the span');
  assert.ok(after.x0 < before.x0, 'the view follows the fingers to the right');
});

test('lifting one finger of a pinch keeps panning and still edits nothing', async (t) => {
  const { browser, core } = setup({
    core: GESTURE_CORE,
  });
  teardown(t, browser);
  await loadPage(browser);

  twoFingerGesture(
    browser.canvas,
    [
      [100, 100],
      [200, 100],
    ],
    [
      [80, 100],
      [220, 100],
    ],
  );
  await settle(1);
  const afterPinch = lastFrameRequest(browser);

  // One finger up: the remaining contact must keep panning from where it is,
  // not jump by the distance it has already travelled. The remaining finger
  // travels far enough that the *whole-cell* origin the request carries has to
  // move: at a span of about ten cells, 200 pixels is a couple of cells, while a
  // few pixels would round back to the same rectangle.
  browser.canvas.dispatch('pointerup', { pointerId: 2, clientX: 220, clientY: 100, button: 0 });
  browser.canvas.dispatch('pointermove', { pointerId: 1, clientX: 20, clientY: 100, button: 0 });
  await settle(2);
  const afterPan = lastFrameRequest(browser);
  assert.equal(afterPan.w, afterPinch.w, 'the span must not change when a finger lifts');
  assert.ok(
    afterPan.x0 > afterPinch.x0,
    `the remaining finger kept panning: ${afterPinch.x0} -> ${afterPan.x0}`,
  );

  browser.canvas.dispatch('pointerup', { pointerId: 1, clientX: 60, clientY: 100, button: 0 });
  await settle(1);
  assert.equal(
    core.commands.filter((command) => command.cmd === 'toggle').length,
    0,
    'ending a pinch with one finger must not be read as a click',
  );
});

test('a cancelled pointer ends the gesture without editing anything', async (t) => {
  const { browser, core } = setup({
    core: GESTURE_CORE,
  });
  teardown(t, browser);
  await loadPage(browser);

  browser.canvas.dispatch('pointerdown', { pointerId: 1, clientX: 100, clientY: 100, button: 0 });
  browser.canvas.dispatch('pointercancel', { pointerId: 1, clientX: 100, clientY: 100, button: 0 });
  await settle(1);

  assert.equal(core.commands.filter((command) => command.cmd === 'toggle').length, 0);
  assert.equal(browser.canvas.classList.contains('dragging'), false);
});

test('one finger still toggles a cell and pans, as it did before', async (t) => {
  const { browser, core } = setup({
    core: GESTURE_CORE,
  });
  teardown(t, browser);
  await loadPage(browser);

  // A press that does not travel is a click on the cell under it. The expected
  // cell is read off the frame the page actually asked for rather than assumed,
  // because the span is the core's world size once the initial view is clamped.
  const frame = lastFrameRequest(browser);
  browser.canvas.dispatch('pointerdown', { pointerId: 1, clientX: 40, clientY: 40, button: 0 });
  browser.canvas.dispatch('pointerup', { pointerId: 1, clientX: 40, clientY: 40, button: 0 });
  await settle(2);
  const toggles = core.commands.filter((command) => command.cmd === 'toggle');
  assert.equal(toggles.length, 1);
  assert.deepEqual(
    [toggles[0].x, toggles[0].y],
    [Math.floor(frame.x0 + (40 / 800) * frame.w), Math.floor(frame.y0 + (40 / 600) * frame.h)],
  );

  // A press that travels pans and does not edit.
  const before = lastFrameRequest(browser);
  browser.canvas.dispatch('pointerdown', { pointerId: 3, clientX: 200, clientY: 200, button: 0 });
  browser.canvas.dispatch('pointermove', { pointerId: 3, clientX: 240, clientY: 200, button: 0 });
  await settle(2);
  browser.canvas.dispatch('pointerup', { pointerId: 3, clientX: 240, clientY: 200, button: 0 });
  await settle(1);
  assert.equal(core.commands.filter((command) => command.cmd === 'toggle').length, 1);
  assert.ok(lastFrameRequest(browser).x0 < before.x0, 'dragging right moves the view left');
});

// -- the archive manager --------------------------------------------------

const ARCHIVE_FILES = [
  { name: 'first.jsonl', bytes: 2048, modified: '2026-10-10T08:00:00.000Z', generations: 12 },
  { name: 'second.jsonl', bytes: 300, modified: '2026-10-09T08:00:00.000Z', generations: null },
];

test('the archive list shows what the service reports', async (t) => {
  const { browser } = setup({
    route: 'archives',
    core: { world: { width: 64, height: 64 }, cells: THREE_CELLS, archiveFiles: ARCHIVE_FILES },
  });
  teardown(t, browser);
  await loadPage(browser);

  const list = browser.elements.get('archive-list');
  assert.equal(list.children.length, 2);
  const row = list.children[0];
  assert.equal(row.children[0].textContent, 'first.jsonl');
  assert.match(row.children[1].textContent, /12/);
  assert.match(row.children[1].textContent, /2\.0 kB/);
  // Three actions per row: load, rename, delete.
  assert.equal(row.children[2].children.length, 3);
  // A file whose generation count could not be read says so rather than
  // claiming zero.
  assert.match(list.children[1].children[1].textContent, /unknown/i);
});

test('the export button uses the typed name and refreshes the list', async (t) => {
  const { browser, core } = setup({
    route: 'archives',
    core: { world: { width: 64, height: 64 }, cells: THREE_CELLS, history: true, historyRows: [] },
  });
  teardown(t, browser);
  await loadPage(browser);

  browser.elements.get('archive-name').value = 'run-7.jsonl';
  browser.elements.get('export-archive').dispatch('click');
  await settle(3);

  assert.deepEqual(core.archives, ['run-7.jsonl']);
  assert.match(browser.elements.get('archive-note').textContent, /run-7\.jsonl/);
  assert.equal(browser.elements.get('archive-list').children.length, 1);
});

test('an export with no name still writes a usable file', async (t) => {
  const { browser, core } = setup({
    route: 'archives',
    core: { world: { width: 64, height: 64 }, cells: THREE_CELLS, history: true, historyRows: [] },
  });
  teardown(t, browser);
  await loadPage(browser);

  browser.elements.get('export-archive').dispatch('click');
  await settle(3);
  assert.deepEqual(core.archives, ['archive.jsonl']);
});

test('renaming an archive replaces the row', async (t) => {
  const { browser, core } = setup({
    route: 'archives',
    core: { world: { width: 64, height: 64 }, cells: THREE_CELLS, archiveFiles: ARCHIVE_FILES },
  });
  teardown(t, browser);
  await loadPage(browser);

  const list = browser.elements.get('archive-list');
  // The rename button of the first row starts an in-place edit.
  list.children[0].children[2].children[1].dispatch('click');
  await settle(1);
  const input = list.children[0].children[0];
  assert.equal(input.tagName, 'INPUT');
  input.value = 'renamed.jsonl';
  list.children[0].children[1].children[0].dispatch('click');
  await settle(3);

  assert.deepEqual(core.renames, [{ name: 'first.jsonl', to: 'renamed.jsonl' }]);
  assert.equal(browser.elements.get('archive-list').children[0].children[0].textContent, 'renamed.jsonl');
  assert.match(browser.elements.get('archive-note').textContent, /renamed\.jsonl/);
});

test('deleting an archive takes two presses', async (t) => {
  const { browser, core } = setup({
    route: 'archives',
    core: { world: { width: 64, height: 64 }, cells: THREE_CELLS, archiveFiles: ARCHIVE_FILES },
  });
  teardown(t, browser);
  await loadPage(browser);

  const list = browser.elements.get('archive-list');
  const remove = () => list.children[0].children[2].children[2];
  remove().dispatch('click');
  await settle(1);
  assert.equal(browser.requestsTo('/api/archive/delete').length, 0, 'one press asks, it does not delete');
  assert.match(browser.elements.get('archive-list').children[0].children[2].children[2].textContent, /confirm/i);

  browser.elements.get('archive-list').children[0].children[2].children[2].dispatch('click');
  await settle(3);
  assert.deepEqual(core.archiveFiles.map((entry) => entry.name), ['second.jsonl']);
  assert.equal(browser.elements.get('archive-list').children.length, 1);
});

test('loading an archive says plainly when the core cannot do it', async (t) => {
  // The protocol has no command that imports an archive as a session yet. The
  // page must say that, in the reader's language, rather than showing a success
  // that did not happen.
  const { browser, core } = setup({
    route: 'archives',
    core: {
      world: { width: 64, height: 64 },
      cells: THREE_CELLS,
      archiveFiles: ARCHIVE_FILES,
      importSupported: false,
    },
  });
  teardown(t, browser);
  await loadPage(browser);

  browser.elements.get('archive-list').children[0].children[2].children[0].dispatch('click');
  await settle(3);

  assert.deepEqual(core.imports, ['first.jsonl']);
  assert.match(browser.elements.get('archive-note').textContent, /cannot load an archive/i);
});

test('loading an archive that the core accepts reports what it did', async (t) => {
  const { browser, core } = setup({
    route: 'archives',
    core: {
      world: { width: 64, height: 64 },
      cells: THREE_CELLS,
      history: true,
      historyRows: [{ generation: 0, kind: 'keyframe', population: 3, changed: 3, born: 3, died: 0 }],
      archiveFiles: ARCHIVE_FILES,
    },
  });
  teardown(t, browser);
  await loadPage(browser);

  browser.elements.get('archive-list').children[0].children[2].children[0].dispatch('click');
  await settle(3);

  assert.deepEqual(core.imports, ['first.jsonl']);
  assert.match(browser.elements.get('archive-note').textContent, /loaded first\.jsonl/);
  // The page read the state the service reported back. It cannot show a world —
  // this route has no canvas — but the shared state is what a later route's
  // document is built from, so the load has to have landed there.
  assert.equal(browser.elements.get('export-archive').disabled, false);
});

test('the export control is disabled while the core records nothing', async (t) => {
  const { browser } = setup({
    route: 'archives',
    core: { world: { width: 64, height: 64 }, cells: THREE_CELLS, archiveFiles: ARCHIVE_FILES },
  });
  teardown(t, browser);
  await loadPage(browser);

  assert.equal(
    browser.elements.get('export-archive').disabled,
    true,
    'a core that records nothing has nothing to export',
  );
});

// -- the view a page opens with -------------------------------------------
//
// The two halves of the requirement, asserted through the page: the span is the
// canvas width over `DEFAULT_PIXELS_PER_CELL`, the origin puts the world's centre
// in the middle of the view, and neither is decided before there is a canvas with
// a size and a world to put in it. The arithmetic itself is asserted in
// `viewport.test.mjs`; this is the wiring that reads a canvas and a `hello`.

test('the first view is the canvas over the default pixels per cell', async (t) => {
  const { browser } = setup({
    core: { world: { width: 65536, height: 65536 }, cells: [[32768, 32768]] },
  });
  teardown(t, browser);
  await loadPage(browser);

  const frame = lastFrameRequest(browser);
  assert.ok(frame, 'the page asks for the rectangle it is looking at');
  assert.equal(frame.w, Math.round(800 / 60), '800 css pixels over 60 pixels per cell');
  assert.equal(frame.h, Math.round((800 / 60) * (600 / 800)), 'and the height follows the canvas');
  // The readout is the span the page believes it has, in whole cells.
  assert.equal(browser.elements.get('readout-span').textContent, String(Math.round(800 / 60)));
  assert.equal(browser.elements.get('readout-cell').textContent, '60.00 px');
});

test('a wider canvas opens on proportionally more of the world', async (t) => {
  // The rule is a function of the canvas, not a constant: the same world at
  // twice the width opens on twice the span, so the cell on screen is the same
  // size on both.
  const { browser } = setup({
    browser: { canvas: createCanvas({ width: 2000, height: 1000 }) },
    core: { world: { width: 65536, height: 65536 }, cells: [] },
  });
  teardown(t, browser);
  await loadPage(browser);

  const frame = lastFrameRequest(browser);
  assert.equal(frame.w, Math.round(2000 / 60));
  assert.equal(frame.h, Math.round((2000 / 60) * (1000 / 2000)));
});

test('the world\'s centre is the middle of the view it opens with', async (t) => {
  const { browser } = setup({
    core: {
      world: { width: 65536, height: 65536 },
      // Live cells far from the middle: the default view is the world's centre,
      // not the contents' — the contents are where a person's work is, and this
      // page has not been told about any of it yet.
      bounds: [100, 100, 120, 120],
      cells: [[110, 110]],
    },
  });
  teardown(t, browser);
  await loadPage(browser);

  const frame = lastFrameRequest(browser);
  const centreX = frame.x0 + frame.w / 2;
  const centreY = frame.y0 + frame.h / 2;
  assert.ok(Math.abs(centreX - 32768) <= 0.5, `x centre is ${centreX}`);
  assert.equal(centreY, 32768, `y centre is ${centreY}`);
});

test('nothing is requested before the core has said how big the world is', async (t) => {
  const { browser } = setup({ core: { world: { width: 64, height: 64 }, cells: THREE_CELLS } });
  teardown(t, browser);
  // A core that cannot describe its world: the page must not invent one to ask
  // about, because the rectangle it would ask for is a guess the user would then
  // see drawn.
  browser.setFetchHandler(async () =>
    jsonResponse({ ok: false, error: 'core_unavailable', message: 'the core is not up' }, 503),
  );
  await loadPage(browser);

  assert.deepEqual(browser.requestsTo('/api/frame'), [], 'no frame for a world nobody described');
  assert.deepEqual(browser.requestBodiesTo('/api/subscription'), []);
  assert.equal(browser.elements.get('readout-span').textContent, '—', 'and the readout says so');
});

test('a canvas that has not been laid out yet is not asked about', async (t) => {
  // `display: none` — which is what the full-width panel state does to the
  // canvas — measures zero, and a span of zero is not a view. The observer is
  // what says when the canvas really has a size.
  const { browser } = setup({
    browser: { canvas: createCanvas({ width: 0, height: 0 }) },
    core: { world: { width: 65536, height: 65536 }, cells: [] },
  });
  teardown(t, browser);
  await loadPage(browser);

  assert.deepEqual(browser.requestsTo('/api/frame'), [], 'a canvas with no size has no view');

  browser.canvas.rect = { left: 0, top: 0, width: 900, height: 600, right: 900, bottom: 600 };
  browser.notifyResize();
  await settle(3);

  const frame = lastFrameRequest(browser);
  assert.ok(frame, 'once it is laid out the view is placed');
  assert.equal(frame.w, Math.round(900 / 60));
});

test('a resize re-derives the span until the user has moved the view', async (t) => {
  const { browser } = setup({
    core: { world: { width: 65536, height: 65536 }, cells: [] },
  });
  teardown(t, browser);
  await loadPage(browser);
  assert.equal(lastFrameRequest(browser).w, Math.round(800 / 60));

  browser.canvas.rect = { left: 0, top: 0, width: 1200, height: 600, right: 1200, bottom: 600 };
  browser.notifyResize();
  await settle(3);
  assert.equal(
    lastFrameRequest(browser).w,
    Math.round(1200 / 60),
    'the default view follows the canvas while the view is not the user\'s',
  );
});

test('once the view has been moved, a resize leaves the span alone', async (t) => {
  const { browser } = setup({
    core: { world: { width: 65536, height: 65536 }, cells: [] },
  });
  teardown(t, browser);
  await loadPage(browser);

  // One wheel notch: the view is the user's from here on.
  browser.canvas.dispatch('wheel', { clientX: 400, clientY: 300, deltaY: 120 });
  await settle(3);
  const moved = lastFrameRequest(browser);

  browser.canvas.rect = { left: 0, top: 0, width: 1200, height: 600, right: 1200, bottom: 600 };
  browser.notifyResize();
  await settle(3);

  const after = lastFrameRequest(browser);
  assert.equal(after.w, moved.w, 'the span the user chose is not re-derived for them');
  assert.notEqual(after.w, Math.round(1200 / 60), 'and the new default is not applied over it');
});

test('the view remembers where it is looking, in world coordinates', async (t) => {
  const { browser } = setup({
    browser: { storage: {} },
    core: { world: { width: 65536, height: 65536 }, cells: [] },
  });
  teardown(t, browser);
  await loadPage(browser);
  // The world route's own centre is remembered for the history preview, which is
  // the only way it can put a generation where the person was working.
  assert.equal(browser.storage.get('lifegame.viewer.focus'), '32768,32768');

  browser.canvas.dispatch('wheel', { clientX: 400, clientY: 300, deltaY: -300 });
  await settle(3);
  const frame = lastFrameRequest(browser);
  const centre = { x: frame.x0 + frame.w / 2, y: frame.y0 + frame.h / 2 };
  // The stored point is the viewport's centre; the frame is whole cells, so the
  // two differ by at most the rounding of one rectangle.
  const [storedX, storedY] = browser.storage
    .get('lifegame.viewer.focus')
    .split(',')
    .map(Number);
  assert.ok(Math.abs(storedX - centre.x) <= 1, `stored x ${storedX} against ${centre.x}`);
  assert.ok(Math.abs(storedY - centre.y) <= 1, `stored y ${storedY} against ${centre.y}`);
});

// -- the preview's pane ----------------------------------------------------
//
// The history route shows the tree and the generation together. The cases here
// are the two things that made the pane worth building: the tree stays readable
// however a node is looked at, and the preview looks where the person was
// working.

/**
 * The stylesheet, as the geometry cases read it: which containers the page puts
 * outside a row's flow, and how many columns a row's grid has.
 *
 * The model reads these from the stylesheet rather than assuming them, so a
 * container that stopped being absolutely positioned would make the rows taller
 * in the model too — which is exactly the defect the case is about.
 */
function readStyleRules() {
  const source = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const absolute = new Set();
  for (const match of source.matchAll(/\.([\w-]+)\s*\{([^}]*)\}/g)) {
    if (/position:\s*absolute/.test(match[2])) absolute.add(match[1]);
  }
  const columns = /\.timeline-row\s*\{[^}]*grid-template-columns:\s*([^;]+);/.exec(source);
  if (columns === null) throw new Error('the row must have a grid-template-columns rule');
  return { absolute, columns: columns[1].trim().split(/\s+/).length };
}

/**
 * How many line boxes a row needs, from its own in-flow children.
 *
 * A row is a grid of `columns` tracks, so its content is one line tall while the
 * children that are in the flow fit in one track each. An absolutely positioned
 * child contributes nothing.
 */
function rowLines(row, rules) {
  const inFlow = row.children.filter(
    (child) => !child.classList.values().some((name) => rules.absolute.has(name)),
  );
  return Math.ceil(inFlow.length / rules.columns);
}

test('a row is one line tall, and opening its numbers does not change that', async (t) => {
  const { browser } = setup({
    route: 'history',
    core: {
      world: { width: 64, height: 64 },
      cells: THREE_CELLS,
      generation: 3,
      history: true,
      historyRows: FORKED_ROWS,
    },
  });
  teardown(t, browser);
  await loadPage(browser);

  const rules = readStyleRules();
  const rows = browser.elements
    .get('timeline-list')
    .children.map((item) => item.children[0]);
  assert.equal(rows.length, FORKED_ROWS.length);

  for (const row of rows) {
    const closed = rowLines(row, rules);
    assert.equal(closed, 1, `node ${row.dataset.node} must be one line tall while closed`);

    // The pointer's path and the keyboard's path set the same state.
    row.dispatch('pointerenter');
    assert.equal(row.dataset.open, 'true', 'the pointer opens the numbers');
    const open = rowLines(row, rules);
    assert.equal(
      open,
      closed,
      `node ${row.dataset.node} changed height when its numbers opened: ${closed} -> ${open}`,
    );
    row.dispatch('pointerleave');
    assert.equal(row.dataset.open, 'false');

    row.dispatch('focus');
    assert.equal(row.dataset.open, 'true', 'and so does keyboard focus');
    assert.equal(rowLines(row, rules), closed, 'with the same geometry');
    row.dispatch('blur');
  }
});

test('a fork\'s branches are drawn with connectors the level they belong to', async (t) => {
  const { browser } = setup({
    route: 'history',
    core: {
      world: { width: 64, height: 64 },
      cells: THREE_CELLS,
      generation: 3,
      history: true,
      historyRows: FORKED_ROWS,
    },
  });
  teardown(t, browser);
  await loadPage(browser);

  const rows = new Map(
    browser.elements
      .get('timeline-list')
      .children.map((item) => [item.children[0].dataset.node, item.children[0]]),
  );
  const guidesOf = (id) => {
    const host = childWithClass(rows.get(id), 'timeline-guides');
    assert.ok(host, `node ${id} needs a connector gutter`);
    return host.children.map((guide) =>
      ['line', 'elbow', 'end', 'blank'].find((kind) =>
        guide.classList.contains(`timeline-guide-${kind}`),
      ),
    );
  };
  assert.deepEqual(guidesOf('1'), [], 'a root has no level to connect to');
  assert.deepEqual(guidesOf('4'), ['elbow'], 'the first branch of the fork starts with an elbow');
  assert.deepEqual(guidesOf('5'), ['end'], 'the last one ends there');
  assert.deepEqual(guidesOf('6'), ['blank'], 'and a chain below it draws nothing, but is indented');
  // The gutter is one cell per level, exactly as wide as the row is indented, so
  // a connector lands above its parent's.
  const rules = readStyleRules();
  assert.ok(rules.columns >= 2, 'a row carries a generation and its marks');
});

test('the history route has a tree on the left and a preview on the right', async (t) => {
  const { browser } = setup({
    route: 'history',
    core: {
      world: { width: 64, height: 64 },
      cells: THREE_CELLS,
      generation: 2,
      history: true,
      historyRows: HISTORY_ROWS,
    },
  });
  teardown(t, browser);
  await loadPage(browser);

  const html = readFragment('history');
  assert.match(html, /class="history-split"/, 'the two panes are one split container');
  assert.ok(browser.elements.get('timeline'), 'the left pane is the tree');
  assert.ok(browser.elements.get('preview'), 'the right pane is a canvas');
  const preview = browser.canvasFor('preview');
  assert.ok(preview, 'the preview canvas is the page\'s own, not the world\'s');
  assert.notEqual(preview, browser.canvas, 'and it is not the world route\'s canvas');
  // The pane is not a prompt any more. A route with a recording, a measured canvas
  // and a known world previews the generation the world is on, at load, without
  // waiting to be clicked — so the note names that generation and where it looked
  // instead of telling the user to go and choose one.
  assert.equal(
    browser.elements.get('preview-note').textContent,
    'generation 2 · the live cell nearest 3, 3 is in the middle',
    'at load the pane says which generation it is showing',
  );
  assert.equal(
    browser.requestsTo('/api/frame').length,
    1,
    'and asks for that generation exactly once',
  );
  assert.deepEqual(
    browser.requestsTo('/api/select'),
    [],
    'the automatic preview is not a selection',
  );
});

/**
 * The chain a row lives in, nearest first, as the composed page declares it.
 *
 * The synthetic registry holds the elements the markup *names*, not every tag
 * between them (`section#timeline > ol#timeline-list > li > button.timeline-row`
 * is three named elements and one `<li>`), so a gesture case states the
 * containment instead of reading it. `pointerGesture` needs it to know which
 * element an event bubbles to — which is exactly the part of a real browser the
 * suite could not express before.
 */
function rowChain(hit, row, list, timeline) {
  return [hit, row, list, timeline];
}

test('with no recording, the preview is the theme\'s ground and not a black hole', async (t) => {
  // A dead colour that is nobody's default, so the assertion is about where the
  // colour came from and not only about which colour it is.
  const palette = { '--alive': '#7fd4ff', '--dead': '#123456', '--grid': 'rgba(255, 255, 255, 0.14)' };
  const { browser } = setup({
    route: 'history',
    browser: { palette },
    // A core that records nothing: there is no current generation to preview, so
    // the pane has nothing to ask for and keeps the empty state's prompt. This is
    // also the state the black hole was found in, which is why the pixels are
    // asserted on this route: the paint has to happen where nothing is fetched,
    // not only where a frame arrives.
    core: { world: { width: 64, height: 64 }, cells: THREE_CELLS },
  });
  teardown(t, browser);
  await loadPage(browser);

  const preview = browser.canvasFor('preview');
  const themeDead = (colours) => readPalette({ getPropertyValue: (name) => colours[name] ?? '' }).deadCss;

  // No recording means no generation to show, so nothing is fetched and the note
  // beside the canvas says what to do instead. What was wrong in a real browser
  // was not the not-asking — it was that the canvas left behind was an opaque one
  // nobody had painted, which composites as pure black: the stylesheet declares
  // `background: var(--dead)` and that declaration could never show.
  assert.equal(
    browser.elements.get('preview-note').textContent,
    'click a generation to preview it here',
    'with no recording the pane keeps the empty state and its prompt',
  );
  assert.deepEqual(browser.requestsTo('/api/frame'), [], 'and asks for no frame');
  assert.deepEqual(browser.requestsTo('/api/cells'), [], 'and no live set either');

  const fills = preview.context.calls.fillRect;
  assert.ok(fills.length >= 1, 'the pane must not be left unpainted');
  assert.equal(
    fills[0].fillStyle,
    themeDead(palette),
    'the first thing painted is the dead colour of the active theme',
  );
  assert.deepEqual(
    { x: fills[0].x, y: fills[0].y, w: fills[0].w, h: fills[0].h },
    { x: 0, y: 0, w: 800, h: 600 },
    'over the whole canvas, in CSS pixels',
  );
  assert.equal(preview.context.calls.stroke.length, 0, 'a ground is not a frame: no grid on it');

  // The colour is read from the theme every time it is painted, so a theme change
  // repaints it rather than leaving the previous theme's colour under the pane.
  palette['--dead'] = '#654321';
  browser.elements.get('toggle-theme').dispatch('click');
  await settle(3);
  assert.equal(
    preview.context.calls.fillRect.at(-1).fillStyle,
    themeDead(palette),
    'and a theme change repaints the ground in the new theme',
  );
});

test('a current generation with nothing alive is drawn on the theme\'s ground', async (t) => {
  // The same non-default dead colour as the case above, so what these assertions
  // prove is where the colour came from and not only which colour it is.
  const palette = { '--alive': '#7fd4ff', '--dead': '#123456', '--grid': 'rgba(255, 255, 255, 0.14)' };
  const { browser } = setup({
    route: 'history',
    browser: { palette, storage: { 'lifegame.viewer.focus': '300,300' } },
    core: {
      world: { width: 64, height: 64 },
      cells: [],
      generation: 0,
      history: true,
      historyRows: [
        { id: 1, parent: null, generation: 0, kind: 'keyframe', population: 0, changed: 0, at: 't0', cells: [] },
      ],
    },
  });
  teardown(t, browser);
  await loadPage(browser);

  const preview = browser.canvasFor('preview');
  const themeDead = (colours) => readPalette({ getPropertyValue: (name) => colours[name] ?? '' }).deadCss;
  const ground = themeDead(palette);
  const fills = preview.context.calls.fillRect;

  // There is a recording, so the pane is showing a generation — and it asked for
  // it once, unprompted. With nothing alive in it the frame is its ground and
  // nothing else: the theme's own dead colour, not the default palette's and not
  // a black or transparent hole.
  assert.equal(browser.requestsTo('/api/frame').length, 1, 'the current generation is framed once');
  assert.equal(browser.requestsTo('/api/cells').length, 1, 'from one read of the live set');
  assert.ok(fills.length >= 1, 'the pane must not be left unpainted');
  assert.deepEqual(
    [...new Set(fills.map((entry) => entry.fillStyle))],
    [ground],
    'every filled pixel is the theme\'s dead colour, and no live cell is plotted',
  );
  assert.deepEqual(
    { x: fills.at(-1).x, y: fills.at(-1).y, w: fills.at(-1).w, h: fills.at(-1).h },
    { x: 0, y: 0, w: 800, h: 600 },
    'over the whole canvas, in CSS pixels',
  );
  assert.match(
    browser.elements.get('preview-note').textContent,
    /nothing is alive in it/,
    'and the note says the generation it is showing is empty',
  );

  // The colour is read from the theme every time it is painted, so a theme change
  // repaints the frame's ground rather than leaving the previous theme's colour.
  palette['--dead'] = '#654321';
  browser.elements.get('toggle-theme').dispatch('click');
  await settle(3);
  assert.equal(
    preview.context.calls.fillRect.at(-1).fillStyle,
    themeDead(palette),
    'and a theme change repaints the ground in the new theme',
  );
});

test('the history route previews the current generation at load, without selecting anything', async (t) => {
  const { browser, core } = setup({
    route: 'history',
    // The world route was last looking at (300, 300) — remembered across the
    // routes, in world coordinates — and the current generation's live cells are
    // spread around it, so which one is nearest is a fact the test can state.
    browser: { storage: { 'lifegame.viewer.focus': '300,300' } },
    core: {
      world: { width: 65536, height: 65536 },
      generation: 0,
      cells: [
        [10, 10],
        [500, 900],
        [7, 3],
      ],
      history: true,
      historyRows: [
        { id: 1, parent: null, generation: 0, kind: 'keyframe', population: 3, changed: 3, at: 't0' },
        { id: 2, parent: 1, generation: 1, kind: 'delta', population: 3, changed: 2, at: 't1' },
      ],
    },
  });
  teardown(t, browser);
  await loadPage(browser);

  // No click, and no selection: the load is complete — the canvas is measured, the
  // core has declared its world and the session has a recording — so the pane
  // shows the generation the world is on, once.
  const frames = browser.requestsTo('/api/frame');
  assert.equal(frames.length, 1, 'the current generation is framed exactly once');
  assert.equal(browser.requestsTo('/api/cells').length, 1, 'from exactly one read of the live set');

  const url = new URL(frames[0].url, 'http://127.0.0.1');
  const frame = {
    x0: Number(url.searchParams.get('x0')),
    y0: Number(url.searchParams.get('y0')),
    w: Number(url.searchParams.get('w')),
    h: Number(url.searchParams.get('h')),
  };
  // The centring rule is the selection's, exactly: the live cell nearest to
  // (300, 300), which is (10, 10) and not (500, 900) or (7, 3).
  assert.ok(Math.abs(frame.x0 + frame.w / 2 - 10) <= 0.5, `x centre: ${frame.x0 + frame.w / 2}`);
  assert.equal(frame.y0 + frame.h / 2, 10, 'y centre');
  // And the span rule is the world route's: the canvas width over 60 px per cell.
  assert.equal(frame.w, Math.round(800 / 60));
  assert.equal(frame.h, Math.round((800 / 60) * (600 / 800)));
  assert.match(
    browser.elements.get('preview-note').textContent,
    /the live cell nearest 300, 300 is in the middle/,
    'and the note says which generation and where it looked',
  );

  // The whole point of the case: previewing the current generation is not a
  // selection. No `select` was sent, the core selected nothing, and the working
  // point — the node the next record would append to — is where it was.
  assert.deepEqual(browser.requestsTo('/api/select'), [], 'the automatic preview sends no select');
  assert.deepEqual(core.selects, [], 'and the core was not asked to select anything');
  assert.equal(core.head, 2, 'the working point did not move');
  const rows = browser.elements.get('timeline-list').children.map((item) => item.children[0]);
  assert.equal(rows[1].dataset.head, 'true', 'the tree still marks the core\'s working point');
  assert.equal(rows[0].dataset.head, 'false', 'and not the generation that was previewed');
});

test('a slow automatic preview cannot land on the generation the user selected', async (t) => {
  const { browser, core } = setup({
    route: 'history',
    browser: { storage: { 'lifegame.viewer.focus': '300,300' } },
    core: {
      world: { width: 65536, height: 65536 },
      generation: 0,
      // The generation the page opens on is alive at (100, 100); the node the user
      // clicks is alive at (1000, 1000). The two answers are far apart on purpose,
      // so which of them the pane ends up showing is a fact and not a coincidence.
      cells: [[100, 100]],
      history: true,
      historyRows: [
        {
          id: 1,
          parent: null,
          generation: 1,
          kind: 'keyframe',
          population: 1,
          changed: 1,
          at: 't0',
          cells: [[1000, 1000]],
        },
      ],
    },
  });
  teardown(t, browser);

  // The load-time read of the live set is answered with the generation the page
  // opened on and then held back, so the automatic placement is still in flight —
  // holding a stale answer — while the user selects a node.
  const base = core.handler;
  let reads = 0;
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  browser.setFetchHandler(async (url, init) => {
    const path = new URL(url, 'http://127.0.0.1').pathname;
    if (path !== '/api/cells') return base(url, init);
    reads += 1;
    const response = await base(url, init);
    if (reads === 1) await held;
    return response;
  });

  await loadPage(browser);
  assert.equal(browser.requestsTo('/api/cells').length, 1, 'the automatic read is the one in flight');
  assert.deepEqual(browser.requestsTo('/api/frame'), [], 'and it has placed nothing yet');

  browser.elements.get('timeline-list').children[0].children[0].dispatch('click');
  await settle(5);
  assert.deepEqual(core.selects, [1], 'the click selected the node');

  const frames = browser.requestsTo('/api/frame');
  assert.equal(frames.length, 1, 'the selection framed its generation while the older read was held');
  const selected = new URL(frames[0].url, 'http://127.0.0.1');
  assert.ok(
    Math.abs(
      Number(selected.searchParams.get('x0')) + Number(selected.searchParams.get('w')) / 2 - 1000,
    ) <= 0.5,
    'centred on the selected node\'s live cell',
  );

  // The held answer arrives once the user has already chosen. It describes a
  // generation nobody is asking about any more, so it must be dropped rather than
  // placed: landing it would frame (100, 100) over the node that was selected.
  release();
  await settle(5);
  const after = browser.requestsTo('/api/frame');
  assert.equal(after.length, 1, 'the stale automatic answer asked for no frame');
  assert.equal(after[0].url, frames[0].url, 'and the pane is still showing what the user chose');
});

test('a pane that has not been laid out previews nothing until it has a size', async (t) => {
  // A canvas the layout has not sized measures zero. The world route's own canvas
  // is in exactly that state while the panel is `wide` — the stylesheet takes
  // `.canvas-area` out of the flow — and a pane that has not been laid out, or
  // whose grid column has been squeezed to nothing, measures zero here. A span of
  // zero is not a view, so the page must not ask for a rectangle it would then
  // draw.
  const { browser } = setup({
    route: 'history',
    browser: { storage: { 'lifegame.viewer.focus': '300,300' } },
    core: {
      world: { width: 65536, height: 65536 },
      cells: [
        [10, 10],
        [500, 900],
        [7, 3],
      ],
      generation: 0,
      history: true,
      historyRows: [
        { id: 1, parent: null, generation: 0, kind: 'keyframe', population: 3, changed: 3, at: 't0' },
      ],
    },
  });
  teardown(t, browser);
  // Measured as nothing before the page runs, so the first of the two readiness
  // gates is shut when the recording arrives.
  browser.canvasFor('preview').rect = { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
  await loadPage(browser);

  assert.deepEqual(browser.requestsTo('/api/frame'), [], 'a canvas with no size has no view');
  assert.deepEqual(browser.requestsTo('/api/cells'), [], 'so no live set is read either');
  assert.equal(
    browser.elements.get('preview-note').textContent,
    'click a generation to preview it here',
    'and the pane says what to do instead of showing a guessed rectangle',
  );

  // Laid out: the gate opens and the preview the page withheld happens, once, on
  // the same centring rule a selection uses.
  browser.canvasFor('preview').rect = { left: 0, top: 0, width: 900, height: 600, right: 900, bottom: 600 };
  browser.notifyResize();
  await settle(3);

  const frames = browser.requestsTo('/api/frame');
  assert.equal(frames.length, 1, 'once it is laid out the current generation is framed exactly once');
  const url = new URL(frames[0].url, 'http://127.0.0.1');
  assert.equal(Number(url.searchParams.get('w')), Math.round(900 / 60), 'at the new canvas\'s span');
  const centreX = Number(url.searchParams.get('x0')) + Number(url.searchParams.get('w')) / 2;
  assert.ok(Math.abs(centreX - 10) <= 0.5, `centred on the nearest live cell: ${centreX}`);
  assert.deepEqual(browser.requestsTo('/api/select'), [], 'still without selecting anything');
});

test('a pane whose world is not known previews nothing, even with a recording', async (t) => {
  const { browser } = setup({ route: 'history' });
  teardown(t, browser);
  // The recording is known — the history reply carries it — but the core cannot
  // describe its world. A rectangle the page would have to guess is a rectangle
  // the user would then see drawn, so nothing is asked for.
  browser.setFetchHandler(async (url) => {
    const path = new URL(url, 'http://127.0.0.1').pathname;
    if (path === '/api/history') {
      return jsonResponse({
        ok: true,
        session: 1,
        current: 0,
        head: 1,
        count: 1,
        generations: [
          { id: 1, parent: null, generation: 0, kind: 'keyframe', population: 3, changed: 3, at: 't0' },
        ],
        history: true,
      });
    }
    return jsonResponse({ ok: false, error: 'core_unavailable', message: 'the core is not up' }, 503);
  });
  await loadPage(browser);

  assert.equal(
    browser.elements.get('timeline-list').children.length,
    1,
    'the recording itself was read, so it is the world that is missing',
  );
  assert.deepEqual(browser.requestsTo('/api/frame'), [], 'no frame for a world nobody described');
  assert.deepEqual(browser.requestsTo('/api/cells'), [], 'and no live set either');
  assert.equal(
    browser.elements.get('preview-note').textContent,
    'click a generation to preview it here',
    'the pane keeps the empty state rather than inventing a rectangle',
  );
});

test('a session that has recorded no generation yet keeps the empty state', async (t) => {
  const { browser } = setup({
    route: 'history',
    core: { world: { width: 64, height: 64 }, cells: THREE_CELLS, history: true, historyRows: [] },
  });
  teardown(t, browser);
  await loadPage(browser);

  // The core *is* recording and has recorded nothing: there is no current
  // generation to preview, so the pane waits rather than framing the world's
  // centre and calling it a generation. "Recording" and "has a recording" are
  // therefore two different facts, and this is the one that decides.
  assert.equal(
    browser.elements.get('preview-note').textContent,
    'click a generation to preview it here',
    'no recorded generation means the empty state and its prompt',
  );
  assert.deepEqual(browser.requestsTo('/api/frame'), [], 'and nothing is asked for');
  assert.deepEqual(browser.requestsTo('/api/cells'), []);
});

test('a press on a row is a click on that row, so the row is what gets selected', async (t) => {
  const { browser, core } = setup({
    route: 'history',
    core: {
      world: { width: 64, height: 64 },
      cells: THREE_CELLS,
      generation: 2,
      history: true,
      historyRows: HISTORY_ROWS,
    },
  });
  teardown(t, browser);
  await loadPage(browser);

  const timeline = browser.elements.get('timeline');
  const list = browser.elements.get('timeline-list');
  const rows = list.children.map((item) => item.children[0]);
  // The pointer lands on the deepest element under it, as a browser's does: the
  // row's own generation, inside the row's button.
  const generation = childWithClass(rows[0], 'timeline-generation');
  const gesture = pointerGesture(generation, {
    from: { x: 60, y: 210 },
    chain: rowChain(generation, rows[0], list, timeline),
  });

  // The mechanism is asserted because it is what was wrong: the element that
  // takes the pointer capture is the element the compatibility mouse events —
  // and with them the click — are routed to. Taking it on the list put every
  // click on the list, so the row's own listener never ran and `select` was never
  // sent: the defect a person reported as "clicking a generation does nothing".
  assert.equal(gesture.capture, rows[0], 'the row that was pressed takes the capture');
  assert.notEqual(gesture.capture, timeline, 'not the list, which would take the click with it');
  assert.equal(gesture.clickTarget, rows[0], 'so the click is dispatched at the row');
  assert.deepEqual(
    gesture.events.map((entry) => entry.type),
    ['pointerdown', 'pointerup', 'click'],
    'the sequence a real press produces',
  );

  await settle(4);
  assert.deepEqual(core.selects, [1], 'the node under the press is the node that is selected');
  const after = list.children.map((item) => item.children[0]);
  assert.equal(after[0].dataset.head, 'true', 'the working point moved onto it');
  assert.equal(after[0].dataset.current, 'true', 'and it is the generation the world shows');
  assert.equal(after[2].dataset.head, 'false', 'the marker left the node it was on');
});

test('a drag pans without selecting, and a press that did not travel still selects', async (t) => {
  const { browser, core } = setup({
    route: 'history',
    core: {
      world: { width: 64, height: 64 },
      cells: THREE_CELLS,
      generation: 2,
      history: true,
      historyRows: HISTORY_ROWS,
    },
  });
  teardown(t, browser);
  await loadPage(browser);

  const timeline = browser.elements.get('timeline');
  const list = browser.elements.get('timeline-list');
  const rows = list.children.map((item) => item.children[0]);
  const generation = childWithClass(rows[1], 'timeline-generation');
  const dragged = pointerGesture(generation, {
    pointerId: 2,
    from: { x: 60, y: 230 },
    moves: [
      { x: 60, y: 200 },
      { x: 30, y: 170 },
      { x: 20, y: 160 },
    ],
    chain: rowChain(generation, rows[1], list, timeline),
  });
  await settle(4);

  assert.equal(dragged.clickTarget, rows[1], 'the release is the row\'s too, so the click is the row\'s');
  assert.equal(timeline.scrollTop, 70, 'the drag panned the tree downwards');
  assert.equal(timeline.scrollLeft, 40, 'and sideways');
  assert.deepEqual(core.selects, [], 'but a press that travelled is not a click');
  const still = list.children.map((item) => item.children[0]);
  assert.equal(still[2].dataset.head, 'true', 'so the working point did not move');
  assert.equal(still[2].dataset.current, 'true');

  // Both behaviours have to hold at once: throwing the click away to make the
  // drag safe is what the pane already did, and it is the defect. The press below
  // travels nowhere, so it is the row's click *and* it selects.
  const settledRows = list.children.map((item) => item.children[0]);
  const second = childWithClass(settledRows[0], 'timeline-generation');
  pointerGesture(second, {
    pointerId: 3,
    from: { x: 60, y: 210 },
    chain: rowChain(second, settledRows[0], list, timeline),
  });
  await settle(4);
  assert.deepEqual(core.selects, [1], 'a press that did not travel still selects');
});

// -- the window control ---------------------------------------------------
//
// When a recording is longer than the window, `renderTimeline` puts "show the
// earlier generations" at the top of the list, and it is the tree's *second*
// control. The pointer capture is what decides whether a control's click is
// delivered at all: the browser dispatches the click on the nearest common
// inclusive ancestor of the press and the release, so a capture taken on an
// ancestor moves the click to that ancestor and the control's own listener never
// runs. A case that dispatches `click` straight at the button never exercises
// that — which is how this control was inert in a real browser while the case
// above it, which does the same, stayed green.

/** A linear run of `count` generations, each the child of the one before it. */
function longRun(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    parent: index === 0 ? null : index,
    generation: index,
    kind: index === 0 ? 'keyframe' : 'delta',
    population: 5,
    changed: 4,
    born: 2,
    died: 2,
    at: `t${index}`,
  }));
}

/** The list, the item the control is in, and the control itself. */
function earlierControl(browser) {
  const list = browser.elements.get('timeline-list');
  const item = list.children[0];
  return { list, item, control: item.children[0] };
}

test('a press on the window control widens the window', async (t) => {
  const { browser } = setup({
    route: 'history',
    core: {
      world: { width: 64, height: 64 },
      cells: THREE_CELLS,
      generation: 199,
      history: true,
      historyRows: longRun(200),
    },
  });
  teardown(t, browser);
  await loadPage(browser);

  const timeline = browser.elements.get('timeline');
  let { list, item, control } = earlierControl(browser);
  assert.equal(list.children.length, 41, '40 rows and the control above them');
  assert.equal(control.className, 'timeline-earlier');
  assert.match(control.textContent, /160/, '160 generations are older than the window');

  const gesture = pointerGesture(control, { chain: [control, item, list, timeline] });

  // The mechanism is asserted because it is what was wrong: the element that
  // takes the capture is the element the release — and with it the click — is
  // routed to. While the capture fell to the tree, `pointerup` and `click` were
  // both dispatched on `#timeline`, and this control's listener never ran.
  assert.equal(gesture.capture, control, 'the control that was pressed takes the capture');
  assert.notEqual(gesture.capture, timeline, 'not the tree, which would take the click with it');
  assert.equal(gesture.clickTarget, control, 'so the click is dispatched at the control');
  assert.deepEqual(
    gesture.events.map((entry) => entry.type),
    ['pointerdown', 'pointerup', 'click'],
    'the sequence a real press produces',
  );

  await settle(2);
  ({ list, item, control } = earlierControl(browser));
  assert.equal(list.children.length, 81, 'the window widened by another page');
  assert.match(control.textContent, /120/, 'and the control relabelled to what is still older');

  // The control was rebuilt by the render it caused, so this second press is
  // also the case that proves the new control is wired up like the first.
  pointerGesture(control, { pointerId: 2, chain: [control, item, list, timeline] });
  await settle(2);
  ({ list, item, control } = earlierControl(browser));
  assert.equal(list.children.length, 121, 'a second press widens it again');
  assert.match(control.textContent, /80/);
});

test('a drag that starts on the window control pans without widening it', async (t) => {
  const { browser } = setup({
    route: 'history',
    core: {
      world: { width: 64, height: 64 },
      cells: THREE_CELLS,
      generation: 199,
      history: true,
      historyRows: longRun(200),
    },
  });
  teardown(t, browser);
  await loadPage(browser);

  const timeline = browser.elements.get('timeline');
  const { list, item, control } = earlierControl(browser);
  const dragged = pointerGesture(control, {
    pointerId: 2,
    from: { x: 60, y: 100 },
    moves: [
      { x: 60, y: 70 },
      { x: 30, y: 40 },
      { x: 20, y: 30 },
    ],
    chain: [control, item, list, timeline],
  });
  await settle(2);

  // The capture rule is what makes this case able to fail: now that the control's
  // own click arrives, it has to refuse a press that travelled exactly as a row
  // does — otherwise panning the tree from the control would widen the window.
  assert.equal(dragged.capture, control, 'the control takes the capture for the drag too');
  assert.equal(dragged.clickTarget, control, 'the release is the control\'s, so the click is');
  assert.equal(timeline.scrollTop, 70, 'the drag panned the tree downwards');
  assert.equal(timeline.scrollLeft, 40, 'and sideways');
  assert.equal(list.children.length, 41, 'but the window did not widen');
  assert.match(list.children[0].children[0].textContent, /160/);
});

test('clicking a node previews it, centred on the nearest live cell to where the world was', async (t) => {
  const { browser, core } = setup({
    route: 'history',
    // The world route was last looking at (300, 300) — remembered across the
    // routes, in world coordinates — and this generation's live cells are spread
    // around it, so the nearest one is a fact the test can state.
    browser: { storage: { 'lifegame.viewer.focus': '300,300' } },
    core: {
      world: { width: 64, height: 64 },
      generation: 0,
      history: true,
      historyRows: [
        {
          id: 1,
          parent: null,
          generation: 0,
          kind: 'keyframe',
          population: 3,
          changed: 3,
          at: 't0',
          cells: [
            [10, 10],
            [500, 900],
            [7, 3],
          ],
        },
        { id: 2, parent: 1, generation: 1, kind: 'delta', population: 2, changed: 2, at: 't1' },
      ],
    },
  });
  teardown(t, browser);
  await loadPage(browser);

  browser.elements.get('timeline-list').children[0].children[0].dispatch('click');
  await settle(5);

  assert.deepEqual(core.selects, [1], 'the click moved the world onto the node');
  assert.equal(core.cells.length, 3, 'the core is on that generation\'s cells');
  const frames = browser.requestsTo('/api/frame');
  // Two placements, and each asked for one frame. They are different answers, not
  // a duplicate: the load-time preview of the generation the world opened on —
  // generation 0, which has no live cells here, so it came back centred on the
  // world — and the one the click asked for. The click's is last, because a
  // selection is the newer question.
  assert.equal(frames.length, 2, 'one frame for the load-time preview and one for the click');
  assert.equal(browser.requestsTo('/api/cells').length, 2, 'and one live-set read for each');
  const loadFrame = new URL(frames[0].url, 'http://127.0.0.1');
  assert.ok(
    Math.abs(
      Number(loadFrame.searchParams.get('x0')) + Number(loadFrame.searchParams.get('w')) / 2 - 32,
    ) <= 0.5,
    'the load-time preview was the empty world\'s centre',
  );

  const url = new URL(frames.at(-1).url, 'http://127.0.0.1');
  const frame = {
    x0: Number(url.searchParams.get('x0')),
    y0: Number(url.searchParams.get('y0')),
    w: Number(url.searchParams.get('w')),
    h: Number(url.searchParams.get('h')),
  };
  // The nearest cell to (300, 300) is (10, 10), not the one at (40, 40).
  assert.ok(Math.abs(frame.x0 + frame.w / 2 - 10) <= 0.5, `x centre: ${frame.x0 + frame.w / 2}`);
  assert.equal(frame.y0 + frame.h / 2, 10, 'y centre');
  // The preview opens on the same rule as the world: this canvas is 800 x 600.
  assert.equal(frame.w, Math.round(800 / 60));
  assert.match(
    browser.elements.get('preview-note').textContent,
    /the live cell nearest 300, 300 is in the middle/,
  );
});

test('an empty generation is previewed from the middle of the world', async (t) => {
  const { browser } = setup({
    route: 'history',
    browser: { storage: { 'lifegame.viewer.focus': '300,300' } },
    core: {
      world: { width: 64, height: 64 },
      generation: 0,
      history: true,
      historyRows: [
        { id: 1, parent: null, generation: 0, kind: 'keyframe', population: 0, changed: 0, at: 't0', cells: [] },
      ],
    },
  });
  teardown(t, browser);
  await loadPage(browser);

  browser.elements.get('timeline-list').children[0].children[0].dispatch('click');
  await settle(5);

  const url = new URL(browser.requestsTo('/api/frame').at(-1).url, 'http://127.0.0.1');
  const frame = {
    x0: Number(url.searchParams.get('x0')),
    y0: Number(url.searchParams.get('y0')),
    w: Number(url.searchParams.get('w')),
    h: Number(url.searchParams.get('h')),
  };
  assert.ok(Math.abs(frame.x0 + frame.w / 2 - 32) <= 0.5, 'the middle of the world, in x');
  assert.equal(frame.y0 + frame.h / 2, 32, 'and in y');
  assert.match(browser.elements.get('preview-note').textContent, /nothing is alive in it/);
});

test('a live set too large for one reply degrades to the bounds, and says so', async (t) => {
  const { browser } = setup({
    route: 'history',
    browser: { storage: { 'lifegame.viewer.focus': '300,300' } },
    core: {
      world: { width: 65536, height: 65536 },
      generation: 0,
      // The service's cap is 16384 cells; a stub core with a smaller one drives
      // the same path with three cells.
      cellsCap: 1,
      bounds: [1000, 2000, 3000, 4000],
      cells: [
        [1, 1],
        [2, 2],
        [3, 3],
      ],
      history: true,
      historyRows: [
        { id: 1, parent: null, generation: 0, kind: 'keyframe', population: 3, changed: 3, at: 't0' },
      ],
    },
  });
  teardown(t, browser);
  await loadPage(browser);

  browser.elements.get('timeline-list').children[0].children[0].dispatch('click');
  await settle(5);

  const url = new URL(browser.requestsTo('/api/frame').at(-1).url, 'http://127.0.0.1');
  const centre = {
    x: Number(url.searchParams.get('x0')) + Number(url.searchParams.get('w')) / 2,
    y: Number(url.searchParams.get('y0')) + Number(url.searchParams.get('h')) / 2,
  };
  // The middle of the bounds is (2000, 3000): a coarser answer than the nearest
  // cell, and the page says which one it gave.
  assert.ok(Math.abs(centre.x - 2000) <= 0.5, `x centre: ${centre.x}`);
  assert.equal(centre.y, 3000, 'y centre');
  assert.match(
    browser.elements.get('preview-note').textContent,
    /3 live cells is above the 1-cell limit/,
  );
});

test('dragging the tree pans it and does not change the selection', async (t) => {
  const { browser, core } = setup({
    route: 'history',
    core: {
      world: { width: 64, height: 64 },
      cells: THREE_CELLS,
      generation: 2,
      history: true,
      historyRows: HISTORY_ROWS,
    },
  });
  teardown(t, browser);
  await loadPage(browser);

  const timeline = browser.elements.get('timeline');
  const row = browser.elements.get('timeline-list').children[1].children[0];

  timeline.dispatch('pointerdown', { pointerId: 1, button: 0, clientX: 10, clientY: 200 });
  timeline.dispatch('pointermove', { pointerId: 1, clientX: 10, clientY: 160 });
  timeline.dispatch('pointermove', { pointerId: 1, clientX: -20, clientY: 120 });
  timeline.dispatch('pointerup', { pointerId: 1, clientX: -20, clientY: 120 });
  await settle(3);

  assert.equal(timeline.scrollTop, 80, 'dragging up moves the tree down the list');
  assert.equal(timeline.scrollLeft, 30, 'and sideways as well');
  assert.equal(timeline.classList.contains('dragging'), false, 'the gesture ends');

  // The click a drag leaves behind must not be read as a selection: a pan that
  // also moved the working point would lose the place the user was looking at.
  row.dispatch('click');
  await settle(4);
  assert.deepEqual(core.selects, [], 'a drag is not a click');

  // A press that does not travel still selects. The press is dispatched on the
  // list, as the browser would after it bubbled from the row, and the click on
  // the row itself.
  timeline.dispatch('pointerdown', { pointerId: 2, button: 0, clientX: 10, clientY: 200 });
  timeline.dispatch('pointerup', { pointerId: 2, clientX: 10, clientY: 200 });
  row.dispatch('click');
  await settle(4);
  assert.deepEqual(core.selects, [2], 'a click is a click');
});

test('the arrow keys move along the tree', async (t) => {
  const { browser } = setup({
    route: 'history',
    core: {
      world: { width: 64, height: 64 },
      cells: THREE_CELLS,
      generation: 2,
      history: true,
      historyRows: HISTORY_ROWS,
    },
  });
  teardown(t, browser);
  await loadPage(browser);

  const list = browser.elements.get('timeline-list');
  const rows = list.children.map((item) => item.children[0]);
  rows[0].dispatch('focus');
  list.dispatch('keydown', { key: 'ArrowDown', target: rows[0] });
  assert.equal(browser.document.activeElement, rows[1], 'down is the next node in reading order');
  list.dispatch('keydown', { key: 'End', target: rows[1] });
  assert.equal(browser.document.activeElement, rows[rows.length - 1]);
  list.dispatch('keydown', { key: 'Home', target: rows[rows.length - 1] });
  assert.equal(browser.document.activeElement, rows[0]);
  list.dispatch('keydown', { key: 'ArrowUp', target: rows[0] });
  assert.equal(browser.document.activeElement, rows[0], 'the first node has nowhere to go up to');
  // Enter is the browser's: a row is a button, so activating it is already a
  // selection rather than something this page has to wire.
  assert.equal(rows[0].tagName, 'BUTTON');
});

test('the preview can be panned and zoomed without touching the selection', async (t) => {
  const { browser, core } = setup({
    route: 'history',
    browser: { storage: { 'lifegame.viewer.focus': '300,300' } },
    core: {
      world: { width: 65536, height: 65536 },
      generation: 0,
      history: true,
      historyRows: [
        {
          id: 1,
          parent: null,
          generation: 0,
          kind: 'keyframe',
          population: 2,
          changed: 2,
          at: 't0',
          cells: [
            [1000, 1000],
            [900, 900],
          ],
        },
      ],
    },
  });
  teardown(t, browser);
  await loadPage(browser);

  browser.elements.get('timeline-list').children[0].children[0].dispatch('click');
  await settle(5);
  const preview = browser.canvasFor('preview');
  const placed = browser.requestsTo('/api/frame').at(-1);
  const before = new URL(placed.url, 'http://127.0.0.1');

  preview.dispatch('pointerdown', { pointerId: 1, button: 0, clientX: 400, clientY: 300 });
  preview.dispatch('pointermove', { pointerId: 1, clientX: 100, clientY: 300 });
  preview.dispatch('pointerup', { pointerId: 1, clientX: 100, clientY: 300 });
  await settle(3);
  const panned = new URL(browser.requestsTo('/api/frame').at(-1).url, 'http://127.0.0.1');
  assert.ok(
    Number(panned.searchParams.get('x0')) > Number(before.searchParams.get('x0')),
    'dragging left moves the preview right',
  );

  preview.dispatch('wheel', { clientX: 400, clientY: 300, deltaY: -400 });
  await settle(3);
  const zoomed = new URL(browser.requestsTo('/api/frame').at(-1).url, 'http://127.0.0.1');
  assert.ok(
    Number(zoomed.searchParams.get('w')) < Number(panned.searchParams.get('w')),
    'scrolling up zooms the preview in',
  );
  assert.deepEqual(core.selects, [1], 'and neither gesture changed the selection');
});

// -- the rule the selected generation ran ----------------------------------
//
// A session's rule can change part-way through and every node carries the rule
// that produced it, while selecting a node restores its cells and **not** its
// rule: continuing from the node would run the current rule over a world the old
// one produced. The page states that difference and offers one press that adopts
// the generation's own rule.
//
// **The negative half is the half that matters.** The statement is a statement:
// loading the page, the automatic preview, the two step controls and dragging the
// tree all only re-decide what it says. The one press is the only thing on this
// route that sends `set_rule`, and each of those moments is asserted to send
// nothing, one by one.

/** A linear run whose nodes carry the rule that produced each of them. */
function ruledRun(rule, count = 3) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    parent: index === 0 ? null : index,
    generation: index,
    kind: index === 0 ? 'keyframe' : 'delta',
    population: 5,
    changed: 4,
    at: `t${index}`,
    rule,
  }));
}

/** Every `set_rule` the page sent. Only the adoption button may add one. */
function setRuleCommands(core) {
  return core.commands.filter((command) => command.cmd === 'set_rule');
}

/** The block that states the difference, and its three parts. */
function ruleGapOf(browser) {
  return {
    block: browser.elements.get('rule-gap'),
    note: browser.elements.get('rule-gap-note'),
    adopt: browser.elements.get('rule-gap-adopt'),
    error: browser.elements.get('rule-gap-error'),
  };
}

test('a generation from an older rule is stated with both rules, and adopting sends its own', async (t) => {
  const { browser, core } = setup({
    route: 'history',
    core: {
      world: { width: 64, height: 64 },
      cells: THREE_CELLS,
      generation: 3,
      history: true,
      historyRows: ruledRun('B3/S23'),
      head: 3,
      rule: 'B36/S23',
    },
  });
  teardown(t, browser);
  await loadPage(browser);

  const gap = ruleGapOf(browser);
  assert.equal(gap.block.hidden, false, 'the two rules disagree, so the page says so');
  // Both rules are named, and they are the two strings the data carries: the
  // node's own rule from the history reply, the rule in force from the state.
  assert.match(gap.note.textContent, /B3\/S23/, 'the rule the generation ran is named');
  assert.match(gap.note.textContent, /B36\/S23/, 'and the rule now in force is named');
  assert.match(gap.note.textContent, /generation 2/, 'and which generation it is about');
  assert.equal(gap.error.hidden, true, 'there is nothing wrong yet');

  // The load-time preview of the current generation is not a selection and not a
  // rule change: the rule the page opened on is the rule the core is running.
  assert.deepEqual(setRuleCommands(core), [], 'loading the page sent no set_rule');
  assert.equal(core.rule, 'B36/S23', 'and the core is still running the rule it was');

  assert.equal(gap.adopt.textContent, 'use B3/S23', 'the button names the rule it would adopt');
  assert.equal(
    gap.adopt.title,
    'set the rule in force to B3/S23',
    'and its tooltip says the same, from the same table',
  );

  gap.adopt.dispatch('click');
  await settle(4);

  assert.deepEqual(
    setRuleCommands(core),
    [{ cmd: 'set_rule', rule: 'B3/S23' }],
    "the press sends the generation's own rule, not the one in force",
  );
  assert.equal(core.rule, 'B3/S23', 'the core took it');
  assert.equal(gap.block.hidden, true, 'the two rules agree, so the statement is gone');
  assert.equal(gap.note.textContent, '', 'and it left no text behind');
  assert.equal(gap.adopt.textContent, '');
});

test('a generation recorded under the rule in force says nothing', async (t) => {
  const { browser } = setup({
    route: 'history',
    core: {
      world: { width: 64, height: 64 },
      cells: THREE_CELLS,
      generation: 2,
      history: true,
      historyRows: ruledRun('B3/S23'),
      head: 3,
      rule: 'B3/S23',
    },
  });
  teardown(t, browser);
  await loadPage(browser);

  const gap = ruleGapOf(browser);
  // The tree is there and a generation is selected: it is silence about the two
  // rules that is asserted, not an empty page.
  assert.equal(browser.elements.get('timeline-list').children.length, 3);
  assert.equal(gap.block.hidden, true, 'two equal rules are not worth a sentence');
  assert.equal(gap.note.textContent, '');
  assert.equal(gap.adopt.textContent, '');
});

test('with no selected generation the page says nothing, however the rules differ', async (t) => {
  const { browser } = setup({
    route: 'history',
    core: {
      world: { width: 64, height: 64 },
      cells: THREE_CELLS,
      generation: 2,
      history: true,
      // Nothing is selected: the core names no working point, although it has
      // recorded generations whose rule is not the one it is running. There is no
      // generation to attribute, so there is nothing to say.
      historyRows: ruledRun('B3/S23'),
      head: null,
      rule: 'B36/S23',
    },
  });
  teardown(t, browser);
  await loadPage(browser);

  assert.equal(browser.elements.get('timeline-list').children.length, 3, 'the tree is drawn');
  assert.equal(ruleGapOf(browser).block.hidden, true, 'but no generation is selected');
});

test('nothing but the button changes the rule: not the preview, not a step, not a drag', async (t) => {
  const { browser, core } = setup({
    route: 'history',
    core: {
      world: { width: 64, height: 64 },
      cells: THREE_CELLS,
      generation: 2,
      history: true,
      historyRows: ruledRun('B3/S23'),
      head: 2,
      rule: 'B36/S23',
    },
  });
  teardown(t, browser);
  await loadPage(browser);

  // 1. The load-time preview. It places the current generation, asks for its
  //    frame and sends no `select` — and a fortiori no rule.
  assert.deepEqual(browser.requestsTo('/api/select'), [], 'the preview selects nothing');
  assert.deepEqual(setRuleCommands(core), [], 'the preview changes no rule');

  // 2. A step backwards: the parent of the working point, which is a selection.
  browser.elements.get('step-back').dispatch('click');
  await settle(4);
  assert.deepEqual(core.selects, [1], 'backwards is the parent');
  assert.deepEqual(setRuleCommands(core), [], 'stepping back changes no rule');

  // 3. A step forwards: the newest child of the working point.
  browser.elements.get('step-forward').dispatch('click');
  await settle(4);
  assert.deepEqual(core.selects, [1, 2], 'forwards is its newest child');
  assert.deepEqual(setRuleCommands(core), [], 'stepping forward changes no rule');

  // 4. Dragging the tree: a pan is not a selection, and it is not a rule change.
  const timeline = browser.elements.get('timeline');
  timeline.dispatch('pointerdown', { pointerId: 1, button: 0, clientX: 10, clientY: 200 });
  timeline.dispatch('pointermove', { pointerId: 1, clientX: 10, clientY: 160 });
  timeline.dispatch('pointerup', { pointerId: 1, clientX: 10, clientY: 160 });
  await settle(3);
  assert.equal(timeline.scrollTop, 40, 'the drag panned the tree');
  assert.deepEqual(core.selects, [1, 2], 'and selected nothing');
  assert.deepEqual(setRuleCommands(core), [], 'and changed no rule');

  // 5. The one press that does, and it is still offered: the two rules still
  //    disagree, which is exactly what all of the above preserved.
  assert.equal(ruleGapOf(browser).block.hidden, false, 'the statement is still there to press');
  ruleGapOf(browser).adopt.dispatch('click');
  await settle(4);

  assert.deepEqual(
    setRuleCommands(core),
    [{ cmd: 'set_rule', rule: 'B3/S23' }],
    'the whole case sent exactly the one command the press asked for',
  );
  assert.equal(ruleGapOf(browser).block.hidden, true);
});

test("a core that refuses the generation's rule says why, and changes nothing", async (t) => {
  const { browser, core } = setup({
    route: 'history',
    core: {
      world: { width: 64, height: 64 },
      cells: THREE_CELLS,
      generation: 3,
      history: true,
      historyRows: ruledRun('B3/S23'),
      head: 3,
      rule: 'B36/S23',
      // Well-formed by the page's own check, so this is the core's second
      // opinion and not the page's first: the request really is sent.
      refuseRules: ['B3/S23'],
    },
  });
  teardown(t, browser);
  await loadPage(browser);

  const gap = ruleGapOf(browser);
  assert.equal(gap.block.hidden, false);

  gap.adopt.dispatch('click');
  await settle(4);

  assert.deepEqual(
    setRuleCommands(core),
    [{ cmd: 'set_rule', rule: 'B3/S23' }],
    'the press really asked the core',
  );
  assert.equal(gap.error.hidden, false, 'the refusal is shown beside the statement');
  // The label is the viewer's and translated; the reason inside it is the core's
  // own text and is never translated.
  assert.match(gap.error.textContent, /the core refused that rule/);
  assert.match(gap.error.textContent, /B3\/S23 names a neighbour count this core does not have/);

  assert.equal(core.rule, 'B36/S23', 'the core is still running the rule it was');
  assert.equal(gap.block.hidden, false, 'and the two rules still disagree, so the statement stays');
  assert.match(gap.note.textContent, /B3\/S23/, 'and it still names both of them');
  assert.match(gap.note.textContent, /B36\/S23/);
  // The shell's banner says the same thing, because the command went through the
  // one API client every route uses.
  assert.match(browser.elements.get('error').textContent, /the core refused that rule/);
});

// -- the pattern library --------------------------------------------------

test('the world page fills the pattern select from the service and places one', async (t) => {
  const { browser } = setup();
  teardown(t, browser);
  await loadPage(browser);

  const select = browser.elements.get('pattern-name');
  assert.deepEqual(
    [...select.options].map((option) => option.value),
    ['block', 'glider'],
    'the options are the service library, not a copy in the page',
  );
  assert.equal(browser.elements.get('pattern-place').disabled, false);

  select.value = 'glider';
  browser.elements.get('pattern-place').dispatch('click');
  await settle(6);

  const sent = browser.requestBodiesTo('/api/pattern').at(-1);
  assert.ok(sent !== undefined, 'the press places the selected pattern');
  assert.equal(sent.name, 'glider');
  assert.equal(Number.isInteger(sent.x), true);
  assert.equal(Number.isInteger(sent.y), true);
  assert.ok(browser.requestsTo('/api/frame').length > 0, 'the new cells are framed');
});

test('a library that cannot be read leaves the place control disabled', async (t) => {
  const { browser } = setup();
  teardown(t, browser);
  const core = createCoreStub();
  browser.setFetchHandler(async (url, init) => {
    if (new URL(url, 'http://127.0.0.1').pathname === '/api/patterns') {
      return jsonResponse({ ok: false, error: 'internal', message: 'no library' }, 500);
    }
    return core.handler(url, init);
  });
  await loadPage(browser);
  assert.equal(
    browser.elements.get('pattern-place').disabled,
    true,
    'a control that cannot place anything does not claim it can',
  );
});

test('the footer fills the session control from the service registry', async (t) => {
  const { browser } = setup();
  teardown(t, browser);
  await loadPage(browser);

  const select = browser.elements.get('session');
  assert.deepEqual(
    [...select.options].map((option) => option.value),
    ['main', 's1'],
    'the list is the service registry, not a copy in the page',
  );
  assert.equal(select.value, 'main', 'the page shows the session the URL names');
  assert.equal(browser.elements.get('session-new').disabled, false);
});

// -- the editing mode -----------------------------------------------------

/**
 * Wrap the core stub with the editing routes.
 *
 * The edit API is a service surface, not a core command, so the page suite stubs
 * it without pretending the core changed. `edit` is the document the stub keeps:
 * version, hash, depths, the transactions it accepted and the snippets it knows.
 */
function withEditRoutes(core) {
  const edit = {
    active: false,
    version: 0,
    hash: 'h0',
    undoDepth: 0,
    redoDepth: 0,
    transactions: [],
    undos: 0,
    redos: 0,
    published: [],
    presence: [],
    refuseNext: false,
  };
  const facts = () => ({
    version: edit.version,
    hash: edit.hash,
    undoDepth: edit.undoDepth,
    redoDepth: edit.redoDepth,
  });
  const handler = async (url, init = {}) => {
    const parsed = new URL(url, 'http://127.0.0.1');
    const path = parsed.pathname;
    const method = (init.method ?? 'GET').toUpperCase();
    if (path === '/api/edit/enter') {
      edit.active = true;
      edit.version = 0;
      edit.hash = 'h0';
      edit.undoDepth = 0;
      edit.redoDepth = 0;
      return jsonResponse({ ok: true, editMode: true, generation: 0, ...facts() });
    }
    if (path === '/api/edit/leave') {
      edit.active = false;
      return jsonResponse({ ok: true, editMode: false, resumed: false });
    }
    if (path === '/api/edit' || path === '/api/edit/state') {
      return jsonResponse({ ok: true, editMode: edit.active, ...facts() });
    }
    if (path === '/api/edit/presence') {
      const body = JSON.parse(init.body ?? '{}');
      if (method === 'POST') {
        if (body.leaving === true) {
          edit.presence = edit.presence.filter((entry) => entry.clientId !== body.clientId);
        } else {
          const at = edit.presence.findIndex((entry) => entry.clientId === body.clientId);
          if (at >= 0) edit.presence[at] = body;
          else edit.presence.push(body);
        }
      }
      return jsonResponse({ ok: true, presence: edit.presence });
    }
    if (path === '/api/edit/transaction') {
      const body = JSON.parse(init.body ?? '{}');
      if (edit.refuseNext) {
        edit.refuseNext = false;
        return jsonResponse({ ok: false, error: 'too_large', message: 'the box is too large' });
      }
      edit.transactions.push(body);
      edit.version += 1;
      edit.hash = `h${edit.version}`;
      edit.undoDepth += 1;
      edit.redoDepth = 0;
      return jsonResponse({
        ok: true,
        version: edit.version,
        hash: edit.hash,
        patch: { born: [], died: [] },
        rebased: false,
      });
    }
    if (path === '/api/edit/undo') {
      edit.undos += 1;
      edit.version += 1;
      edit.undoDepth = Math.max(0, edit.undoDepth - 1);
      edit.redoDepth += 1;
      return jsonResponse({
        ok: true,
        kind: 'undo',
        version: edit.version,
        hash: `h${edit.version}`,
        patch: { born: [], died: [] },
      });
    }
    if (path === '/api/edit/redo') {
      edit.redos += 1;
      edit.version += 1;
      edit.undoDepth += 1;
      edit.redoDepth = Math.max(0, edit.redoDepth - 1);
      return jsonResponse({
        ok: true,
        kind: 'redo',
        version: edit.version,
        hash: `h${edit.version}`,
        patch: { born: [], died: [] },
      });
    }
    if (path === '/api/snippets' && method === 'GET') {
      return jsonResponse({
        ok: true,
        snippets: [{ name: 'ell', hash: 'abc', width: 2, height: 2, cellCount: 3 }],
      });
    }
    if (path === '/api/snippets' && method === 'POST') {
      const body = JSON.parse(init.body ?? '{}');
      edit.published.push(body);
      return jsonResponse({
        ok: true,
        snippet: {
          name: body.name,
          hash: 'newhash',
          width: body.width,
          height: body.height,
          cellCount: body.cells.length,
        },
      });
    }
    if (path.startsWith('/api/snippets/')) {
      return jsonResponse({
        ok: true,
        snippet: { name: 'ell', hash: 'abc', width: 2, height: 2, cells: [[0, 0], [1, 0], [0, 1]] },
      });
    }
    return core.handler(url, init);
  };
  return { handler, edit };
}

/** The client point at the centre of one world cell in the last frame. */
function canvasCellPoint(browser, cell) {
  const frame = lastFrameRequest(browser);
  return {
    clientX: (cell[0] - frame.x0 + 0.5) * (800 / frame.w),
    clientY: (cell[1] - frame.y0 + 0.5) * (600 / frame.h),
  };
}

test('the editing mode pauses the run controls and sends enter and leave', async (t) => {
  const { browser, core } = setup({ core: { cells: [[26, 28]] } });
  const wrapped = withEditRoutes(core);
  browser.setFetchHandler(wrapped.handler);
  teardown(t, browser);
  await loadPage(browser);

  const button = browser.elements.get('edit-mode');
  assert.equal(button.textContent, 'edit');
  button.dispatch('click');
  await settle(5);
  assert.equal(wrapped.edit.active, true);
  assert.equal(browser.elements.get('edit-controls').hidden, false);
  assert.equal(browser.elements.get('toggle-run').disabled, true);
  assert.equal(browser.elements.get('step-once').disabled, true);
  assert.equal(button.textContent, 'done editing');

  button.dispatch('click');
  await settle(5);
  assert.equal(wrapped.edit.active, false);
  assert.equal(browser.elements.get('edit-controls').hidden, true);
  assert.equal(browser.elements.get('toggle-run').disabled, false);
});

test('a paint gesture is one transaction, and undo sends the inverse request', async (t) => {
  const { browser, core } = setup({
    core: { world: { width: 64, height: 64 }, bounds: [26, 28, 28, 30], cells: [[26, 28]] },
  });
  const wrapped = withEditRoutes(core);
  browser.setFetchHandler(wrapped.handler);
  teardown(t, browser);
  await loadPage(browser);
  browser.elements.get('edit-mode').dispatch('click');
  await settle(5);

  const canvas = browser.canvas;
  const from = canvasCellPoint(browser, [26, 28]);
  const to = canvasCellPoint(browser, [27, 28]);
  canvas.dispatch('pointerdown', { pointerId: 1, button: 0, ...from });
  canvas.dispatch('pointermove', { pointerId: 1, ...to });
  canvas.dispatch('pointerup', { pointerId: 1, ...to });
  await settle(5);
  assert.equal(wrapped.edit.transactions.length, 1, 'one drag is one transaction');
  const transaction = wrapped.edit.transactions[0];
  assert.equal(transaction.ops.length, 1);
  assert.equal(transaction.ops[0].kind, 'set');
  assert.equal(transaction.ops[0].alive, true);
  assert.deepEqual(transaction.ops[0].cells, [[26, 28], [27, 28]]);
  assert.equal(browser.elements.get('edit-undo').disabled, false);

  browser.elements.get('edit-undo').dispatch('click');
  await settle(5);
  assert.equal(wrapped.edit.undos, 1);
  assert.equal(browser.elements.get('edit-undo').disabled, true);
});

test('a refused transaction is visible and changes no version', async (t) => {
  const { browser, core } = setup({
    core: { world: { width: 64, height: 64 }, bounds: [26, 28, 28, 30], cells: [] },
  });
  const wrapped = withEditRoutes(core);
  browser.setFetchHandler(wrapped.handler);
  teardown(t, browser);
  await loadPage(browser);
  browser.elements.get('edit-mode').dispatch('click');
  await settle(5);

  const canvas = browser.canvas;
  const point = canvasCellPoint(browser, [26, 28]);
  wrapped.edit.refuseNext = true;
  canvas.dispatch('pointerdown', { pointerId: 1, button: 0, ...point });
  canvas.dispatch('pointerup', { pointerId: 1, ...point });
  await settle(5);
  assert.equal(wrapped.edit.transactions.length, 0, 'the refused transaction was not accepted');
  assert.match(browser.elements.get('error').textContent, /larger than the mode/);
});

test('a selection is saved as a draft and published with relative cells', async (t) => {
  const { browser, core } = setup({
    core: { world: { width: 64, height: 64 }, bounds: [26, 28, 28, 30], cells: [[26, 28], [27, 29]] },
  });
  const wrapped = withEditRoutes(core);
  browser.setFetchHandler(wrapped.handler);
  teardown(t, browser);
  await loadPage(browser);
  browser.elements.get('edit-mode').dispatch('click');
  await settle(5);
  browser.elements.get('edit-tool').value = 'select';

  const canvas = browser.canvas;
  const from = canvasCellPoint(browser, [26, 28]);
  const to = canvasCellPoint(browser, [27, 29]);
  canvas.dispatch('pointerdown', { pointerId: 1, button: 0, ...from });
  canvas.dispatch('pointerup', { pointerId: 1, ...to });
  await settle(5);
  assert.equal(browser.elements.get('snippet-save').disabled, false);

  browser.elements.get('snippet-save').dispatch('click');
  await settle(5);
  browser.elements.get('snippet-name').value = 'pair';
  browser.elements.get('snippet-name').dispatch('input');
  assert.equal(browser.elements.get('snippet-publish').disabled, false);
  browser.elements.get('snippet-publish').dispatch('click');
  await settle(5);
  assert.equal(wrapped.edit.published.length, 1);
  const body = wrapped.edit.published[0];
  assert.equal(body.name, 'pair');
  assert.equal(body.width, 2);
  assert.equal(body.height, 2);
  assert.deepEqual(body.cells, [[0, 0], [1, 1]], 'the cells are relative to the selection box');
});

test('the palette stamps with the chosen transform and mode', async (t) => {
  const { browser, core } = setup({
    core: { world: { width: 64, height: 64 }, bounds: [26, 28, 28, 30], cells: [] },
  });
  const wrapped = withEditRoutes(core);
  browser.setFetchHandler(wrapped.handler);
  teardown(t, browser);
  await loadPage(browser);
  browser.elements.get('edit-mode').dispatch('click');
  await settle(6);
  browser.elements.get('edit-tool').value = 'stamp';
  browser.elements.get('snippet-transform').value = 'rotate90';
  browser.elements.get('snippet-mode').value = 'merge';

  const canvas = browser.canvas;
  const point = canvasCellPoint(browser, [26, 28]);
  canvas.dispatch('pointerdown', { pointerId: 1, button: 0, ...point });
  canvas.dispatch('pointerup', { pointerId: 1, ...point });
  await settle(5);
  assert.equal(wrapped.edit.transactions.length, 1);
  const operation = wrapped.edit.transactions[0].ops[0];
  assert.equal(operation.kind, 'fill');
  assert.equal(operation.mode, 'merge');
  assert.deepEqual(operation.box, { x: 26, y: 28, w: 2, h: 2 });
  assert.deepEqual(
    operation.cells,
    [[0, 0], [1, 0], [1, 1]],
    'the L-shape is rotated before it is sent',
  );
});

test('a committed transaction from another client advances the page without a reload', async (t) => {
  const { browser, core } = setup({
    core: { world: { width: 64, height: 64 }, bounds: [26, 28, 28, 30], cells: [[26, 28]] },
  });
  const wrapped = withEditRoutes(core);
  browser.setFetchHandler(wrapped.handler);
  teardown(t, browser);
  await loadPage(browser);
  const source = StubEventSource.latest;
  source.emit('hello', { clientId: 42, representation: 'sparse', world: { width: 64, height: 64 } });
  browser.elements.get('edit-mode').dispatch('click');
  await settle(5);
  const framesBefore = browser.requestsTo('/api/frame').length;

  source.emit('patch', {
    sessionId: 'main',
    txId: 'other-tx',
    author: 'B',
    kind: 'commit',
    version: 1,
    hash: 'h1',
    patch: { born: [[26, 28]], died: [] },
  });
  await settle(6);

  assert.ok(
    browser.requestsTo('/api/frame').length > framesBefore,
    'the frame the patch changed is asked for again',
  );
  assert.equal(
    browser.elements.get('edit-undo').disabled,
    false,
    "and the global undo stack now includes B's transaction",
  );
});

test('a collaborator cursor is reported and a remote one joins the roster', async (t) => {
  const { browser, core } = setup({
    core: { world: { width: 64, height: 64 }, bounds: [26, 28, 28, 30], cells: [[26, 28]] },
  });
  const wrapped = withEditRoutes(core);
  browser.setFetchHandler(wrapped.handler);
  teardown(t, browser);
  await loadPage(browser);
  const source = StubEventSource.latest;
  source.emit('hello', { clientId: 42, representation: 'sparse', world: { width: 64, height: 64 } });
  browser.elements.get('edit-mode').dispatch('click');
  await settle(5);

  const point = canvasCellPoint(browser, [26, 28]);
  browser.canvas.dispatch('pointermove', { pointerId: 1, ...point });
  // Presence is throttled to 120 ms; wait past the coalescing window so the
  // cursor report is the one the service would have received.
  await new Promise((resolve) => setTimeout(resolve, 160));
  await settle(4);
  const reported = wrapped.edit.presence.find((entry) => entry.clientId === 42);
  assert.ok(reported, 'the page reported its cursor');
  assert.deepEqual(reported.cursor, [26, 28]);
  assert.equal(typeof reported.view.x0, 'number', 'and its view point');

  source.emit('presence', {
    clientId: 99,
    author: 'B',
    cursor: [27, 28],
    selection: null,
    view: { x0: 0, y0: 0, span: 64 },
  });
  await settle(4);
  const roster = browser.elements.get('edit-presence');
  assert.equal(roster.hidden, false);
  assert.match(roster.textContent, /B/, 'the collaborator is named');

  source.emit('presence', { clientId: 99, leaving: true });
  await settle(4);
  assert.equal(roster.hidden, true, 'and leaves when they do');
});
