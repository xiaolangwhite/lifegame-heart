/**
 * CoreBridge against the real Python world core.
 *
 * Nothing here is mocked: every assertion is made against a child process
 * running `python -m lifegame.world`, so the tests fail if the protocol moves
 * under the bridge. The two frame decoders below are the client half of the
 * encodings defined in src/lifegame/world/bridge.py.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { rm } from 'node:fs/promises';

import {
  CoreBridge,
  CoreUnavailableError,
  coreArguments,
  defaultPythonPath,
  repoRoot,
} from '../bridge.mjs';

const pythonPath = defaultPythonPath();

/**
 * Remove a store, tolerating a file the core still holds.
 *
 * `TEMP/` is ignored by git, and a cleanup that throws turns a passing test into
 * a failing one for no reason a reader could act on.
 */
async function removeStore(target) {
  try {
    await rm(target, { force: true });
  } catch {
    // Still held by a child that is on its way out.
  }
}

/** Decode the `cells` encoding: little-endian int32 pairs, absolute x then y. */
function decodeCells(base64) {
  const buffer = Buffer.from(base64, 'base64');
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const cells = [];
  for (let offset = 0; offset + 8 <= buffer.byteLength; offset += 8) {
    cells.push([view.getInt32(offset, true), view.getInt32(offset + 4, true)]);
  }
  return cells;
}

/** Decode the `bits` encoding: row-major, one bit per cell, high bit first. */
function decodeBits(base64, width, height) {
  const buffer = Buffer.from(base64, 'base64');
  const stride = Math.ceil(width / 8);
  const cells = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const byte = buffer[y * stride + (x >> 3)];
      if ((byte >> (7 - (x & 7))) & 1) cells.push([x, y]);
    }
  }
  return cells;
}

const sortCells = (cells) => cells.map(([x, y]) => `${x},${y}`).sort();

/** The glider, and the bounding box it has after four generations. */
const GLIDER = [
  [1, 0],
  [2, 1],
  [0, 2],
  [1, 2],
  [2, 2],
];

function makeBridge(overrides = {}) {
  return new CoreBridge({
    pythonPath,
    worldWidth: 64,
    worldHeight: 64,
    ...overrides,
  });
}

async function waitFor(predicate, timeoutMs = 5000, label = 'condition') {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${label}`);
}

test('the spawn arguments carry no copy of the core\'s defaults', () => {
  // The world size is the core's to declare. Omitting the flag is how the bridge
  // avoids holding a second copy of the design target, so the absence is the
  // assertion.
  const bare = coreArguments({ representation: 'sparse' });
  assert.deepEqual(bare, ['-m', 'lifegame.world', '--representation', 'sparse']);
  assert.ok(!bare.includes('--width'));
  assert.ok(!bare.includes('--height'));
  assert.ok(!bare.includes('--history'));

  const sized = coreArguments({
    worldWidth: 64,
    worldHeight: 32,
    representation: 'tiled',
    historyPath: 'data/history.db',
  });
  assert.deepEqual(sized, [
    '-m',
    'lifegame.world',
    '--representation',
    'tiled',
    '--width',
    '64',
    '--height',
    '32',
    '--history',
    'data/history.db',
  ]);
});

test('the bridge learns the representations from the core, not from a list', async (t) => {
  const bridge = makeBridge();
  t.after(() => bridge.stop());

  assert.deepEqual(bridge.representations, [], 'nothing is known before the first hello');
  await bridge.request('hello');
  assert.deepEqual(bridge.representations, ['sparse', 'tiled']);
  assert.deepEqual(bridge.limits.ticksPerSecond, { min: 1, max: 60 });

  // A name the core does not offer is refused before the child is disturbed.
  await assert.rejects(() => bridge.restart({ representation: 'quantum' }), RangeError);
  assert.equal(bridge.running, true, 'a refused switch must not stop the core');
});

test('a history path makes the core record the run', async (t) => {
  const historyPath = path.join(repoRoot, 'TEMP', 'bridge-history-test.db');
  await removeStore(historyPath);
  const bridge = makeBridge({ historyPath });
  t.after(async () => {
    if (bridge.running) await bridge.stop();
    await removeStore(historyPath);
  });

  const hello = await bridge.request('hello');
  assert.equal(hello.history, true, 'a core started with a history must say so');

  await bridge.request('set', { cells: GLIDER });
  await bridge.request('step', { count: 1 });
  const timeline = await bridge.request('history');
  assert.equal(timeline.ok, true);
  assert.ok(timeline.count >= 2, `expected the recorded generations, got ${timeline.count}`);
  assert.equal(timeline.current, 1);

  const rolled = await bridge.request('rollback', { generation: 0 });
  assert.equal(rolled.ok, true);
  assert.equal(rolled.generation, 0);
});

test('a core without a history refuses the timeline commands', async (t) => {
  const bridge = makeBridge();
  t.after(() => bridge.stop());

  const hello = await bridge.request('hello');
  assert.equal(hello.history, false);
  const refused = await bridge.request('history');
  assert.equal(refused.ok, false);
  assert.match(refused.message, /without a history/);
});

test('hello reports the protocol, the world and the rule', async (t) => {
  const bridge = makeBridge();
  t.after(() => bridge.stop());

  const reply = await bridge.request('hello');
  assert.equal(reply.ok, true);
  assert.equal(reply.id, 1);
  assert.equal(reply.protocol, 1);
  assert.deepEqual(reply.world, { width: 64, height: 64 });
  assert.equal(reply.rule, 'B3/S23');
  assert.equal(reply.running, false);
  assert.equal(reply.tps, 10);
});

test('set, toggle, step and state agree on population and generation', async (t) => {
  const bridge = makeBridge();
  t.after(() => bridge.stop());

  const set = await bridge.request('set', { cells: GLIDER, alive: true });
  assert.equal(set.ok, true);
  assert.equal(set.changed, 5);
  assert.equal(set.population, 5);

  const toggledOff = await bridge.request('toggle', { x: 1, y: 0 });
  assert.equal(toggledOff.alive, false);
  assert.equal(toggledOff.population, 4);
  const toggledOn = await bridge.request('toggle', { x: 1, y: 0 });
  assert.equal(toggledOn.alive, true);
  assert.equal(toggledOn.population, 5);

  const stepped = await bridge.request('step', { count: 1 });
  assert.equal(stepped.generation, 1);
  assert.equal(stepped.population, 5);
  assert.equal(typeof stepped.changed, 'number');

  const state = await bridge.request('state');
  assert.equal(state.generation, 1);
  assert.equal(state.population, 5);
  // Generation 1 of this glider is (2,1), (1,2), (2,2), (0,1), (1,3) — verified
  // by hand from the rule — so its bounding box is (0, 1) .. (2, 3).
  assert.deepEqual(state.bounds, [0, 1, 2, 3]);
});

test('a glider translated by four steps has the expected bounds', async (t) => {
  const bridge = makeBridge();
  t.after(() => bridge.stop());

  await bridge.request('set', { cells: GLIDER, alive: true });
  const stepped = await bridge.request('step', { count: 4 });
  assert.equal(stepped.generation, 4);
  assert.equal(stepped.population, 5);

  const state = await bridge.request('state');
  assert.deepEqual(state.bounds, [1, 1, 3, 3]);
});

test('clear resets the generation and the population', async (t) => {
  const bridge = makeBridge();
  t.after(() => bridge.stop());

  await bridge.request('set', { cells: GLIDER, alive: true });
  await bridge.request('step', { count: 3 });
  const cleared = await bridge.request('clear');
  assert.deepEqual(cleared, { ok: true, generation: 0, population: 0, id: cleared.id });

  const state = await bridge.request('state');
  assert.equal(state.population, 0);
  assert.equal(state.bounds, null);
});

test('a sparse frame uses the cells encoding and carries absolute coordinates', async (t) => {
  const bridge = makeBridge();
  t.after(() => bridge.stop());

  const pattern = [
    [10, 12],
    [11, 12],
    [12, 12],
  ];
  await bridge.request('set', { cells: pattern, alive: true });

  const reply = await bridge.request('frame', { x0: 0, y0: 0, w: 64, h: 64 });
  assert.equal(reply.ok, true);
  const frame = reply.frame;
  assert.equal(frame.format, 'cells');
  assert.equal(frame.x0, 0);
  assert.equal(frame.y0, 0);
  assert.equal(frame.w, 64);
  assert.equal(frame.h, 64);
  assert.equal(frame.generation, 0);
  assert.equal(frame.population, 3);
  assert.deepEqual(sortCells(decodeCells(frame.data)), sortCells(pattern));
});

test('a dense frame uses the bits encoding and agrees cell for cell', async (t) => {
  const bridge = makeBridge();
  t.after(() => bridge.stop());

  // The encoder prefers `cells` while `live * 32 <= (w + 7) / 8 * h`, which for
  // a 64x64 rectangle means up to 16 live cells. Four hundred live cells are
  // therefore well past the tipping point.
  const block = [];
  for (let y = 0; y < 20; y += 1) {
    for (let x = 0; x < 20; x += 1) block.push([x, y]);
  }
  await bridge.request('set', { cells: block, alive: true });

  const reply = await bridge.request('frame', { x0: 0, y0: 0, w: 64, h: 64 });
  const frame = reply.frame;
  assert.equal(frame.format, 'bits');
  assert.deepEqual(sortCells(decodeBits(frame.data, frame.w, frame.h)), sortCells(block));
});

test('a frame is relative to its own origin in bits and absolute in cells', async (t) => {
  const bridge = makeBridge();
  t.after(() => bridge.stop());

  await bridge.request('set', { cells: [[30, 31]], alive: true });
  const sparse = await bridge.request('frame', { x0: 20, y0: 20, w: 32, h: 32 });
  assert.equal(sparse.frame.format, 'cells');
  assert.deepEqual(decodeCells(sparse.frame.data), [[30, 31]]);

  const block = [];
  for (let y = 20; y < 40; y += 1) {
    for (let x = 20; x < 40; x += 1) block.push([x, y]);
  }
  await bridge.request('clear');
  await bridge.request('set', { cells: block, alive: true });
  const dense = await bridge.request('frame', { x0: 20, y0: 20, w: 32, h: 32 });
  assert.equal(dense.frame.format, 'bits');
  const decoded = decodeBits(dense.frame.data, dense.frame.w, dense.frame.h);
  assert.equal(decoded.length, 400);
  assert.deepEqual(decoded[0], [0, 0]);
  assert.deepEqual(decoded[decoded.length - 1], [19, 19]);
});

test('protocol errors are reported, not thrown', async (t) => {
  const bridge = makeBridge();
  t.after(() => bridge.stop());

  const unknown = await bridge.request('explode');
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error, 'unknown_command');
  assert.equal(typeof unknown.message, 'string');

  const outOfBounds = await bridge.request('toggle', { x: 999, y: 0 });
  assert.equal(outOfBounds.ok, false);
  assert.equal(outOfBounds.error, 'out_of_bounds');

  const badArguments = await bridge.request('step', { count: 'many' });
  assert.equal(badArguments.ok, false);
  assert.equal(badArguments.error, 'bad_arguments');

  const stillAlive = await bridge.request('state');
  assert.equal(stillAlive.ok, true);
});

test('concurrent requests are serialized without losing any', async (t) => {
  const bridge = makeBridge();
  t.after(() => bridge.stop());

  await bridge.request('clear');

  // Sample the in-flight count while five requests are outstanding. The bridge
  // queues them, so the count must never exceed one; the generation check below
  // proves the queue also did not drop any.
  let maxPending = 0;
  const sampler = setInterval(() => {
    maxPending = Math.max(maxPending, bridge.stats().pending);
  }, 1);

  const replies = await Promise.all([1, 2, 3, 4, 5].map(() => bridge.request('step', { count: 1 })));
  clearInterval(sampler);
  for (const reply of replies) assert.equal(reply.ok, true);
  assert.ok(maxPending <= 1, `at most one request may be in flight, saw ${maxPending}`);

  const state = await bridge.request('state');
  assert.equal(state.generation, 5, 'every queued step must have been applied');
});

test('run and pause drive the tick event without an id', async (t) => {
  const bridge = makeBridge();
  t.after(() => bridge.stop());

  await bridge.request('set', { cells: GLIDER, alive: true });
  const ticks = [];
  bridge.onEvent((event) => {
    if (event.event === 'tick') ticks.push(event);
  });

  const started = await bridge.request('run', { tps: 20 });
  assert.equal(started.running, true);
  assert.equal(started.tps, 20);
  await waitFor(() => ticks.length >= 2, 4000, 'two tick events');
  for (const tick of ticks) {
    assert.equal(typeof tick.generation, 'number');
    assert.equal(typeof tick.population, 'number');
    assert.equal('id' in tick, false);
  }

  const paused = await bridge.request('pause');
  assert.equal(paused.running, false);
  const seen = ticks.length;
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(ticks.length, seen, 'no tick may arrive after pause');
});

test('quit ends the child process', async (t) => {
  const bridge = makeBridge();
  t.after(() => bridge.stop());

  await bridge.request('hello');
  const pid = bridge.pid;
  assert.ok(pid > 0);

  const reply = await bridge.request('quit');
  assert.equal(reply.bye, true);
  await waitFor(() => !bridge.running, 5000, 'the core to exit');
});

test('a crashed core is restarted transparently', async (t) => {
  const bridge = makeBridge();
  t.after(() => bridge.stop());

  await bridge.request('set', { cells: GLIDER, alive: true });
  const firstPid = bridge.pid;
  process.kill(firstPid);
  await waitFor(() => !bridge.running, 5000, 'the crashed core to be reaped');

  const reply = await bridge.request('state');
  assert.equal(reply.ok, true);
  assert.notEqual(bridge.pid, firstPid, 'a fresh child must serve the request');
  assert.equal(reply.population, 0, 'a restarted core starts from an empty world');
});

test('a core that keeps crashing is not restarted forever', async (t) => {
  // package.json exists but is not an executable: the child fails immediately.
  const bridge = makeBridge({
    pythonPath: path.join(repoRoot, 'package.json'),
    crashLimit: 2,
    restartBaseDelayMs: 5,
  });
  t.after(() => bridge.stop());

  await assert.rejects(() => bridge.request('hello'), CoreUnavailableError);
  await assert.rejects(() => bridge.request('hello'), CoreUnavailableError);
  await assert.rejects(
    () => bridge.request('hello'),
    (error) => {
      assert.ok(error instanceof CoreUnavailableError);
      assert.match(error.message, /refusing to restart/);
      return true;
    },
  );
});

test('a missing interpreter names the bootstrap command', async (t) => {
  const bridge = makeBridge({
    pythonPath: path.join(repoRoot, '.venv', 'Scripts', 'python-that-is-not-there.exe'),
  });
  t.after(() => bridge.stop());

  await assert.rejects(
    () => bridge.request('hello'),
    (error) => {
      assert.ok(error instanceof CoreUnavailableError);
      assert.match(error.message, /interpreter is missing/);
      assert.match(error.message, /scripts\/bootstrap\.ps1/);
      return true;
    },
  );
});
