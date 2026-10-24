/**
 * The viewer's HTTP surface, exercised over a real socket.
 *
 * Most cases run against a real Python core on an ephemeral port, so routing,
 * forwarding and teardown are all tested against the thing that ships. Two
 * cases use a stub bridge instead, because they test a rule this service owns
 * — the `frame` admission rule — and constructing a 100,000-cell world through
 * the protocol would test the core rather than the rule.
 */

import assert from 'node:assert/strict';
import { rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

import { CoreBridge, repoRoot } from '../bridge.mjs';
import {
  MAX_FRAME_CELLS,
  createViewerServer,
  defaultHistoryPath,
  resolveArchivePath,
  resolveStaticPath,
  startViewerServer,
} from '../server.mjs';

/**
 * Remove a SQLite store and its write-ahead sidecars, waiting for the core to let go.
 *
 * A history database is held open by the Python core, and on Windows that lock
 * outlives the request to stop the service by a short interval. An immediate
 * `rm` therefore fails with EBUSY, which is what this used to do — and it also
 * left the `-wal` and `-shm` sidecars behind, because deleting the database is
 * not the same as deleting everything SQLite created.
 */
async function removeStore(target) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await rm(target, { force: true });
      await rm(`${target}-wal`, { force: true });
      await rm(`${target}-shm`, { force: true });
      return;
    } catch (error) {
      if (error.code !== 'EBUSY' && error.code !== 'EPERM') throw error;
      await delay(50);
    }
  }
  throw new Error(`could not remove ${target}: the core still holds it`);
}

const publicDir = path.join(repoRoot, 'src', 'viewer', 'public');

function decodeCells(base64) {
  const buffer = Buffer.from(base64, 'base64');
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const cells = [];
  for (let offset = 0; offset + 8 <= buffer.byteLength; offset += 8) {
    cells.push([view.getInt32(offset, true), view.getInt32(offset + 4, true)]);
  }
  return cells;
}

async function startRealViewer(t, bridgeOptions = {}, serverOptions = {}) {
  const viewer = await startViewerServer({
    port: 0,
    ...serverOptions,
    bridgeOptions: { worldWidth: 64, worldHeight: 64, ...bridgeOptions },
  });
  t.after(async () => {
    await viewer.close();
    assert.equal(viewer.bridge.running, false, 'teardown must leave no core process behind');
  });
  return viewer;
}

async function listenOnEphemeralPort(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  return `http://127.0.0.1:${server.address().port}`;
}

/** A bridge that answers from memory, for testing this service's own rules. */
function stubBridge({
  population = 0,
  representation = 'sparse',
  history = false,
  openSupported = false,
} = {}) {
  const calls = [];
  const listeners = new Set();
  const limits = {
    ticksPerSecond: { min: 1, max: 60 },
    stepsPerRequest: 100000,
    maxCoordinate: 65535,
    representations: ['sparse', 'tiled'],
  };
  let generation = 0;
  let head = history ? 2 : null;
  const generations = history
    ? [
        { id: 1, parent: null, generation: 0, kind: 'keyframe', population: 5, changed: 5, born: 5, died: 0, at: 't0' },
        { id: 2, parent: 1, generation: 1, kind: 'delta', population: 5, changed: 4, born: 2, died: 2, at: 't1' },
      ]
    : [];
  return {
    calls,
    representation,
    get running() {
      return true;
    },
    async stop() {},
    // A faithful stand-in implements the whole interface the service uses, not
    // only the part one test happens to reach: the event hub subscribes through
    // `onEvent` and reads `representation`, so a stub without them would fail
    // at construction rather than at the rule under test.
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(event) {
      for (const listener of listeners) listener(event);
    },
    async restart(options = {}) {
      if (options.representation) this.representation = options.representation;
      return 1;
    },
    async request(cmd, fields = {}) {
      calls.push({ cmd, fields });
      if (cmd === 'hello') {
        return {
          ok: true,
          protocol: 1,
          world: { width: 64, height: 64 },
          rule: 'B3/S23',
          running: false,
          tps: 10,
          limits,
          history,
        };
      }
      if (cmd === 'state') {
        return {
          ok: true,
          world: { width: 64, height: 64 },
          rule: 'B3/S23',
          generation,
          population,
          bounds: null,
          running: false,
          tps: 10,
        };
      }
      if (cmd === 'history') {
        if (!history) {
          return {
            ok: false,
            error: 'bad_arguments',
            message: 'this core was started without a history; pass --history PATH to record one',
          };
        }
        return { ok: true, session: 1, current: generation, head, count: generations.length, generations };
      }
      if (cmd === 'select') {
        const wanted = generations.find(
          (row) => row.id === fields.node || row.generation === fields.generation,
        );
        if (wanted === undefined) {
          return { ok: false, error: 'bad_arguments', message: 'no such node' };
        }
        head = wanted.id;
        generation = wanted.generation;
        return { ok: true, node: wanted.id, generation, population, bounds: null };
      }
      if (cmd === 'rollback') {
        generation = fields.generation;
        return { ok: true, generation, population, bounds: null };
      }
      if (cmd === 'archive') {
        return { ok: true, path: fields.path, generations: generations.length };
      }
      if (cmd === 'open') {
        // The real core does not implement this yet, and the default stub says
        // so for the same reason: the honest refusal is the behaviour the page
        // has to render, and a stub that answered it away would hide that.
        if (!openSupported) {
          return { ok: false, error: 'unknown_command', message: "unknown command 'open'" };
        }
        return { ok: true, session: 2, generation, population };
      }
      if (cmd === 'export') {
        // The live set as the service wraps it: the `cells` encoding, which the
        // page decodes, and the population that decides whether it may be sent.
        return {
          ok: true,
          export: {
            format: 'cells',
            data: Buffer.alloc(0).toString('base64'),
            population,
            generation,
            world: { width: 64, height: 64 },
            rule: 'B3/S23',
          },
        };
      }
      if (cmd === 'frame') {
        return {
          ok: true,
          frame: {
            x0: fields.x0,
            y0: fields.y0,
            w: fields.w,
            h: fields.h,
            generation,
            population,
            format: 'cells',
            data: '',
          },
        };
      }
      return { ok: true };
    },
  };
}

/** A stub-backed viewer on an ephemeral port, for the routes this layer owns. */
async function startStubViewer(t, options = {}) {
  const bridge = stubBridge(options);
  const server = createViewerServer({ bridge, ownsBridge: false, ...options.server });
  const url = await listenOnEphemeralPort(server);
  t.after(async () => {
    await server.closeViewer();
  });
  return { url, bridge };
}

test('resolveStaticPath confines every path to the public directory', () => {
  assert.equal(resolveStaticPath(publicDir, '/app.js'), path.join(publicDir, 'app.js'));
  assert.equal(resolveStaticPath(publicDir, '/nested/file.css'), path.join(publicDir, 'nested', 'file.css'));
  for (const attack of [
    '/../package.json',
    '/%2e%2e/package.json',
    '/..%2fpackage.json',
    '/..%5cpackage.json',
    '/a/../../package.json',
    '/%2e%2e%2f%2e%2e%2fpackage.json',
    '/%00',
    '/',
  ]) {
    assert.equal(resolveStaticPath(publicDir, attack), null, `must reject ${attack}`);
  }
});

test('GET / serves the page and GET /static serves assets', async (t) => {
  const viewer = await startRealViewer(t);

  const index = await fetch(`${viewer.url}/`);
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type'), /text\/html/);
  const html = await index.text();
  assert.match(html, /<canvas/);
  assert.match(html, /\/static\/app\.js/);

  const script = await fetch(`${viewer.url}/static/app.js`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type'), /javascript/);
  assert.match(await script.text(), /canvas/);

  const style = await fetch(`${viewer.url}/static/style.css`);
  assert.equal(style.status, 200);
  assert.match(style.headers.get('content-type'), /text\/css/);
});

test('a traversal attempt never reaches a file outside public/', async (t) => {
  const viewer = await startRealViewer(t);
  for (const attack of [
    '/static/%2e%2e/package.json',
    '/static/..%2fpackage.json',
    '/static/%2e%2e%2f%2e%2e%2fpackage.json',
    '/static/..%5cpackage.json',
  ]) {
    const response = await fetch(`${viewer.url}${attack}`);
    assert.ok([403, 404].includes(response.status), `${attack} answered ${response.status}`);
    const body = await response.text();
    assert.doesNotMatch(body, /"name"\s*:\s*"lifegame"/, `${attack} leaked package.json`);
  }
});

test('an unknown route is a 404, not a crash', async (t) => {
  const viewer = await startRealViewer(t);
  const response = await fetch(`${viewer.url}/api/does-not-exist`);
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.error, 'not_found');
});

test('state, command and frame round-trip through the service', async (t) => {
  const viewer = await startRealViewer(t);

  const hello = await (await fetch(`${viewer.url}/api/state`)).json();
  assert.equal(hello.ok, true);
  assert.deepEqual(hello.world, { width: 64, height: 64 });

  const glider = [
    [1, 0],
    [2, 1],
    [0, 2],
    [1, 2],
    [2, 2],
  ];
  const set = await (
    await fetch(`${viewer.url}/api/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cmd: 'set', cells: glider }),
    })
  ).json();
  assert.equal(set.ok, true);
  assert.equal(set.changed, 5);
  assert.equal(set.population, 5);

  const frame = await (
    await fetch(`${viewer.url}/api/frame?x0=0&y0=0&w=64&h=64`)
  ).json();
  assert.equal(frame.ok, true);
  assert.equal(frame.frame.format, 'cells');
  assert.deepEqual(
    decodeCells(frame.frame.data).map(([x, y]) => `${x},${y}`).sort(),
    glider.map(([x, y]) => `${x},${y}`).sort(),
  );

  const stepped = await (
    await fetch(`${viewer.url}/api/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cmd: 'step', count: 4 }),
    })
  ).json();
  assert.equal(stepped.generation, 4);

  const after = await (await fetch(`${viewer.url}/api/state`)).json();
  assert.deepEqual(after.bounds, [1, 1, 3, 3]);
});

test('a protocol error is forwarded with the core’s own code', async (t) => {
  const viewer = await startRealViewer(t);
  const reply = await (
    await fetch(`${viewer.url}/api/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cmd: 'toggle', x: 9999, y: 0 }),
    })
  ).json();
  assert.equal(reply.ok, false);
  assert.equal(reply.error, 'out_of_bounds');
});

test('malformed requests are rejected before they reach the core', async (t) => {
  const viewer = await startRealViewer(t);

  const notJson = await fetch(`${viewer.url}/api/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{not json',
  });
  assert.equal(notJson.status, 400);
  assert.equal((await notJson.json()).error, 'bad_request');

  const noCommand = await fetch(`${viewer.url}/api/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cells: [[0, 0]] }),
  });
  assert.equal(noCommand.status, 400);

  const frameAsCommand = await fetch(`${viewer.url}/api/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cmd: 'frame', x0: 0, y0: 0, w: 8, h: 8 }),
  });
  assert.equal(frameAsCommand.status, 400);
  assert.match((await frameAsCommand.json()).message, /GET \/api\/frame/);

  const missingQuery = await fetch(`${viewer.url}/api/frame?x0=0&y0=0&w=8`);
  assert.equal(missingQuery.status, 400);

  const notAnInteger = await fetch(`${viewer.url}/api/frame?x0=0&y0=0&w=8&h=eight`);
  assert.equal(notAnInteger.status, 400);

  const negative = await fetch(`${viewer.url}/api/frame?x0=-1&y0=0&w=8&h=8`);
  assert.equal(negative.status, 400);

  const stillAlive = await (await fetch(`${viewer.url}/api/state`)).json();
  assert.equal(stillAlive.ok, true, 'the core must survive every rejected request');
});

test('frame admission follows the encoder’s own rule', async (t) => {
  const budget = MAX_FRAME_CELLS;

  // A sparse world may be viewed whole: the encoder chooses `cells`, which
  // never materialises a dense grid, so the area cap must not apply. This holds
  // even for a population of 100,000, because 100000 * 64 is far below the
  // 4.29e9 cells of a 65536-squared rectangle.
  const sparse = stubBridge({ population: 100000 });
  const sparseServer = createViewerServer({ bridge: sparse, ownsBridge: false });
  const sparseUrl = await listenOnEphemeralPort(sparseServer);
  t.after(() => sparseServer.closeViewer());

  await fetch(`${sparseUrl}/api/state`);
  const wholeWorld = await fetch(`${sparseUrl}/api/frame?x0=0&y0=0&w=65536&h=65536`);
  assert.equal(wholeWorld.status, 200, 'a wide sparse frame is what the cells encoding is for');

  // The budget itself is the exact boundary and is still allowed.
  const atBudget = await fetch(`${sparseUrl}/api/frame?x0=0&y0=0&w=4096&h=4096`);
  assert.equal(atBudget.status, 200);
  assert.equal(4096 * 4096, budget);

  // A dense world may not be: one cell over the budget, with a population that
  // makes the cells encoding impossible, would have the core build a dense
  // bitmap of that rectangle. The population has to exceed area / 64 for that,
  // which is 262,209 cells at this rectangle.
  const dense = stubBridge({ population: 300000 });
  const denseServer = createViewerServer({ bridge: dense, ownsBridge: false });
  const denseUrl = await listenOnEphemeralPort(denseServer);
  t.after(() => denseServer.closeViewer());

  await fetch(`${denseUrl}/api/state`);
  const overBudget = await fetch(`${denseUrl}/api/frame?x0=0&y0=0&w=4097&h=4097`);
  assert.equal(overBudget.status, 400);
  const body = await overBudget.json();
  assert.equal(body.error, 'bad_request');
  assert.match(body.message, /exceeds/);
  assert.equal(dense.calls.filter((call) => call.cmd === 'frame').length, 0, 'nothing may reach the core');

  // The same population in a rectangle inside the budget is fine.
  const modest = await fetch(`${denseUrl}/api/frame?x0=0&y0=0&w=64&h=64`);
  assert.equal(modest.status, 200);
});

test('admission uses the encoder rule, not a wider one', async (t) => {
  // This case sits strictly inside the band where the encoder's rule and the
  // four-times-wider rule it was first written with disagree: the area is over
  // the budget, and the population is above area / 64 but below area / 256, so
  // the encoder still chooses `cells` and nothing dense is allocated.
  //
  // 4097 * 4097 = 16,785,409 > 16,777,216, and with 100,000 live cells the
  // encoder's test is 6,400,000 <= 16,785,409 (cells), while the wider rule
  // would have demanded 25,600,000 <= 16,785,409 (bits) and refused.
  const population = 100000;
  const area = 4097 * 4097;
  assert.ok(area > MAX_FRAME_CELLS, 'the case must be over the area budget');
  assert.ok(population * 64 <= area && population * 256 > area, 'the case must be in the band');

  const bridge = stubBridge({ population });
  const server = createViewerServer({ bridge, ownsBridge: false });
  const url = await listenOnEphemeralPort(server);
  t.after(() => server.closeViewer());

  await fetch(`${url}/api/state`);
  const reply = await fetch(`${url}/api/frame?x0=0&y0=0&w=4097&h=4097`);
  assert.equal(reply.status, 200, 'a request the encoder can serve as cells must be admitted');
  assert.equal(bridge.calls.filter((call) => call.cmd === 'frame').length, 1);
});

test('an unavailable core answers 503', async (t) => {
  const bridge = new CoreBridge({
    pythonPath: path.join(repoRoot, '.venv', 'Scripts', 'python-that-is-not-there.exe'),
  });
  const server = createViewerServer({ bridge, ownsBridge: false });
  const url = await listenOnEphemeralPort(server);
  t.after(async () => {
    await server.closeViewer();
    await bridge.stop();
  });

  const state = await fetch(`${url}/api/state`);
  assert.equal(state.status, 503);
  const body = await state.json();
  assert.equal(body.ok, false);
  assert.equal(body.error, 'core_unavailable');
  assert.match(body.message, /interpreter is missing/);

  const command = await fetch(`${url}/api/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cmd: 'state' }),
  });
  assert.equal(command.status, 503);

  const frame = await fetch(`${url}/api/frame?x0=0&y0=0&w=8&h=8`);
  assert.equal(frame.status, 503);
});

test('the page keeps serving while the core is unavailable', async (t) => {
  const bridge = new CoreBridge({
    pythonPath: path.join(repoRoot, '.venv', 'Scripts', 'python-that-is-not-there.exe'),
  });
  const server = createViewerServer({ bridge, ownsBridge: false });
  const url = await listenOnEphemeralPort(server);
  t.after(async () => {
    await server.closeViewer();
    await bridge.stop();
  });

  const index = await fetch(`${url}/`);
  assert.equal(index.status, 200, 'a broken core must not take the page down with it');
  assert.match(await index.text(), /<canvas/);
});

// -- the push transport, over a real socket ------------------------------

/** One `event:`/`data:` block, or null for a comment such as a heartbeat. */
function parseSseBlock(raw) {
  let event = 'message';
  const data = [];
  let sawField = false;
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
      sawField = true;
    } else if (line.startsWith('data:')) {
      data.push(line.slice(5).trim());
      sawField = true;
    }
  }
  if (!sawField) return null;
  return { event, data: data.join('\n') };
}

/** Read a Server-Sent Events response the way a browser would. */
async function openEventStream(url, t) {
  const controller = new AbortController();
  const response = await fetch(url, { signal: controller.signal });
  const events = [];
  const decoder = new TextDecoder();
  let buffer = '';
  const pump = (async () => {
    try {
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let at = buffer.indexOf('\n\n');
        while (at !== -1) {
          const block = parseSseBlock(buffer.slice(0, at));
          buffer = buffer.slice(at + 2);
          if (block !== null) {
            events.push({ ...block, json: block.data === '' ? null : JSON.parse(block.data) });
          }
          at = buffer.indexOf('\n\n');
        }
      }
    } catch {
      // The stream was aborted, which is how this helper closes it.
    }
  })();
  const close = async () => {
    controller.abort();
    await pump.catch(() => {});
  };
  if (t) t.after(close);
  return {
    response,
    events,
    close,
    ofType: (type) => events.filter((entry) => entry.event === type),
  };
}

async function waitForEvent(stream, type, timeoutMs = 8000, predicate = () => true) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = stream.ofType(type).filter(predicate);
    if (found.length > 0) return found[found.length - 1];
    if (Date.now() > deadline) {
      throw new Error(
        `no '${type}' event within ${timeoutMs} ms; saw [${stream.events.map((entry) => entry.event).join(', ')}]`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** The whole live set, as sorted "x,y" strings, by asking for one wide frame. */
async function worldCells(url, width = 64, height = 64) {
  const reply = await (await fetch(`${url}/api/frame?x0=0&y0=0&w=${width}&h=${height}`)).json();
  assert.equal(reply.ok, true, JSON.stringify(reply));
  return decodeCells(reply.frame.data)
    .map(([x, y]) => `${x},${y}`)
    .sort();
}

test('the event stream describes the world and then pushes a frame', async (t) => {
  const viewer = await startRealViewer(t);
  const stream = await openEventStream(`${viewer.url}/api/events?x0=0&y0=0&w=32&h=32`, t);

  assert.equal(stream.response.status, 200);
  assert.match(stream.response.headers.get('content-type'), /text\/event-stream/);

  const hello = await waitForEvent(stream, 'hello');
  assert.equal(hello.json.protocolVersion, 1);
  assert.deepEqual(hello.json.world, { width: 64, height: 64 });
  assert.equal(hello.json.rule, 'B3/S23');
  assert.equal(hello.json.representation, 'sparse');
  assert.equal(typeof hello.json.clientId, 'number');

  const frame = await waitForEvent(stream, 'frame');
  assert.equal(frame.json.w, 32, 'the frame is the rectangle that was subscribed to');
  assert.equal(frame.json.h, 32);
  assert.equal(frame.json.generation, 0);

  await stream.close();
});

test('two subscribers each receive their own rectangle', async (t) => {
  const viewer = await startRealViewer(t);
  const first = await openEventStream(`${viewer.url}/api/events?x0=0&y0=0&w=16&h=16`, t);
  const second = await openEventStream(`${viewer.url}/api/events?x0=0&y0=0&w=48&h=32`, t);

  const firstFrame = await waitForEvent(first, 'frame');
  const secondFrame = await waitForEvent(second, 'frame');
  assert.equal(firstFrame.json.w, 16);
  assert.equal(secondFrame.json.w, 48, 'two subscribers are not served the same rectangle');
  assert.notEqual(
    first.ofType('hello')[0].json.clientId,
    second.ofType('hello')[0].json.clientId,
  );

  await first.close();
  await second.close();
});

test('a mutation is pushed to a subscriber without being polled for', async (t) => {
  const viewer = await startRealViewer(t);
  const stream = await openEventStream(`${viewer.url}/api/events?x0=0&y0=0&w=16&h=16`, t);
  await waitForEvent(stream, 'frame');
  const framesBefore = stream.ofType('frame').length;

  const reply = await fetch(`${viewer.url}/api/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cmd: 'set', cells: [[1, 1], [2, 2], [3, 3]] }),
  });
  assert.equal(reply.status, 200);

  // Wait for a frame that actually carries the change, not for the one already
  // on the wire when the request was sent.
  const frame = await waitForEvent(stream, 'frame', 8000, (entry) => entry.json.population === 3);
  assert.ok(
    stream.ofType('frame').length > framesBefore,
    'the change arrives on the stream rather than waiting for a poll',
  );
  assert.equal(frame.json.population, 3);
  const state = await waitForEvent(stream, 'state', 8000, (entry) => entry.json.population === 3);
  assert.equal(state.json.population, 3);

  await stream.close();
});

test('a subscription update is answered on the same connection', async (t) => {
  const viewer = await startRealViewer(t);
  const stream = await openEventStream(`${viewer.url}/api/events`, t);
  const hello = await waitForEvent(stream, 'hello');
  // A stream that has not named a rectangle is shown nothing: the default view
  // belongs to the page's canvas, and this service does not invent one. The
  // first frame therefore arrives with the subscription below.
  assert.deepEqual(stream.ofType('frame'), [], 'no frame for a view nobody named');

  const reply = await fetch(`${viewer.url}/api/subscription`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientId: hello.json.clientId, x0: 8, y0: 8, w: 24, h: 24 }),
  });
  assert.equal(reply.status, 200);
  assert.deepEqual((await reply.json()).viewport, { x0: 8, y0: 8, w: 24, h: 24 });

  const frame = await waitForEvent(stream, 'frame', 8000, (entry) => entry.json.w === 24);
  assert.equal(frame.json.x0, 8);
  assert.equal(frame.json.y0, 8);

  await stream.close();
});

test('a subscription for an unknown stream is refused', async (t) => {
  const viewer = await startRealViewer(t);
  const reply = await fetch(`${viewer.url}/api/subscription`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientId: 999999, x0: 0, y0: 0, w: 16, h: 16 }),
  });
  assert.equal(reply.status, 404);
  assert.equal((await reply.json()).error, 'unknown_client');
});

test('a subscription that would be refused as a frame is refused here too', async (t) => {
  const viewer = await startRealViewer(t);
  const stream = await openEventStream(`${viewer.url}/api/events`, t);
  const hello = await waitForEvent(stream, 'hello');

  // The world is 64 x 64, so this rectangle is larger than the world; the core
  // would reject it and the admission rule does not need to. What matters is
  // that the route does not forward it blindly.
  const reply = await fetch(`${viewer.url}/api/subscription`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientId: hello.json.clientId, x0: 0, y0: 0, w: 0, h: 16 }),
  });
  assert.equal(reply.status, 400);

  await stream.close();
});

// -- switching the representation ----------------------------------------

test('switching the representation preserves the world, generation included', async (t) => {
  const viewer = await startRealViewer(t, { worldWidth: 64, worldHeight: 64 });
  const url = viewer.url;

  const post = async (path, body) => {
    const reply = await fetch(`${url}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: reply.status, body: await reply.json() };
  };

  // A glider, stepped four generations, so the world has a shape, a population
  // and a generation that all have to survive the switch.
  const glider = [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]];
  assert.equal((await post('/api/command', { cmd: 'set', cells: glider })).body.population, 5);
  assert.equal((await post('/api/command', { cmd: 'step', count: 4 })).body.generation, 4);

  const before = await (await fetch(`${url}/api/state`)).json();
  const cellsBefore = await worldCells(url);
  const pidBefore = viewer.bridge.pid;
  assert.equal(before.generation, 4);
  assert.equal(before.population, 5);
  assert.deepEqual(before.bounds, [1, 1, 3, 3]);

  // A rule that is not the default, set before the switch: a switch that dropped
  // the rule would leave the core on Conway, and the assertion below would then
  // read the default instead of agreeing by accident.
  assert.equal(
    (await post('/api/command', { cmd: 'set_rule', rule: 'B36/S23' })).body.rule,
    'B36/S23',
  );
  assert.equal((await (await fetch(`${url}/api/state`)).json()).rule, 'B36/S23');

  const toTiled = await post('/api/representation', { representation: 'tiled' });
  assert.equal(toTiled.status, 200);
  assert.equal(toTiled.body.ok, true);
  assert.equal(toTiled.body.switched, true);
  assert.equal(toTiled.body.representation, 'tiled');
  assert.equal(toTiled.body.exported.population, 5, 'the export carried the live set');
  assert.equal(toTiled.body.imported.population, 5, 'the import restored it');
  assert.equal(viewer.bridge.representation, 'tiled');
  assert.notEqual(viewer.bridge.pid, pidBefore, 'a switch replaces the core process');
  // The rule is part of the world, so it has to make the same journey the cells
  // do. The service exports the world, restarts the core on the other
  // representation and imports it back; a gap at any of those three steps would
  // silently return the session to Conway.
  assert.equal(toTiled.body.state.rule, 'B36/S23', 'the rule survives the switch');
  assert.equal(
    (await (await fetch(`${url}/api/state`)).json()).rule,
    'B36/S23',
    'and the core is still running it afterwards',
  );

  assert.equal(toTiled.body.state.generation, 4, 'the generation must not rewind');
  assert.equal(toTiled.body.state.population, 5);
  assert.deepEqual(toTiled.body.state.bounds, before.bounds);
  assert.deepEqual(await worldCells(url), cellsBefore, 'the cells are the same cells');
  assert.deepEqual((await (await fetch(`${url}/api/state`)).json()).bounds, before.bounds);

  // And back again, so the switch is a switch and not a one-way door.
  const toSparse = await post('/api/representation', { representation: 'sparse' });
  assert.equal(toSparse.status, 200);
  assert.equal(toSparse.body.switched, true);
  assert.equal(toSparse.body.previousRepresentation, 'tiled');
  assert.equal(viewer.bridge.representation, 'sparse');
  assert.equal(toSparse.body.state.generation, 4);
  assert.equal(toSparse.body.state.rule, 'B36/S23', 'and back again, still the same rule');
  assert.deepEqual(await worldCells(url), cellsBefore);

  // The world is still alive: one more generation moves the glider.
  const stepped = await post('/api/command', { cmd: 'step', count: 1 });
  assert.equal(stepped.body.generation, 5);
  assert.equal(stepped.body.population, 5);
});

test('switching to the representation already running does nothing', async (t) => {
  const viewer = await startRealViewer(t, { worldWidth: 64, worldHeight: 64 });
  // Start the core first: a bridge that has not been asked anything has no child
  // yet, and comparing "no process" with "no process" would prove nothing.
  assert.equal((await (await fetch(`${viewer.url}/api/state`)).json()).ok, true);
  const pidBefore = viewer.bridge.pid;
  assert.ok(Number.isInteger(pidBefore));

  const reply = await fetch(`${viewer.url}/api/representation`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ representation: 'sparse' }),
  });
  assert.equal(reply.status, 200);
  const body = await reply.json();
  assert.equal(body.switched, false);
  assert.equal(viewer.bridge.pid, pidBefore, 'no process was replaced for nothing');
});

test('an unknown representation is refused', async (t) => {
  const viewer = await startRealViewer(t, { worldWidth: 64, worldHeight: 64 });
  const reply = await fetch(`${viewer.url}/api/representation`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ representation: 'quadtree' }),
  });
  assert.equal(reply.status, 400);
  const body = await reply.json();
  assert.equal(body.error, 'bad_request');
  assert.match(body.message, /sparse, tiled/);
  assert.equal(viewer.bridge.representation, 'sparse');
});

test('concurrent switches leave exactly one winner and a usable core', async (t) => {
  const viewer = await startRealViewer(t, { worldWidth: 64, worldHeight: 64 });
  const attempt = async () => {
    const reply = await fetch(`${viewer.url}/api/representation`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ representation: 'tiled' }),
    });
    return { status: reply.status, body: await reply.json() };
  };

  const results = await Promise.all([attempt(), attempt(), attempt(), attempt()]);
  const winners = results.filter((entry) => entry.body?.switched === true);
  assert.equal(winners.length, 1, 'a switch must happen once, not once per request');
  for (const entry of results) {
    // A loser either finds the switch already done, or is told to wait. What it
    // must never do is read the empty world the restart leaves behind.
    assert.ok(
      entry.status === 200 || entry.status === 503,
      `unexpected status ${entry.status}: ${JSON.stringify(entry.body)}`,
    );
    if (entry.status === 503) assert.equal(entry.body.error, 'switch_in_progress');
    if (entry.status === 200 && entry.body.switched === false) {
      assert.equal(entry.body.representation, 'tiled');
    }
  }
  assert.equal(viewer.bridge.representation, 'tiled');

  // The core is healthy afterwards.
  const state = await (await fetch(`${viewer.url}/api/state`)).json();
  assert.equal(state.ok, true);
  assert.equal(state.world.width, 64);
});

// -- the history routes ---------------------------------------------------

test('an archive name is confined to the archive directory', () => {
  const dir = path.join(repoRoot, 'data');
  assert.equal(resolveArchivePath('run.jsonl', dir), path.join(dir, 'run.jsonl'));
  for (const rejected of [
    '../escape.jsonl',
    'sub/dir.jsonl',
    'sub\\dir.jsonl',
    'C:\\Windows\\system.jsonl',
    '/etc/passwd.jsonl',
    '.jsonl',
    '..',
    'run.txt',
    'run.jsonl.bak',
    '',
    null,
    7,
  ]) {
    assert.equal(resolveArchivePath(rejected, dir), null, `${rejected} must be refused`);
  }
});

test('a state reply carries the limits the core only says in hello', async (t) => {  // A page that fell back to polling never sees the stream's `hello`, so these
  // facts have to ride along with every state reply or it has no rate control
  // and no representation to offer.
  const { url } = await startStubViewer(t);
  const state = await (await fetch(`${url}/api/state`)).json();
  assert.deepEqual(state.limits.ticksPerSecond, { min: 1, max: 60 });
  assert.deepEqual(state.limits.representations, ['sparse', 'tiled']);
  assert.equal(state.history, false);
  assert.equal(state.representation, 'sparse');
});

test('the timeline route forwards the core, and reports a core with none', async (t) => {
  const withHistory = await startStubViewer(t, { history: true });
  const reply = await (await fetch(`${withHistory.url}/api/history`)).json();
  assert.equal(reply.ok, true);
  assert.equal(reply.history, true);
  assert.equal(reply.count, 2);
  assert.deepEqual(
    reply.generations.map((row) => row.generation),
    [0, 1],
  );

  const without = await startStubViewer(t, { history: false });
  const refused = await (await fetch(`${without.url}/api/history`)).json();
  assert.equal(refused.ok, false);
  assert.equal(refused.error, 'no_history', 'a generic argument error would not be labelable');
  assert.equal(refused.history, false);
  assert.deepEqual(refused.generations, []);
});

test('the live set route sends the cells, and the bounds when they are too many', async (t) => {
  // Under the cap: the core's own `export` payload, plus the population the page
  // reports when it says which centre it used.
  const small = await startStubViewer(t, { population: 5, server: { maxCellsForNearest: 16384 } });
  const reply = await (await fetch(`${small.url}/api/cells`)).json();
  assert.equal(reply.ok, true);
  assert.equal(reply.truncated, false);
  assert.equal(reply.population, 5);
  assert.equal(reply.format, 'cells');
  assert.equal(typeof reply.cells, 'string', 'the page decodes this with decode.mjs');
  assert.equal(reply.bounds, undefined, 'and nothing is said about bounds it did not need');

  // Over it: the population and the core's bounds instead of a payload
  // proportional to a design-target world, and a stated reason.
  const large = await startStubViewer(t, { population: 5, server: { maxCellsForNearest: 1 } });
  const degraded = await (await fetch(`${large.url}/api/cells`)).json();
  assert.equal(degraded.ok, true);
  assert.equal(degraded.truncated, true);
  assert.equal(degraded.reason, 'population_above_cap');
  assert.equal(degraded.cap, 1);
  assert.equal(degraded.population, 5);
  assert.equal(degraded.cells, null);
  assert.equal(degraded.bounds, null, 'the core in this stub reports no bounds');
});

test('the live set route reads the real core\'s export', async (t) => {
  const viewer = await startRealViewer(t);
  const url = viewer.url;
  const post = async (path, body) => {
    const response = await fetch(`${url}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };

  const glider = [
    [10, 10],
    [11, 11],
    [12, 9],
    [12, 10],
    [12, 11],
  ];
  assert.equal((await post('/api/command', { cmd: 'set', cells: glider })).body.population, 5);

  const reply = await (await fetch(`${url}/api/cells`)).json();
  assert.equal(reply.ok, true);
  assert.equal(reply.truncated, false);
  assert.equal(reply.population, 5);
  assert.deepEqual(
    decodeCells(reply.cells)
      .map(([x, y]) => `${x},${y}`)
      .sort(),
    glider.map(([x, y]) => `${x},${y}`).sort(),
    'the payload is the live set, in the encoding the page already decodes',
  );
});

test('a rollback restores a generation and tells every subscriber', async (t) => {
  const { url, bridge } = await startStubViewer(t, { history: true, population: 5 });
  const response = await fetch(`${url}/api/rollback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ generation: 1 }),
  });
  assert.equal(response.status, 200);
  const reply = await response.json();
  assert.equal(reply.ok, true);
  assert.equal(reply.generation, 1);
  assert.equal(reply.state.generation, 1, 'the state travels with the reply');
  assert.deepEqual(
    bridge.calls.filter((call) => call.cmd === 'rollback').map((call) => call.fields),
    [{ generation: 1 }],
  );
});

test('a rollback of a generation that was never recorded is refused', async (t) => {
  const { url, bridge } = await startStubViewer(t, { history: true });
  for (const body of [{}, { generation: -1 }, { generation: 1.5 }, { generation: '1' }]) {
    const response = await fetch(`${url}/api/rollback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal((await response.json()).error, 'bad_request');
  }
  assert.equal(
    bridge.calls.filter((call) => call.cmd === 'rollback').length,
    0,
    'nothing may reach the core',
  );
});

test('an archive is written where the service decides, not where the client says', async (t) => {
  const { url, bridge } = await startStubViewer(t, { history: true });
  const good = await fetch(`${url}/api/archive`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'run.jsonl' }),
  });
  assert.equal(good.status, 200);
  const reply = await good.json();
  assert.equal(reply.name, 'run.jsonl');
  const written = bridge.calls.filter((call) => call.cmd === 'archive');
  assert.equal(written.length, 1);
  assert.equal(
    written[0].fields.path,
    path.join(repoRoot, 'data', 'run.jsonl'),
    'the core is told a path inside the repository',
  );

  for (const name of ['../escape.jsonl', 'C:\\Windows\\x.jsonl', 'sub/x.jsonl', 'x.txt']) {
    const response = await fetch(`${url}/api/archive`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    assert.equal(response.status, 400, `${name} must be refused`);
  }
  assert.equal(
    bridge.calls.filter((call) => call.cmd === 'archive').length,
    1,
    'a refused name never reaches the core',
  );
});

test('the default history path is inside the repository', () => {
  assert.equal(defaultHistoryPath, path.join(repoRoot, 'data', 'history.db'));
  assert.ok(defaultHistoryPath.startsWith(repoRoot), 'nothing may be written outside the repository');
});

test('selecting a node moves the working point through the service', async (t) => {
  const bridge = stubBridge({ history: true });
  const server = createViewerServer({ bridge, ownsBridge: false });
  const url = await listenOnEphemeralPort(server);
  t.after(() => server.closeViewer());

  const selected = await (
    await fetch(`${url}/api/select`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ node: 1 }),
    })
  ).json();
  assert.equal(selected.ok, true);
  assert.equal(selected.node, 1);
  assert.ok(selected.state, 'the world moved, so the caller is told what it moved to');
  assert.deepEqual(
    bridge.calls.filter((call) => call.cmd === 'select').map((call) => call.fields),
    [{ node: 1 }],
    'the service asks the core to select, and names the node rather than a generation',
  );

  // A generation is accepted too, for the linear case the core resolves itself.
  await fetch(`${url}/api/select`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ generation: 0 }),
  });
  assert.deepEqual(
    bridge.calls.filter((call) => call.cmd === 'select').at(-1).fields,
    { generation: 0 },
  );

  for (const body of [{}, { node: -1 }, { node: 'first' }, { generation: 1.5 }]) {
    const refused = await fetch(`${url}/api/select`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(refused.status, 400, JSON.stringify(body));
  }
  assert.equal(
    bridge.calls.filter((call) => call.cmd === 'select').length,
    2,
    'a malformed request never reaches the core',
  );
});

// -- the history, end to end against a real core --------------------------

test('a recorded run can be walked back through the service', async (t) => {
  const historyPath = path.join(repoRoot, 'TEMP', 'viewer-history-e2e.db');
  await removeStore(historyPath);

  const viewer = await startRealViewer(t, { historyPath });
  t.after(async () => {
    // Stop the core here rather than relying on hook ordering: the store is held
    // open by the child process, so removing it before the viewer's own teardown
    // has run fails with EBUSY, and which hook runs first is the runner's choice
    // rather than this test's. `stop` is idempotent, so the viewer's teardown
    // finding it already stopped is fine.
    if (viewer.bridge.running) await viewer.bridge.stop();
    await removeStore(historyPath);
  });
  const glider = [
    [1, 0],
    [2, 1],
    [0, 2],
    [1, 2],
    [2, 2],
  ];
  const command = async (body) =>
    (
      await fetch(`${viewer.url}/api/command`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    ).json();

  await command({ cmd: 'set', cells: glider });
  for (let step = 0; step < 4; step += 1) await command({ cmd: 'step', count: 1 });

  const timeline = await (await fetch(`${viewer.url}/api/history`)).json();
  assert.equal(timeline.ok, true);
  assert.equal(timeline.history, true);
  assert.equal(timeline.current, 4);
  assert.ok(timeline.count >= 5, `expected at least five recorded generations, got ${timeline.count}`);
  const kinds = new Set(timeline.generations.map((row) => row.kind));
  assert.ok(kinds.has('keyframe'), 'the first generation must be a keyframe');

  const rollback = await (
    await fetch(`${viewer.url}/api/rollback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ generation: 1 }),
    })
  ).json();
  assert.equal(rollback.ok, true);
  assert.equal(rollback.generation, 1);
  assert.equal(rollback.population, 5);

  const state = await (await fetch(`${viewer.url}/api/state`)).json();
  assert.equal(state.generation, 1);
  assert.equal(state.population, 5);
  assert.deepEqual(state.limits.representations, ['sparse', 'tiled']);
  assert.equal(state.history, true);

  const archivePath = path.join(repoRoot, 'data', 'e2e-archive.jsonl');
  t.after(async () => {
    await rm(archivePath, { force: true });
  });
  const archived = await (
    await fetch(`${viewer.url}/api/archive`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'e2e-archive.jsonl' }),
    })
  ).json();
  assert.equal(archived.ok, true);
  assert.ok(archived.generations >= 5);
});

// -- the branch, end to end against a real core ---------------------------

/**
 * The acceptance criterion of the whole version, against a real core.
 *
 * Reading an older generation and then editing must keep the newer work. The
 * core records by appending to the working point and only rewrites it in place
 * when nothing descends from it, so selecting generation 2 and changing the
 * world there has to leave the old generation 3 and 4 in place and add a second
 * child to generation 2.
 */
test('editing after selecting an older generation forks instead of destroying', async (t) => {
  const historyPath = path.join(repoRoot, 'TEMP', 'viewer-fork-e2e.db');
  await removeStore(historyPath);

  const viewer = await startRealViewer(t, { historyPath });
  t.after(async () => {
    if (viewer.bridge.running) await viewer.bridge.stop();
    await removeStore(historyPath);
  });

  const post = async (path, body) =>
    (
      await fetch(`${viewer.url}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    ).json();
  const history = async () => (await fetch(`${viewer.url}/api/history`)).json();

  await post('/api/command', {
    cmd: 'set',
    cells: [
      [1, 0],
      [2, 1],
      [0, 2],
      [1, 2],
      [2, 2],
    ],
  });
  for (let step = 0; step < 4; step += 1) await post('/api/command', { cmd: 'step', count: 1 });

  const before = await history();
  assert.equal(before.current, 4);
  const nodeAt = (tree, generation) => tree.generations.find((row) => row.generation === generation);
  const second = nodeAt(before, 2);
  const oldThird = nodeAt(before, 3);
  const oldFourth = nodeAt(before, 4);
  assert.ok(second && oldThird && oldFourth, 'the linear run recorded generations 2, 3 and 4');
  assert.deepEqual(
    before.generations.filter((row) => row.parent === second.id).map((row) => row.id),
    [oldThird.id],
    'generation 2 starts with one child',
  );

  // Look at generation 2 and change the world there.
  const selected = await post('/api/select', { node: second.id });
  assert.equal(selected.ok, true);
  assert.equal(selected.generation, 2);
  assert.equal(selected.population, 5);
  await post('/api/command', { cmd: 'set', cells: [[40, 40]] });
  await post('/api/command', { cmd: 'step', count: 1 });

  const after = await history();
  const children = after.generations.filter((row) => row.parent === second.id);
  assert.equal(children.length, 2, 'generation 2 now has two children: the fork');
  assert.ok(
    children.some((row) => row.id === oldThird.id),
    'the branch that was recorded first is still there',
  );
  // The old branch was not truncated: generation 4 is still reachable.
  assert.ok(
    after.generations.some((row) => row.id === oldFourth.id),
    'the generations after the selected one were kept, not discarded',
  );
  // The working point is on the new branch, not on the old one.
  const head = after.generations.find((row) => row.id === after.head);
  assert.ok(head, 'the head is named');
  assert.notEqual(head.id, oldFourth.id);
  assert.ok(
    head.generation >= 2,
    `the working point is on the new branch, not the old tip (generation ${head.generation})`,
  );
});

// -- the archive manager --------------------------------------------------
//
// The manager acts on files, so these cases write real ones in the repository's
// data directory and take them away again. The names are distinctive because the
// viewer suites run alongside each other and the directory is shared.

const ARCHIVE_DIR = path.join(repoRoot, 'data');

async function seedArchive(name, generations = 3) {
  const target = path.join(ARCHIVE_DIR, name);
  const lines = ['{"kind":"header","format":"lifegame-archive","version":1}'];
  for (let index = 0; index < generations; index += 1) {
    lines.push(`{"kind":"generation","generation":${index},"storage":"delta"}`);
  }
  await writeFile(target, `${lines.join('\n')}\n`, 'utf8');
  return target;
}

function removeLater(t, ...names) {
  t.after(async () => {
    for (const name of names) await rm(path.join(ARCHIVE_DIR, name), { force: true });
  });
}

test('the archive list reports what the directory holds, and only that', async (t) => {
  await seedArchive('listable-one.jsonl', 4);
  await seedArchive('listable-two.jsonl', 0);
  await writeFile(path.join(ARCHIVE_DIR, 'not-an-archive.txt'), 'x', 'utf8');
  removeLater(t, 'listable-one.jsonl', 'listable-two.jsonl', 'not-an-archive.txt');

  const { url } = await startStubViewer(t);
  const reply = await (await fetch(`${url}/api/archives`)).json();
  assert.equal(reply.ok, true);
  assert.equal(reply.directory, 'data');

  const names = reply.archives.map((entry) => entry.name);
  assert.ok(names.includes('listable-one.jsonl'));
  assert.ok(names.includes('listable-two.jsonl'));
  assert.ok(
    !names.includes('not-an-archive.txt'),
    'a file the service would refuse to act on must not become a row',
  );

  const first = reply.archives.find((entry) => entry.name === 'listable-one.jsonl');
  assert.equal(first.generations, 4, 'the header line is not a generation');
  assert.ok(first.bytes > 0);
  assert.ok(!Number.isNaN(Date.parse(first.modified)));
});

test('an archive can be renamed, and the new name is confined like the old', async (t) => {
  await seedArchive('rename-from.jsonl', 2);
  removeLater(t, 'rename-from.jsonl', 'rename-to.jsonl');

  const { url } = await startStubViewer(t);
  const renamed = await (
    await fetch(`${url}/api/archive/rename`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'rename-from.jsonl', to: 'rename-to.jsonl' }),
    })
  ).json();
  assert.equal(renamed.ok, true);
  assert.equal(renamed.from, 'rename-from.jsonl');
  assert.equal(renamed.to, 'rename-to.jsonl');
  const listed = renamed.archives.map((entry) => entry.name);
  assert.ok(listed.includes('rename-to.jsonl'));
  assert.ok(!listed.includes('rename-from.jsonl'));

  // Renaming onto a name that exists would destroy a file, so it is refused.
  await seedArchive('rename-from.jsonl', 1);
  const collision = await fetch(`${url}/api/archive/rename`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'rename-from.jsonl', to: 'rename-to.jsonl' }),
  });
  assert.equal(collision.status, 400);
  assert.equal((await collision.json()).error, 'archive_exists');

  const missing = await fetch(`${url}/api/archive/rename`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'nothing-here.jsonl', to: 'elsewhere.jsonl' }),
  });
  assert.equal(missing.status, 404);
});

test('an archive can be deleted, and only by a name the service accepts', async (t) => {
  await seedArchive('deletable.jsonl', 1);
  const { url } = await startStubViewer(t);

  const removed = await (
    await fetch(`${url}/api/archive/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'deletable.jsonl' }),
    })
  ).json();
  assert.equal(removed.ok, true);
  assert.equal(removed.name, 'deletable.jsonl');
  await assert.rejects(() => stat(path.join(ARCHIVE_DIR, 'deletable.jsonl')));

  const again = await fetch(`${url}/api/archive/delete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'deletable.jsonl' }),
  });
  assert.equal(again.status, 404);
});

test('every archive route refuses a name that names a path', async (t) => {
  const { url, bridge } = await startStubViewer(t);
  const names = [
    '../escape.jsonl',
    '..\\escape.jsonl',
    'sub/dir.jsonl',
    'C:\\Windows\\system.jsonl',
    '/etc/passwd.jsonl',
    '\\\\server\\share\\file.jsonl',
    '%2e%2e%2fescape.jsonl',
    '..%5Cescape.jsonl',
    'run.txt',
    'run.jsonl.bak',
  ];
  for (const name of names) {
    for (const [route, body] of [
      ['import', { name }],
      ['rename', { name, to: 'safe.jsonl' }],
      ['delete', { name }],
      ['rename', { name: 'safe.jsonl', to: name }],
    ]) {
      const response = await fetch(`${url}/api/archive/${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 400, `${route} ${name} must be refused`);
      assert.equal((await response.json()).error, 'bad_request');
    }
  }
  assert.equal(bridge.calls.filter((call) => call.cmd === 'open').length, 0, 'nothing may reach the core');
});

test('an import the core cannot do is reported rather than faked', async (t) => {
  // The protocol has no command that opens an archive as a session. The route
  // forwards the one it would use and translates the core's refusal into a code
  // the page can label, instead of answering success for a world nobody loaded.
  await seedArchive('importable.jsonl', 2);
  removeLater(t, 'importable.jsonl');
  const { url, bridge } = await startStubViewer(t);

  const reply = await (
    await fetch(`${url}/api/archive/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'importable.jsonl' }),
    })
  ).json();
  assert.equal(reply.ok, false);
  assert.equal(reply.error, 'archive_import_unsupported');
  const asked = bridge.calls.filter((call) => call.cmd === 'open');
  assert.equal(asked.length, 1);
  assert.equal(
    asked[0].fields.path,
    path.join(ARCHIVE_DIR, 'importable.jsonl'),
    'the core is given a resolved path inside the repository, never the name',
  );
});

test('an import the core supports reports the new state', async (t) => {
  await seedArchive('supported.jsonl', 2);
  removeLater(t, 'supported.jsonl');
  const { url, bridge } = await startStubViewer(t, { openSupported: true });

  const reply = await (
    await fetch(`${url}/api/archive/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'supported.jsonl' }),
    })
  ).json();
  assert.equal(reply.ok, true);
  assert.equal(reply.name, 'supported.jsonl');
  assert.equal(reply.state.world.width, 64);
  assert.equal(bridge.calls.filter((call) => call.cmd === 'open').length, 1);
});

test('an import of a file that is not there is a 404, not a core call', async (t) => {
  const { url, bridge } = await startStubViewer(t, { openSupported: true });
  const response = await fetch(`${url}/api/archive/import`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'never-written.jsonl' }),
  });
  assert.equal(response.status, 404);
  assert.equal(bridge.calls.filter((call) => call.cmd === 'open').length, 0);
});

// -- the pattern library, and placing one ---------------------------------

test('GET /api/patterns lists the library by name, kind and size', async (t) => {
  const { url } = await startStubViewer(t);
  const reply = await (await fetch(`${url}/api/patterns`)).json();
  assert.equal(reply.ok, true);
  assert.equal(reply.patterns.length, 15);
  assert.deepEqual(
    reply.patterns.find((pattern) => pattern.name === 'glider'),
    { name: 'glider', kind: 'ship', width: 3, height: 3, population: 5 },
  );
  assert.ok(reply.patterns.some((pattern) => pattern.kind === 'gun'), 'a gun is in the library');
});

test('a named pattern is placed in one request and the world holds it', async (t) => {
  const viewer = await startRealViewer(t);
  const reply = await (
    await fetch(`${viewer.url}/api/pattern`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'glider', x: 10, y: 10 }),
    })
  ).json();
  assert.equal(reply.ok, true);
  assert.equal(reply.changed, 5);
  assert.equal(reply.population, 5);
  assert.equal(reply.cells, 5);
  assert.equal(reply.width, 3);
  assert.equal(reply.height, 3);

  const frame = await (await fetch(`${viewer.url}/api/frame?x0=0&y0=0&w=64&h=64`)).json();
  const cells = decodeCells(frame.frame.data)
    .map(([x, y]) => `${x},${y}`)
    .sort();
  assert.deepEqual(cells, ['10,12', '11,10', '11,12', '12,11', '12,12']);
});

test('an unknown pattern is a 404 and the world is untouched', async (t) => {
  const viewer = await startRealViewer(t);
  const response = await fetch(`${viewer.url}/api/pattern`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'no-such-pattern', x: 0, y: 0 }),
  });
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.error, 'unknown_pattern');
  const state = await (await fetch(`${viewer.url}/api/state`)).json();
  assert.equal(state.population, 0);
});

test('a placement that would leave the world is refused before the core sees it', async (t) => {
  const { url, bridge } = await startStubViewer(t);
  const response = await fetch(`${url}/api/pattern`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'block', x: 63, y: 63 }),
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error, 'bad_placement');
  assert.equal(bridge.calls.filter((call) => call.cmd === 'set').length, 0);
});

test('a placement sends one set command carrying the resolved cells', async (t) => {
  const { url, bridge } = await startStubViewer(t);
  const reply = await (
    await fetch(`${url}/api/pattern`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'block', x: 10, y: 20 }),
    })
  ).json();
  assert.equal(reply.ok, true);
  assert.equal(reply.name, 'block');
  const sets = bridge.calls.filter((call) => call.cmd === 'set');
  assert.equal(sets.length, 1);
  assert.deepEqual(sets[0].fields.cells, [
    [10, 20],
    [11, 20],
    [10, 21],
    [11, 21],
  ]);
  assert.equal(sets[0].fields.alive, true);
});

test('a packed placement above the measured crossover switches to tiled', async (t) => {
  const cells = [];
  for (let y = 0; y < 64; y += 1) {
    for (let x = 0; x < 64; x += 1) cells.push([x, y]);
  }
  const fill = Object.freeze({
    name: 'test-fill',
    kind: 'still-life',
    cells: Object.freeze(cells.map((cell) => Object.freeze(cell))),
    width: 64,
    height: 64,
  });
  const viewer = await startRealViewer(t, {}, { patterns: [fill] });

  const reply = await (
    await fetch(`${viewer.url}/api/pattern`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'test-fill', x: 0, y: 0 }),
    })
  ).json();
  assert.equal(reply.population, 4096);
  assert.equal(reply.switched, true, 'a packed population above the crossover is tiled');
  assert.equal(reply.representation, 'tiled');

  const state = await (await fetch(`${viewer.url}/api/state`)).json();
  assert.equal(state.representation, 'tiled');
  assert.equal(state.population, 4096, 'the switch preserved the world');
});

test('a spread placement above the crossover returns the storage to sparse', async (t) => {
  const cells = [];
  for (let index = 0; index < 4000; index += 1) cells.push([index * 2, index * 2]);
  const spread = Object.freeze({
    name: 'test-spread',
    kind: 'ship',
    cells: Object.freeze(cells.map((cell) => Object.freeze(cell))),
    width: 7999,
    height: 7999,
  });
  const viewer = await startRealViewer(
    t,
    { worldWidth: 8192, worldHeight: 8192, representation: 'tiled' },
    { patterns: [spread] },
  );

  const reply = await (
    await fetch(`${viewer.url}/api/pattern`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'test-spread', x: 0, y: 0 }),
    })
  ).json();
  assert.equal(reply.population, 4000);
  assert.equal(reply.switched, true, 'a spread population above the crossover is sparse');
  assert.equal(reply.representation, 'sparse');
});

// -- the library's patterns behave as their kinds say ----------------------

test('the shipped still life does not change', async (t) => {
  const viewer = await startRealViewer(t);
  await fetch(`${viewer.url}/api/pattern`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'block', x: 10, y: 10 }),
  });
  await fetch(`${viewer.url}/api/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cmd: 'step', count: 4 }),
  });
  const frame = await (await fetch(`${viewer.url}/api/frame?x0=0&y0=0&w=64&h=64`)).json();
  assert.deepEqual(
    decodeCells(frame.frame.data).map(([x, y]) => `${x},${y}`).sort(),
    ['10,10', '10,11', '11,10', '11,11'],
    'a still life is the same four cells after four generations',
  );
});

test('the shipped glider moves one cell diagonally in four generations', async (t) => {
  const viewer = await startRealViewer(t);
  await fetch(`${viewer.url}/api/pattern`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'glider', x: 10, y: 10 }),
  });
  await fetch(`${viewer.url}/api/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cmd: 'step', count: 4 }),
  });
  const frame = await (await fetch(`${viewer.url}/api/frame?x0=0&y0=0&w=64&h=64`)).json();
  assert.deepEqual(
    decodeCells(frame.frame.data).map(([x, y]) => `${x},${y}`).sort(),
    ['11,13', '12,11', '12,13', '13,12', '13,13'],
    'the glider is its own shape shifted by one cell in each axis',
  );
});

test('the shipped gun keeps emitting gliders', async (t) => {
  const viewer = await startRealViewer(t, { worldWidth: 96, worldHeight: 96 });
  const placed = await (
    await fetch(`${viewer.url}/api/pattern`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'gosper-glider-gun', x: 2, y: 2 }),
    })
  ).json();
  assert.equal(placed.population, 36);
  await fetch(`${viewer.url}/api/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cmd: 'step', count: 30 }),
  });
  const state = await (await fetch(`${viewer.url}/api/state`)).json();
  assert.ok(state.population > 36, `a gun grows its population (got ${state.population})`);
});

let sessionDirectoryCounter = 0;

/** A directory for session stores, removed after the case with retries. */
async function sessionDirectory(t) {
  sessionDirectoryCounter += 1;
  const dir = path.join(repoRoot, 'TEMP', 'viewer-sessions', `${process.pid}-${sessionDirectoryCounter}`);
  await rm(dir, { recursive: true, force: true });
  t.after(async () => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        await rm(dir, { recursive: true, force: true });
        return;
      } catch (error) {
        if (error.code !== 'EBUSY' && error.code !== 'EPERM') throw error;
        await delay(50);
      }
    }
  });
  return dir;
}

async function createSession(viewer, body = {}) {
  const response = await fetch(`${viewer.url}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ width: 64, height: 64, ...body }),
  });
  return { status: response.status, body: await response.json() };
}

test('the service lists the session it always has', async (t) => {
  const viewer = await startRealViewer(t);
  const reply = await (await fetch(`${viewer.url}/api/sessions`)).json();
  assert.equal(reply.ok, true);
  assert.equal(reply.default, 'main');
  assert.deepEqual(
    reply.sessions.map((session) => session.id),
    ['main'],
  );
});

test('a second session gets its own core, world and history', async (t) => {
  const dir = await sessionDirectory(t);
  const viewer = await startRealViewer(t, {}, { sessionHistoryDir: dir });
  const created = await createSession(viewer, { label: 'second' });
  assert.equal(created.status, 200);
  assert.match(created.body.session.id, /^s\d+$/);
  assert.equal(created.body.session.label, 'second');
  const other = created.body.session.id;

  // One world in each: a glider in the default session, a block in the other.
  await fetch(`${viewer.url}/api/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cmd: 'set', cells: [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]] }),
  });
  await fetch(`${viewer.url}/api/pattern?session=${other}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'block', x: 10, y: 10 }),
  });

  const mainState = await (await fetch(`${viewer.url}/api/state`)).json();
  const otherState = await (await fetch(`${viewer.url}/api/state?session=${other}`)).json();
  assert.equal(mainState.population, 5);
  assert.equal(otherState.population, 4);
  assert.equal(mainState.session, 'main');
  assert.equal(otherState.session, other);

  // The default session was started without a history; the created one records
  // into its own store, and a step appends to that store and not the other.
  const mainHistory = await (await fetch(`${viewer.url}/api/history`)).json();
  assert.equal(mainHistory.ok, false);
  assert.equal(mainHistory.error, 'no_history');
  const before = await (await fetch(`${viewer.url}/api/history?session=${other}`)).json();
  assert.equal(before.ok, true);
  await fetch(`${viewer.url}/api/command?session=${other}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cmd: 'step', count: 1 }),
  });
  const after = await (await fetch(`${viewer.url}/api/history?session=${other}`)).json();
  assert.equal(after.generations.length, before.generations.length + 1);

  const list = await (await fetch(`${viewer.url}/api/sessions`)).json();
  assert.deepEqual(
    list.sessions.map((session) => session.id).sort(),
    ['main', other].sort(),
  );
  assert.equal(list.sessions.find((session) => session.id === other).label, 'second');
});

test('a request naming an unknown session is refused, not served by another', async (t) => {
  const viewer = await startRealViewer(t);
  const response = await fetch(`${viewer.url}/api/state?session=nope`);
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.error, 'unknown_session');
});

test('the default session cannot be closed, and a created one can', async (t) => {
  const dir = await sessionDirectory(t);
  const viewer = await startRealViewer(t, {}, { sessionHistoryDir: dir });
  const created = await createSession(viewer);
  const other = created.body.session.id;

  const refused = await fetch(`${viewer.url}/api/sessions/close`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session: 'main' }),
  });
  assert.equal(refused.status, 400);
  assert.equal((await refused.json()).error, 'default_session');

  const closed = await fetch(`${viewer.url}/api/sessions/close`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session: other }),
  });
  assert.equal(closed.status, 200);
  assert.equal((await closed.json()).ok, true);

  const gone = await fetch(`${viewer.url}/api/state?session=${other}`);
  assert.equal(gone.status, 404);
  const list = await (await fetch(`${viewer.url}/api/sessions`)).json();
  assert.deepEqual(
    list.sessions.map((session) => session.id),
    ['main'],
  );
});

test('a representation switch continues the recorded session instead of truncating it', async (t) => {  const dir = await sessionDirectory(t);
  const viewer = await startRealViewer(t, { historyPath: path.join(dir, 'history.db') });

  // Record a few generations, then switch the storage.
  await fetch(`${viewer.url}/api/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cmd: 'set', cells: [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]] }),
  });
  await fetch(`${viewer.url}/api/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cmd: 'step', count: 3 }),
  });
  const before = await (await fetch(`${viewer.url}/api/history`)).json();
  assert.equal(before.ok, true);
  assert.ok(before.generations.length >= 3, 'the run is recorded');
  const session = before.session;

  const switched = await (
    await fetch(`${viewer.url}/api/representation`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ representation: 'tiled' }),
    })
  ).json();
  assert.equal(switched.ok, true);
  assert.equal(switched.representation, 'tiled');

  const after = await (await fetch(`${viewer.url}/api/history`)).json();
  assert.equal(after.session, session, 'the switch kept the recorded session');
  assert.equal(
    after.generations.length,
    before.generations.length,
    'and the timeline was not truncated',
  );

  // Recording continues in the same session, on the other representation.
  await fetch(`${viewer.url}/api/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cmd: 'step', count: 1 }),
  });
  const grown = await (await fetch(`${viewer.url}/api/history`)).json();
  assert.equal(grown.session, session);
  assert.equal(grown.generations.length, before.generations.length + 1);
});

test('the session cap queues a creation and reports how many are waiting', async (t) => {  const dir = await sessionDirectory(t);
  const viewer = await startStubViewer(t, {
    server: {
      maxSessions: 2,
      sessionHistoryDir: dir,
      createBridge: () => stubBridge({ history: true }),
    },
  });
  const first = await createSession(viewer);
  assert.equal(first.status, 200);
  const created = first.body.session.id;

  const list = await (await fetch(`${viewer.url}/api/sessions`)).json();
  assert.equal(list.cap, 2);
  assert.equal(list.queued, 0);
  assert.equal(list.sessions.length, 2);

  // The next creation waits rather than being refused, and the wait is visible.
  const pending = fetch(`${viewer.url}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ width: 64, height: 64 }),
  });
  await delay(50);
  const queuedList = await (await fetch(`${viewer.url}/api/sessions`)).json();
  assert.equal(queuedList.queued, 1);
  assert.equal(queuedList.sessions.length, 2);

  // Closing a session frees the slot the waiting request needed.
  await fetch(`${viewer.url}/api/sessions/close`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session: created }),
  });
  const admitted = await (await pending).json();
  assert.equal(admitted.ok, true);
  assert.match(admitted.session.id, /^s\d+$/);

  const finalList = await (await fetch(`${viewer.url}/api/sessions`)).json();
  assert.equal(finalList.queued, 0);
  assert.equal(finalList.sessions.length, 2);
});

test('a full session queue is refused with a named error', async (t) => {
  const dir = await sessionDirectory(t);
  const viewer = await startStubViewer(t, {
    server: {
      maxSessions: 2,
      maxQueuedSessions: 1,
      sessionHistoryDir: dir,
      createBridge: () => stubBridge({ history: true }),
    },
  });
  const first = await createSession(viewer);
  assert.equal(first.status, 200);
  const created = first.body.session.id;

  const list = await (await fetch(`${viewer.url}/api/sessions`)).json();
  assert.equal(list.queueCap, 1);

  const waiting = fetch(`${viewer.url}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ width: 64, height: 64 }),
  });
  await delay(50);
  const refused = await fetch(`${viewer.url}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ width: 64, height: 64 }),
  });
  assert.equal(refused.status, 503);
  assert.equal((await refused.json()).error, 'session_queue_full');

  await fetch(`${viewer.url}/api/sessions/close`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session: created }),
  });
  const admitted = await (await waiting).json();
  assert.equal(admitted.ok, true);
  assert.equal((await (await fetch(`${viewer.url}/api/sessions`)).json()).queued, 0);
});

test('a recorded world is saved to an archive and loaded back through the service', async (t) => {
  const dir = await sessionDirectory(t);
  const viewer = await startRealViewer(t, { historyPath: path.join(dir, 'history.db') });
  const name = `save-load-${process.pid}.jsonl`;
  const archivePath = path.join(repoRoot, 'data', name);
  t.after(async () => {
    await rm(archivePath, { force: true });
  });

  await fetch(`${viewer.url}/api/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cmd: 'set', cells: [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]] }),
  });
  await fetch(`${viewer.url}/api/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cmd: 'step', count: 3 }),
  });
  const before = await (await fetch(`${viewer.url}/api/state`)).json();

  const saved = await (
    await fetch(`${viewer.url}/api/archive`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    })
  ).json();
  assert.equal(saved.ok, true);
  assert.ok(saved.generations >= 3, 'the session was written to the file');

  const loaded = await (
    await fetch(`${viewer.url}/api/archive/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    })
  ).json();
  assert.equal(loaded.ok, true, loaded.message ?? 'the archive was loaded');
  assert.equal(Number.isInteger(loaded.session), true, 'the core opened it as a new session');

  const after = await (await fetch(`${viewer.url}/api/state`)).json();
  assert.equal(after.generation, before.generation, 'the loaded world is the saved generation');
  assert.equal(after.population, before.population, 'with the same live cells');
});

test('GET /api/capabilities names the editing surfaces without copying the protocol', async (t) => {
  const { url } = await startStubViewer(t);
  const reply = await (await fetch(`${url}/api/capabilities`)).json();
  assert.equal(reply.ok, true);
  assert.equal(reply.session, 'main');
  assert.equal(reply.surfaces.command, '/api/command');
  assert.equal(reply.surfaces.sessions, '/api/sessions');
  assert.equal(reply.surfaces.snippets, '/api/snippets');
  assert.equal(reply.surfaces.editTransaction, '/api/edit/transaction');
  assert.equal(reply.sessions.cap, 64);
  assert.equal(reply.sessions.default, 'main');
  assert.deepEqual(reply.focus, { shareable: 'url', parameter: 'focus' });
  assert.equal(reply.editing.mode, 'implemented');
  assert.equal(reply.editing.limits.side, 256);
  assert.equal(reply.history, false);
});

test('the editing routes pause the world, commit, undo, redo and resume', async (t) => {
  const dir = await sessionDirectory(t);
  const viewer = await startRealViewer(t, { historyPath: path.join(dir, 'edit.db') });
  const post = (route, body = {}) =>
    fetch(`${viewer.url}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  await post('/api/command', { cmd: 'run', tps: 5 });
  assert.equal((await (await fetch(`${viewer.url}/api/state`)).json()).running, true);

  const entered = await (await post('/api/edit/enter')).json();
  assert.equal(entered.ok, true);
  assert.equal(entered.editMode, true);
  assert.equal(entered.version, 0);
  const pausedState = await (await fetch(`${viewer.url}/api/state`)).json();
  assert.equal(pausedState.running, false, 'entering the mode pauses the world');
  const generation = pausedState.generation;

  const refused = await post('/api/command', { cmd: 'step' });
  assert.equal(refused.status, 409);
  assert.equal((await refused.json()).error, 'edit_active');

  const view = await (await fetch(`${viewer.url}/api/edit`)).json();
  const transaction = await (
    await post('/api/edit/transaction', {
      txId: 'tx-1',
      baseVersion: 0,
      baseHash: view.hash,
      author: 'test',
      ops: [{ kind: 'set', alive: true, cells: [[1, 1], [2, 2]] }],
    })
  ).json();
  assert.equal(transaction.ok, true);
  assert.deepEqual(transaction.patch, {
    born: [
      [1, 1],
      [2, 2],
    ],
    died: [],
  });
  assert.equal(transaction.version, 1);
  const state = await (await fetch(`${viewer.url}/api/state`)).json();
  assert.equal(state.population, 2);
  assert.equal(state.generation, generation, 'an edit does not step');

  const undone = await (await post('/api/edit/undo')).json();
  assert.equal(undone.ok, true);
  assert.equal((await (await fetch(`${viewer.url}/api/state`)).json()).population, 0);
  const redone = await (await post('/api/edit/redo')).json();
  assert.equal(redone.ok, true);
  assert.equal((await (await fetch(`${viewer.url}/api/state`)).json()).population, 2);

  const resync = await (await fetch(`${viewer.url}/api/edit/state?since=1`)).json();
  assert.equal(resync.editMode, true);
  assert.equal(resync.patches.length, 2, 'the undo and the redo are in the window');

  const left = await (await post('/api/edit/leave')).json();
  assert.equal(left.resumed, true);
  assert.equal((await (await fetch(`${viewer.url}/api/state`)).json()).running, true);
});

test('a transaction fills a box and merges into it, and one transaction is one history edit', async (t) => {
  const dir = await sessionDirectory(t);
  const viewer = await startRealViewer(t, { historyPath: path.join(dir, 'fill.db') });
  const post = (route, body = {}) =>
    fetch(`${viewer.url}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  await post('/api/edit/enter');
  const entered = await (await fetch(`${viewer.url}/api/edit`)).json();
  const before = await (await fetch(`${viewer.url}/api/history`)).json();

  const first = await (
    await post('/api/edit/transaction', {
      txId: 'seed',
      baseVersion: entered.version,
      baseHash: entered.hash,
      author: 'test',
      ops: [{ kind: 'set', alive: true, cells: [[1, 1], [2, 2]] }],
    })
  ).json();
  assert.equal(first.ok, true);
  assert.deepEqual(first.patch.born, [[1, 1], [2, 2]]);

  const view = await (await fetch(`${viewer.url}/api/edit`)).json();
  const filled = await (
    await post('/api/edit/transaction', {
      txId: 'fill',
      baseVersion: view.version,
      baseHash: view.hash,
      author: 'test',
      ops: [
        {
          kind: 'fill',
          box: { x: 0, y: 0, w: 3, h: 3 },
          cells: [[0, 0], [1, 0]],
          mode: 'overwrite',
        },
      ],
    })
  ).json();
  assert.equal(filled.ok, true);
  assert.deepEqual(filled.patch, {
    born: [[0, 0], [1, 0]],
    died: [[1, 1], [2, 2]],
  });
  assert.equal((await (await fetch(`${viewer.url}/api/state`)).json()).population, 2);

  const after = await (await fetch(`${viewer.url}/api/history`)).json();
  assert.equal(
    after.generations.length,
    before.generations.length,
    'one transaction amends the current node; it does not append a generation',
  );
  assert.notEqual(filled.hash, first.hash, 'the version chain advanced');

  const view2 = await (await fetch(`${viewer.url}/api/edit`)).json();
  const merged = await (
    await post('/api/edit/transaction', {
      txId: 'merge',
      baseVersion: view2.version,
      baseHash: view2.hash,
      author: 'test',
      ops: [
        {
          kind: 'fill',
          box: { x: 4, y: 4, w: 2, h: 2 },
          cells: [[0, 0]],
          mode: 'merge',
        },
      ],
    })
  ).json();
  assert.equal(merged.ok, true);
  assert.deepEqual(merged.patch, { born: [[4, 4]], died: [] }, 'merge lights and kills nothing');

  await post('/api/edit/leave');
});

test('the published snippet library answers publish, list, read and delete', async (t) => {
  const dir = await sessionDirectory(t);
  const { url } = await startStubViewer(t, { server: { snippetsDir: path.join(dir, 'snippets') } });
  const publish = (body) =>
    fetch(`${url}/api/snippets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  const created = await (
    await publish({ name: 'block', width: 2, height: 2, cells: [[0, 0], [1, 0], [0, 1], [1, 1]] })
  ).json();
  assert.equal(created.ok, true);
  assert.equal(created.snippet.name, 'block');
  assert.match(created.snippet.hash, /^[0-9a-f]{64}$/);

  const list = await (await fetch(`${url}/api/snippets`)).json();
  assert.equal(list.snippets.length, 1);
  assert.equal(list.snippets[0].name, 'block');
  assert.equal(list.snippets[0].cellCount, 4);

  const read = await (await fetch(`${url}/api/snippets/block`)).json();
  assert.equal(read.ok, true);
  assert.equal(read.snippet.width, 2);
  assert.deepEqual(read.snippet.cells, [[0, 0], [1, 0], [0, 1], [1, 1]]);

  const conflict = await publish({ name: 'block', width: 1, height: 1, cells: [[0, 0]] });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error, 'name_conflict');

  const replaced = await (
    await publish({ name: 'block', width: 1, height: 1, cells: [[0, 0]], expectedHash: created.snippet.hash })
  ).json();
  assert.equal(replaced.ok, true);
  assert.notEqual(replaced.snippet.hash, created.snippet.hash);

  const removed = await fetch(`${url}/api/snippets/block`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedHash: replaced.snippet.hash }),
  });
  assert.equal(removed.status, 200);
  const gone = await fetch(`${url}/api/snippets/block`);
  assert.equal(gone.status, 404);
  assert.equal((await gone.json()).error, 'unknown_snippet');
});

test('a malformed or oversized snippet is refused with its named code', async (t) => {
  const dir = await sessionDirectory(t);
  const { url } = await startStubViewer(t, { server: { snippetsDir: path.join(dir, 'snippets') } });
  const publish = (body) =>
    fetch(`${url}/api/snippets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  const badName = await publish({ name: '../block', width: 1, height: 1, cells: [] });
  assert.equal(badName.status, 400);
  assert.equal((await badName.json()).error, 'invalid_name');

  const tooLarge = await publish({ name: 'big', width: 257, height: 1, cells: [] });
  assert.equal(tooLarge.status, 413);
  assert.equal((await tooLarge.json()).error, 'too_large');

  const badCell = await publish({ name: 'bad', width: 2, height: 2, cells: [[2, 0]] });
  assert.equal(badCell.status, 400);
});

test('presence is listed, broadcast and cleared when the mode closes', async (t) => {
  const dir = await sessionDirectory(t);
  const viewer = await startRealViewer(t, { historyPath: path.join(dir, 'history.db') });
  const stream = await openEventStream(`${viewer.url}/api/events?x0=0&y0=0&w=16&h=16`, t);
  await waitForEvent(stream, 'hello');

  const entered = await (
    await fetch(`${viewer.url}/api/edit/enter`, { method: 'POST' })
  ).json();
  assert.equal(entered.ok, true);

  const posted = await (
    await fetch(`${viewer.url}/api/edit/presence`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        clientId: 'client-b',
        author: 'B',
        cursor: [3, 4],
        selection: { x: 1, y: 2, w: 3, h: 4 },
        view: { x0: 0, y0: 0, span: 64 },
      }),
    })
  ).json();
  assert.equal(posted.ok, true);
  const broadcast = await waitForEvent(
    stream,
    'presence',
    8000,
    (entry) => entry.json.clientId === 'client-b',
  );
  assert.deepEqual(broadcast.json.cursor, [3, 4]);
  assert.deepEqual(broadcast.json.selection, { x: 1, y: 2, w: 3, h: 4 });

  const listed = await (await fetch(`${viewer.url}/api/edit/presence`)).json();
  assert.equal(listed.presence.length, 1);
  assert.equal(listed.presence[0].author, 'B');

  await fetch(`${viewer.url}/api/edit/presence`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientId: 'client-b', leaving: true }),
  });
  const afterLeaving = await (await fetch(`${viewer.url}/api/edit/presence`)).json();
  assert.deepEqual(afterLeaving.presence, []);

  await fetch(`${viewer.url}/api/edit/leave`, { method: 'POST' });
  const refused = await fetch(`${viewer.url}/api/edit/presence`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientId: 'client-b' }),
  });
  assert.equal(refused.status, 409);
  assert.equal((await refused.json()).error, 'not_editing');
});

test('two clients merge concurrent transactions and an undo keeps the later author', async (t) => {
  const dir = await sessionDirectory(t);
  const viewer = await startRealViewer(t, { historyPath: path.join(dir, 'history.db') });
  const first = await openEventStream(`${viewer.url}/api/events?x0=0&y0=0&w=16&h=16`, t);
  const second = await openEventStream(`${viewer.url}/api/events?x0=0&y0=0&w=16&h=16`, t);
  await waitForEvent(first, 'hello');
  await waitForEvent(second, 'hello');

  const entered = await (
    await fetch(`${viewer.url}/api/edit/enter`, { method: 'POST' })
  ).json();
  assert.equal(entered.ok, true);
  const start = await (await fetch(`${viewer.url}/api/edit/state`)).json();

  const commit = async (body) => {
    const response = await fetch(`${viewer.url}/api/edit/transaction`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return response.json();
  };

  // Two authors built against the same base: A's write lands, B's is rebased.
  const a = await commit({
    txId: 'a',
    baseVersion: start.version,
    baseHash: start.hash,
    author: 'A',
    ops: [{ kind: 'set', alive: true, cells: [[1, 1], [2, 2]] }],
  });
  assert.equal(a.ok, true);
  assert.equal(a.rebased, false);
  const b = await commit({
    txId: 'b',
    baseVersion: start.version,
    baseHash: start.hash,
    author: 'B',
    ops: [{ kind: 'set', alive: true, cells: [[3, 3]] }],
  });
  assert.equal(b.ok, true);
  assert.equal(b.rebased, true, 'the stale base was rebased, not refused');

  // The same transaction reaches both clients with the same version and hash.
  const firstEvent = await waitForEvent(first, 'patch', 8000, (entry) => entry.json.txId === 'a');
  const secondEvent = await waitForEvent(second, 'patch', 8000, (entry) => entry.json.txId === 'a');
  assert.equal(firstEvent.json.version, secondEvent.json.version);
  assert.equal(firstEvent.json.hash, secondEvent.json.hash);

  const afterBoth = await (await fetch(`${viewer.url}/api/edit/state`)).json();
  assert.equal(afterBoth.version, start.version + 2);

  // An overlapping write by a third author, built on the current version.
  const overlap = await commit({
    txId: 'c',
    baseVersion: afterBoth.version,
    baseHash: afterBoth.hash,
    author: 'C',
    ops: [{ kind: 'set', alive: false, cells: [[1, 1]] }],
  });
  assert.equal(overlap.ok, true);

  // A undoes its own transaction; its cell (2, 2) is reversed, but (1, 1),
  // which C wrote later, keeps the newer value.
  const undone = await (
    await fetch(`${viewer.url}/api/edit/undo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ txId: 'a', author: 'A' }),
    })
  ).json();
  assert.equal(undone.ok, true);
  assert.equal(undone.kind, 'undo');
  assert.equal(undone.of, 'a');
  assert.equal(undone.author, 'A');
  assert.deepEqual(undone.patch.died, [[2, 2]]);
  const undoEvent = await waitForEvent(first, 'patch', 8000, (entry) => entry.json.of === 'a');
  assert.equal(undoEvent.json.author, 'A');
  assert.equal(undoEvent.json.kind, 'undo');

  const cells = await (await fetch(`${viewer.url}/api/cells`)).json();
  assert.deepEqual(
    decodeCells(cells.cells).map(([x, y]) => [x, y]),
    [[3, 3]],
    'only the cell no later author touched survives the undo',
  );
  const final = await (await fetch(`${viewer.url}/api/edit/state`)).json();
  assert.equal(final.version, start.version + 4);
});
