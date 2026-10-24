/**
 * The editing runtime against a scripted core: enter/leave, the transaction
 * path, undo/redo and the resync view.
 *
 * The fake core keeps a set of live cells and answers `state`, `export`, `pause`,
 * `run` and `patch` exactly as the protocol documents them. It filters the
 * candidate patch to the cells that actually changed, which is the behaviour the
 * runtime must record rather than the candidate it sent.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEditRuntime } from '../edit-runtime.mjs';

function fakeCore({ cells = [], generation = 0, running = false, tps = 10 } = {}) {
  const world = new Map(cells.map(([x, y]) => [`${x},${y}`, true]));
  const calls = [];
  let isRunning = running;
  let currentTps = tps;
  const ask = async (cmd, payload = {}) => {
    calls.push([cmd, payload]);
    if (cmd === 'state') {
      return {
        ok: true,
        generation,
        population: world.size,
        running: isRunning,
        tps: currentTps,
        world: { width: 64, height: 64 },
      };
    }
    if (cmd === 'pause') {
      isRunning = false;
      return { ok: true, running: false, generation };
    }
    if (cmd === 'run') {
      isRunning = true;
      currentTps = payload.tps ?? currentTps;
      return { ok: true, running: true, tps: currentTps, generation };
    }
    if (cmd === 'export') {
      return {
        ok: true,
        export: {
          format: 'cells',
          data: `payload-${world.size}-${generation}`,
          population: world.size,
          generation,
        },
      };
    }
    if (cmd === 'patch') {
      if (payload.expectGeneration !== generation) {
        return { ok: false, error: 'stale_generation', message: 'the world moved' };
      }
      const born = [];
      const died = [];
      for (const [x, y] of payload.born) {
        const key = `${x},${y}`;
        if (!world.has(key)) {
          world.set(key, true);
          born.push([x, y]);
        }
      }
      for (const [x, y] of payload.died) {
        const key = `${x},${y}`;
        if (world.delete(key)) died.push([x, y]);
      }
      return { ok: true, generation, population: world.size, born, died };
    }
    throw new Error(`unexpected command ${cmd}`);
  };
  return { ask, calls, world, running: () => isRunning };
}

function runtimeFor(core) {
  const events = [];
  const invalidations = [];
  const runtime = createEditRuntime({
    id: 'main',
    ask: core.ask,
    broadcast: (event, payload) => events.push([event, payload]),
    invalidate: () => invalidations.push(true),
    author: 'page',
  });
  return { runtime, events, invalidations };
}

function setOp(cells, alive = true) {
  return { kind: 'set', alive, cells };
}

test('entering pauses a running world and leaving resumes it', async () => {
  const core = fakeCore({ cells: [[1, 1]], running: true, tps: 20 });
  const { runtime } = runtimeFor(core);
  const entered = await runtime.enter();
  assert.equal(entered.ok, true);
  assert.equal(entered.editMode, true);
  assert.equal(entered.version, 0);
  assert.equal(core.running(), false, 'the world was paused');
  assert.deepEqual(
    core.calls.map(([cmd]) => cmd),
    ['state', 'pause', 'export'],
  );

  const left = await runtime.leave();
  assert.equal(left.editMode, false);
  assert.equal(left.resumed, true);
  assert.equal(core.running(), true);
  assert.deepEqual(core.calls[core.calls.length - 1], ['run', { tps: 20 }]);
});

test('a transaction records the cells the core actually changed', async () => {
  const core = fakeCore({ cells: [[1, 1]] });
  const { runtime, events, invalidations } = runtimeFor(core);
  await runtime.enter();

  const reply = await runtime.commit({
    txId: 't1',
    baseVersion: 0,
    baseHash: runtime.view().hash,
    ops: [setOp([[1, 1], [2, 2]])],
    author: 'page',
  });
  assert.equal(reply.ok, true);
  assert.equal(reply.version, 1);
  assert.deepEqual(reply.patch, { born: [[2, 2]], died: [] }, 'the no-op cell is not recorded');
  assert.equal(events.length, 1);
  assert.equal(events[0][0], 'patch');
  assert.equal(events[0][1].version, 1);
  assert.equal(invalidations.length, 1);

  const undone = await runtime.undo({ author: 'page' });
  assert.equal(undone.ok, true);
  assert.equal(undone.version, 2);
  assert.deepEqual(undone.patch, { born: [], died: [[2, 2]] });
  assert.equal(core.world.has('2,2'), false);

  const redone = await runtime.redo({ author: 'page' });
  assert.equal(redone.ok, true);
  assert.equal(redone.version, 3);
  assert.deepEqual(redone.patch, { born: [[2, 2]], died: [] });
  assert.equal(core.world.has('2,2'), true);
});

test('a duplicate id or a stale base is refused before the core is written', async () => {
  const core = fakeCore();
  const { runtime } = runtimeFor(core);
  await runtime.enter();
  await runtime.commit({
    txId: 't1',
    baseVersion: 0,
    baseHash: runtime.view().hash,
    ops: [setOp([[1, 1]])],
    author: 'page',
  });
  const callsBefore = core.calls.length;
  await assert.rejects(
    runtime.commit({
      txId: 't1',
      baseVersion: 1,
      baseHash: runtime.view().hash,
      ops: [setOp([[2, 2]])],
      author: 'page',
    }),
    (error) => error.code === 'duplicate_tx',
  );
  await assert.rejects(
    runtime.commit({
      txId: 't2',
      baseVersion: 0,
      baseHash: 'stale',
      ops: [{ ...setOp([[3, 3]]), rebaseable: false }],
      author: 'page',
    }),
    (error) => error.code === 'stale_base',
  );
  assert.equal(core.calls.length, callsBefore, 'neither refusal reached the core');
});

test('the resync view answers inside the window and reports full outside it', async () => {
  const core = fakeCore();
  const { runtime } = runtimeFor(core);
  await runtime.enter();
  await runtime.commit({
    txId: 't1',
    baseVersion: 0,
    baseHash: runtime.view().hash,
    ops: [setOp([[1, 1]])],
    author: 'page',
  });
  const fromStart = runtime.state(0);
  assert.equal(fromStart.patches.length, 1);
  assert.equal(fromStart.patches[0].txId, 't1');
  assert.deepEqual(runtime.state(1).patches, []);
  const beyond = runtime.state(99);
  assert.equal(beyond.full, true);
  assert.equal(beyond.version, 1);
});

test('a transaction without the mode is refused', async () => {
  const core = fakeCore();
  const { runtime } = runtimeFor(core);
  await assert.rejects(
    runtime.commit({
      txId: 't1',
      baseVersion: 0,
      baseHash: 'x',
      ops: [setOp([[1, 1]])],
      author: 'page',
    }),
    (error) => error.code === 'not_editing',
  );
});

test('presence is validated, broadcast, listed and cleared with the mode', async () => {
  const core = fakeCore();
  const { runtime, events } = runtimeFor(core);
  await runtime.enter();

  const reported = runtime.presenceOf('client-b', {
    author: 'B',
    cursor: [3, 4],
    selection: { x: 1, y: 2, w: 3, h: 4 },
    view: { x0: 10, y0: 20, span: 64 },
  });
  assert.equal(reported.ok, true);
  assert.equal(reported.presence.length, 1);
  assert.equal(reported.presence[0].clientId, 'client-b');
  assert.deepEqual(reported.presence[0].cursor, [3, 4]);
  const last = events[events.length - 1];
  assert.equal(last[0], 'presence');
  assert.equal(last[1].author, 'B');

  assert.equal(runtime.presenceList().length, 1);
  assert.throws(
    () => runtime.presenceOf('client-b', { cursor: ['x', 1] }),
    (error) => error.code === 'bad_arguments',
  );

  const left = runtime.presenceOf('client-b', { leaving: true });
  assert.deepEqual(left.presence, []);
  assert.equal(runtime.presenceList().length, 0);

  await runtime.leave();
  assert.throws(
    () => runtime.presenceOf('client-b', {}),
    (error) => error.code === 'not_editing',
  );
});

test('undo can name a transaction and leaves a later author its cell', async () => {
  const core = fakeCore();
  const { runtime, events } = runtimeFor(core);
  const entered = await runtime.enter();
  assert.equal(entered.ok, true);

  const a = await runtime.commit({
    txId: 'a',
    baseVersion: 0,
    baseHash: entered.hash,
    ops: [setOp([[1, 1], [2, 2]])],
    author: 'A',
  });
  assert.equal(a.ok, true);
  const b = await runtime.commit({
    txId: 'b',
    baseVersion: a.version,
    baseHash: a.hash,
    ops: [setOp([[1, 1]], false)],
    author: 'B',
  });
  assert.equal(b.ok, true);
  assert.equal(core.world.has('1,1'), false, "B's write is in the world");

  const undone = await runtime.undo({ txId: 'a', author: 'A' });
  assert.equal(undone.ok, true);
  assert.equal(undone.kind, 'undo');
  assert.equal(undone.of, 'a');
  assert.equal(undone.author, 'A');
  assert.deepEqual(undone.patch.died, [[2, 2]], 'only the cell A still owned is reversed');
  assert.equal(core.world.has('2,2'), false);
  assert.equal(core.world.has('1,1'), false, "and B's later write is untouched");

  const last = events[events.length - 1];
  assert.equal(last[0], 'patch');
  assert.equal(last[1].of, 'a');
});
