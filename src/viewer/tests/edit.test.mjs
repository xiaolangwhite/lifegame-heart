/**
 * The editing document as plain data: transactions, the hash chain, the rebase
 * rule, and the undo/redo attribution rule.
 *
 * No core, no socket, no file: every case below constructs a document and calls
 * it, which is what makes the merge and undo rules testable before the page or
 * the service exist.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EditDocument,
  EditError,
  MAX_EDIT_CELLS,
  MAX_EDIT_SIDE,
  PATCH_WINDOW,
  canonicalCells,
  computeCandidatePatch,
  contentHashFromPayload,
  normalizeOperation,
  transactionHash,
} from '../edit.mjs';

function newDocument(generation = 0) {
  return new EditDocument({ sessionId: 'main', generation, stateHash: 'base-state' });
}

function setAlive(cells, alive = true, extra = {}) {
  return { kind: 'set', alive, cells, ...extra };
}

/** Commit one absolute transaction and return the document's reply. */
function commit(doc, { txId, cells, author = 'page', generation = doc.generation }) {
  return doc.apply({
    txId,
    baseVersion: doc.version - (doc.version > 0 ? 0 : 0),
    baseHash: doc.hash,
    ops: [setAlive(cells)],
    author,
    patch: { born: cells, died: [] },
    generation,
  });
}

test('a transaction advances the version and the hash deterministically', () => {
  const one = newDocument();
  const two = newDocument();
  const startHash = one.hash;
  const born = [[3, 4], [1, 2]];
  const a = one.apply({
    txId: 't1',
    baseVersion: 0,
    baseHash: one.hash,
    ops: [setAlive(born)],
    author: 'page',
    patch: { born: canonicalCells(born), died: [] },
    generation: 0,
  });
  const b = two.apply({
    txId: 't1',
    baseVersion: 0,
    baseHash: two.hash,
    ops: [setAlive(born)],
    author: 'page',
    patch: { born: canonicalCells(born), died: [] },
    generation: 0,
  });
  assert.equal(a.version, 1);
  assert.equal(a.hash, b.hash, 'the same history produces the same hash');
  assert.notEqual(a.hash, startHash, 'and a different one from the starting document');
  assert.equal(one.stateView().transactionCount, 1);
});

test('the chain hash changes with the author or the patch', () => {
  const previous = contentHashFromPayload('base');
  const record = {
    txId: 't1',
    author: 'page',
    ops: [{ kind: 'set', alive: true, cells: [[1, 1]] }],
    patch: { born: [[1, 1]], died: [] },
    version: 1,
    generation: 0,
  };
  assert.equal(transactionHash(previous, record), transactionHash(previous, record));
  assert.notEqual(transactionHash(previous, record), transactionHash(previous, { ...record, author: 'api' }));
  assert.notEqual(
    transactionHash(previous, record),
    transactionHash(previous, { ...record, patch: { born: [[1, 2]], died: [] } }),
  );
});

test('a stale base rebases when every operation is absolute', () => {
  const doc = newDocument();
  const oldHash = doc.hash;
  commit(doc, { txId: 'a', cells: [[1, 1]] });
  const reply = doc.apply({
    txId: 'b',
    baseVersion: 0,
    baseHash: oldHash,
    ops: [setAlive([[2, 2]])],
    author: 'page',
    patch: { born: [[2, 2]], died: [] },
    generation: 0,
  });
  assert.equal(reply.rebased, true);
  assert.equal(reply.version, 2);
});

test('a stale base refuses an operation that depends on content', () => {
  const doc = newDocument();
  const oldHash = doc.hash;
  commit(doc, { txId: 'a', cells: [[1, 1]] });
  assert.throws(
    () =>
      doc.apply({
        txId: 'b',
        baseVersion: 0,
        baseHash: oldHash,
        ops: [setAlive([[2, 2]], true, { rebaseable: false })],
        author: 'page',
        patch: { born: [[2, 2]], died: [] },
        generation: 0,
      }),
    (error) => error instanceof EditError && error.code === 'stale_base',
  );
});

test('a wrong generation, a duplicate id and a bad patch are refused', () => {
  const doc = newDocument(7);
  commit(doc, { txId: 'a', cells: [[1, 1]] });
  assert.throws(
    () =>
      doc.apply({
        txId: 'b',
        baseVersion: doc.version,
        baseHash: doc.hash,
        ops: [setAlive([[2, 2]])],
        author: 'page',
        patch: { born: [[2, 2]], died: [] },
        generation: 6,
      }),
    (error) => error.code === 'stale_generation',
  );
  assert.throws(
    () =>
      doc.apply({
        txId: 'a',
        baseVersion: doc.version,
        baseHash: doc.hash,
        ops: [setAlive([[2, 2]])],
        author: 'page',
        patch: { born: [[2, 2]], died: [] },
        generation: 7,
      }),
    (error) => error.code === 'duplicate_tx',
  );
  assert.throws(
    () =>
      doc.apply({
        txId: 'c',
        baseVersion: doc.version,
        baseHash: doc.hash,
        ops: [setAlive([[2, 2]])],
        author: 'page',
        patch: { born: [[2, 2]], died: [[2, 2]] },
        generation: 7,
      }),
    (error) => error.code === 'bad_arguments',
  );
});

test('cells are canonicalised, deduplicated and bounded', () => {
  assert.deepEqual(
    canonicalCells([[3, 1], [1, 2], [3, 1], [1, 1]]),
    [[1, 1], [3, 1], [1, 2]],
  );
  assert.throws(
    () =>
      normalizeOperation({
        kind: 'set',
        alive: true,
        cells: Array.from({ length: MAX_EDIT_CELLS + 1 }, (_, i) => [i, 0]),
      }),
    (error) => error.code === 'too_large',
  );
  assert.throws(
    () => normalizeOperation({ kind: 'clear', box: { x: 0, y: 0, w: MAX_EDIT_SIDE + 1, h: 1 } }),
    (error) => error.code === 'too_large',
  );
  assert.throws(
    () =>
      normalizeOperation({
        kind: 'fill',
        box: { x: 0, y: 0, w: 4, h: 4 },
        cells: [[4, 0]],
        mode: 'merge',
      }),
    (error) => error.code === 'bad_arguments',
  );
});

test('undo reverses only the cells the undone transaction still owns', () => {
  const doc = newDocument();
  doc.apply({
    txId: 'a',
    baseVersion: 0,
    baseHash: doc.hash,
    ops: [setAlive([[1, 1], [2, 2]])],
    author: 'A',
    patch: { born: [[1, 1], [2, 2]], died: [] },
    generation: 0,
  });
  doc.apply({
    txId: 'b',
    baseVersion: 1,
    baseHash: doc.hash,
    ops: [setAlive([[1, 1]], false)],
    author: 'B',
    patch: { born: [], died: [[1, 1]] },
    generation: 0,
  });

  const ofA = doc.inverseOf({ txId: 'a' });
  assert.deepEqual(ofA, { born: [], died: [[2, 2]], of: 'a' }, 'the cell B rewrote is left alone');
  const ofB = doc.inverseOf();
  assert.deepEqual(ofB.born, [[1, 1]]);
  assert.deepEqual(ofB.died, []);
});

test('undo and redo are transactions in the chain', () => {
  const doc = newDocument();
  const applied = doc.apply({
    txId: 'a',
    baseVersion: 0,
    baseHash: doc.hash,
    ops: [setAlive([[1, 1]])],
    author: 'A',
    patch: { born: [[1, 1]], died: [] },
    generation: 0,
  });
  const inverse = doc.inverseOf();
  const undone = doc.completeUndo({ of: 'a', author: 'A', patch: inverse, generation: 0 });
  assert.equal(undone.version, 2);
  assert.equal(doc.stateView().undoDepth, 0);
  assert.equal(doc.stateView().redoDepth, 1);
  assert.deepEqual(undone.patch, { born: [], died: [[1, 1]] });

  const redo = doc.redoPatch();
  assert.deepEqual(redo, { born: [[1, 1]], died: [], of: 'a' });
  const redone = doc.completeRedo({ author: 'A', patch: redo, generation: 0 });
  assert.equal(redone.version, 3);
  assert.equal(doc.stateView().undoDepth, 1);
  assert.equal(doc.stateView().redoDepth, 0);
  assert.equal(doc.stateView().hash, redone.hash);
  assert.notEqual(redone.hash, applied.hash);

  // Undoing after a redo reverses the redo's effect, not the original commit's.
  const afterRedo = doc.inverseOf();
  assert.equal(afterRedo.of, 'redo-a-3');
});

test('the resync window answers for the retained versions and refuses outside it', () => {
  const doc = newDocument();
  commit(doc, { txId: 'a', cells: [[1, 1]] });
  commit(doc, { txId: 'b', cells: [[2, 2]] });
  assert.deepEqual(doc.patchesSince(2), []);
  const fromStart = doc.patchesSince(0);
  assert.equal(fromStart.length, 2);
  assert.deepEqual(
    fromStart.map((entry) => entry.version),
    [1, 2],
  );
  assert.equal(doc.patchesSince(3), null);
  assert.throws(() => doc.patchesSince(-1), (error) => error.code === 'bad_arguments');
});

test('the candidate patch composes absolute intents in order', () => {
  const merge = computeCandidatePatch([
    { kind: 'fill', box: { x: 2, y: 3, w: 3, h: 2 }, cells: [[0, 0], [2, 1]], mode: 'merge' },
  ]);
  assert.deepEqual(merge, {
    born: [
      [2, 3],
      [4, 4],
    ],
    died: [],
  });

  const overwrite = computeCandidatePatch([
    { kind: 'fill', box: { x: 2, y: 3, w: 3, h: 2 }, cells: [[0, 0]], mode: 'overwrite' },
  ]);
  assert.deepEqual(overwrite.born, [[2, 3]]);
  assert.equal(overwrite.died.length, 5, 'the other five cells of the box are asked to die');

  const composed = computeCandidatePatch([
    { kind: 'set', alive: true, cells: [[1, 1]] },
    { kind: 'clear', box: { x: 0, y: 0, w: 2, h: 2 } },
  ]);
  assert.deepEqual(composed, {
    born: [],
    died: [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ],
  });
});

test('check refuses before the caller writes to the core', () => {
  const doc = newDocument();
  commit(doc, { txId: 'a', cells: [[1, 1]] });
  assert.throws(
    () =>
      doc.check({
        txId: 'b',
        baseVersion: 0,
        baseHash: doc.hash,
        ops: [setAlive([[2, 2]], true, { rebaseable: false })],
        author: 'page',
        generation: 0,
      }),
    (error) => error.code === 'stale_base',
  );
  assert.throws(
    () =>
      doc.check({
        txId: 'a',
        baseVersion: doc.version,
        baseHash: doc.hash,
        ops: [setAlive([[2, 2]])],
        author: 'page',
        generation: 0,
      }),
    (error) => error.code === 'duplicate_tx',
  );
  assert.deepEqual(
    doc.check({
      txId: 'c',
      baseVersion: doc.version,
      baseHash: doc.hash,
      ops: [setAlive([[2, 2]])],
      author: 'page',
      generation: 0,
    }),
    {
      operations: [{ kind: 'set', alive: true, cells: [[2, 2]], rebaseable: true }],
      author: 'page',
      rebased: false,
    },
  );
});

test('a document needs a session, a generation and a string payload hash', () => {
  assert.throws(() => new EditDocument({ sessionId: '', generation: 0 }), (error) => error.code === 'bad_arguments');
  assert.throws(() => new EditDocument({ sessionId: 'x', generation: -1 }), (error) => error.code === 'bad_arguments');
  assert.throws(() => contentHashFromPayload(1), (error) => error.code === 'bad_arguments');
});

test('undoing a named transaction does not overwrite a later author', () => {
  const doc = newDocument();
  const a = doc.apply({
    txId: 'a',
    baseVersion: 0,
    baseHash: doc.hash,
    ops: [setAlive([[1, 1], [2, 2]])],
    author: 'A',
    patch: { born: [[1, 1], [2, 2]], died: [] },
    generation: 0,
  });
  doc.apply({
    txId: 'b',
    baseVersion: a.version,
    baseHash: a.hash,
    ops: [setAlive([[1, 1]], false)],
    author: 'B',
    patch: { born: [], died: [[1, 1]] },
    generation: 0,
  });

  // B wrote (1, 1) after A, so A's inverse may restore only the cell it still
  // owns; the later author's value stays.
  const inverseA = doc.inverseOf({ txId: 'a' });
  assert.deepEqual(inverseA.died, [[2, 2]]);
  assert.deepEqual(inverseA.born, []);
  doc.completeUndo({ of: 'a', author: 'A', patch: inverseA, generation: 0 });

  // B's transaction is still the last writer of (1, 1), so it can be undone.
  const inverseB = doc.inverseOf({ txId: 'b' });
  assert.deepEqual(inverseB.born, [[1, 1]]);
});

test('the retained window bounds undo and compacts attribution', () => {
  const doc = newDocument();
  const total = PATCH_WINDOW + 3;
  for (let index = 0; index < total; index += 1) {
    const cells = [[index, 0]];
    doc.apply({
      txId: `t${index}`,
      baseVersion: doc.version,
      baseHash: doc.hash,
      ops: [setAlive(cells)],
      author: 'A',
      patch: { born: cells, died: [] },
      generation: 0,
    });
  }

  assert.equal(doc.stateView().transactionCount, PATCH_WINDOW);
  assert.equal(doc.stateView().undoDepth, PATCH_WINDOW, 'undo depth is the window');
  assert.equal(
    doc.stateView().attributionCells,
    PATCH_WINDOW,
    'and the old attribution went with the transactions that left it',
  );
  assert.throws(
    () => doc.inverseOf({ txId: 't0' }),
    (error) => error.code === 'unknown_transaction',
  );
  const newest = doc.inverseOf({ txId: `t${total - 1}` });
  assert.deepEqual(newest.died, [[total - 1, 0]]);
});
