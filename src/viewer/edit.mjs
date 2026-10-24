/**
 * lifegame viewer — the document one editing session commits against.
 *
 * The observation page mutates the world one command at a time. The editing
 * mode needs a unit that can be refused, undone and merged: a **transaction**
 * with an author, a base version, a list of absolute intents and the change the
 * service computed for it. This module owns that document and nothing else. It
 * never talks to a core, a socket or a file, so every rule below is asserted as
 * plain data.
 *
 * Three decisions are visible in the shape of this file.
 *
 * - **A transaction carries intent, not a patch.** `set`, `fill` and `clear`
 *   say what the world should become. The service computes `born`/`died`
 *   against the world it actually meets and passes the result here; this module
 *   records both, because undo needs the change and a client needs the intent.
 * - **Writes are absolute.** A cell is set alive or dead, never "inserted
 *   before" another. That is why concurrent work merges by the order the
 *   service commits it, and why a stale base can be rebased automatically when
 *   every operation in the transaction is absolute. A content-dependent
 *   operation marks itself `rebaseable: false` and a stale base refuses it.
 * - **Undo is a transaction, and it does not travel in time.** An inverse
 *   patch reverses only the cells whose last writer is still the transaction
 *   being undone. A cell another author wrote since keeps its newer value, so
 *   undo never overwrites work it did not make. The retained window bounds both
 *   incremental resynchronisation and undo depth: a transaction that has left it
 *   is no longer undoable, and its per-cell attribution is compacted with it.
 */

import { createHash } from 'node:crypto';

/** The largest edited box, in cells on a side. */
export const MAX_EDIT_SIDE = 256;

/** The largest number of cells one operation may name. */
export const MAX_EDIT_CELLS = 8192;

/**
 * The largest patch a box can produce: the whole box dies in an overwrite, and
 * the source lights its own cells. Used for the patch and not for the source.
 */
export const MAX_PATCH_CELLS = MAX_EDIT_SIDE * MAX_EDIT_SIDE + MAX_EDIT_CELLS;

/** How many committed transactions stay available for incremental resync. */
export const PATCH_WINDOW = 1000;

/** The refusals this document can produce. */
export const EDIT_ERROR_CODES = Object.freeze([
  'bad_arguments',
  'too_large',
  'stale_base',
  'stale_generation',
  'duplicate_tx',
  'unknown_transaction',
  'not_editing',
]);

export class EditError extends Error {
  /**
   * @param {string} code one of EDIT_ERROR_CODES
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'EditError';
    this.code = code;
  }
}

/** A SHA-256 hex digest of a UTF-8 string. */
function digest(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Coordinates as a stable key, and as the wire pair. */
function keyOf(x, y) {
  return `${x},${y}`;
}

function pairOf(cell) {
  return [cell[0], cell[1]];
}

function isInt(value) {
  return typeof value === 'number' && Number.isInteger(value);
}

/**
 * Validate and canonicalise a cell list: sorted by `y` then `x`, duplicates
 * removed, pairs copied. Throws `bad_arguments` on a non-integer pair.
 *
 * @param {unknown} cells
 * @returns {number[][]}
 */
export function canonicalCells(cells) {
  if (!Array.isArray(cells)) throw new EditError('bad_arguments', 'cells must be an array');
  const seen = new Set();
  const canonical = [];
  for (const cell of cells) {
    if (!Array.isArray(cell) || cell.length !== 2 || !isInt(cell[0]) || !isInt(cell[1])) {
      throw new EditError('bad_arguments', 'a cell must be an [x, y] pair of integers');
    }
    const key = keyOf(cell[0], cell[1]);
    if (seen.has(key)) continue;
    seen.add(key);
    canonical.push(pairOf(cell));
  }
  canonical.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  return canonical;
}

/** A content hash of the core's export payload, used as the base state hash. */
export function contentHashFromPayload(payload) {
  if (typeof payload !== 'string') {
    throw new EditError('bad_arguments', 'the export payload must be a string');
  }
  return digest(payload);
}

/**
 * The chain hash a committed transaction produces.
 *
 * `previous` is the document hash before the transaction. The record is
 * canonical JSON of the transaction and its patch, so the same history produces
 * the same hash on every client.
 */
export function transactionHash(previous, record) {
  return digest(JSON.stringify({ previous, ...record }));
}

/**
 * Validate one operation and return its canonical form. Unknown kinds and
 * malformed geometry throw `bad_arguments`; sizes throw `too_large`.
 *
 * Kinds:
 * - `set`: `{kind:'set', alive:boolean, cells:[[x,y],...]}`;
 * - `fill`: `{kind:'fill', box:{x,y,w,h}, cells:[[x,y],...], mode:'overwrite'|'merge'}`,
 *   where the cells are relative to the box's top-left corner;
 * - `clear`: `{kind:'clear', box:{x,y,w,h}}`.
 */
export function normalizeOperation(op) {
  if (op === null || typeof op !== 'object') {
    throw new EditError('bad_arguments', 'an operation must be an object');
  }
  const rebaseable = op.rebaseable === undefined ? true : op.rebaseable === true;
  if (op.kind === 'set') {
    if (typeof op.alive !== 'boolean') {
      throw new EditError('bad_arguments', "'set' needs a boolean 'alive'");
    }
    const cells = canonicalCells(op.cells);
    if (cells.length > MAX_EDIT_CELLS) {
      throw new EditError('too_large', `'set' may name at most ${MAX_EDIT_CELLS} cells`);
    }
    return { kind: 'set', alive: op.alive, cells, rebaseable };
  }
  if (op.kind === 'clear') {
    return { kind: 'clear', box: normalizeBox(op.box), rebaseable };
  }
  if (op.kind === 'fill') {
    const mode = op.mode === undefined ? 'overwrite' : op.mode;
    if (mode !== 'overwrite' && mode !== 'merge') {
      throw new EditError('bad_arguments', "'fill' mode must be 'overwrite' or 'merge'");
    }
    const box = normalizeBox(op.box);
    const cells = canonicalCells(op.cells);
    if (cells.length > MAX_EDIT_CELLS) {
      throw new EditError('too_large', `'fill' may name at most ${MAX_EDIT_CELLS} cells`);
    }
    for (const [x, y] of cells) {
      if (x < 0 || y < 0 || x >= box.w || y >= box.h) {
        throw new EditError('bad_arguments', 'a fill cell must lie inside its box');
      }
    }
    return { kind: 'fill', box, cells, mode, rebaseable };
  }
  throw new EditError('bad_arguments', `unknown operation kind: ${String(op.kind)}`);
}

/** Validate a box and return a copy. */
function normalizeBox(box) {
  if (box === null || typeof box !== 'object') {
    throw new EditError('bad_arguments', 'an operation needs a box');
  }
  const { x, y, w, h } = box;
  if (![x, y, w, h].every(isInt) || w <= 0 || h <= 0) {
    throw new EditError('bad_arguments', 'a box needs integer x, y and positive w, h');
  }
  if (w > MAX_EDIT_SIDE || h > MAX_EDIT_SIDE) {
    throw new EditError('too_large', `a box may be at most ${MAX_EDIT_SIDE} cells on a side`);
  }
  return { x, y, w, h };
}

/** Validate and canonicalise a transaction's operations. */
export function normalizeOperations(ops) {
  if (!Array.isArray(ops) || ops.length === 0) {
    throw new EditError('bad_arguments', 'a transaction needs at least one operation');
  }
  return ops.map(normalizeOperation);
}

/** A patch: `born` and `died` canonical cell lists, disjoint. */
export function normalizePatch(patch) {
  if (patch === null || typeof patch !== 'object') {
    throw new EditError('bad_arguments', 'a transaction needs a patch');
  }
  const born = canonicalCells(patch.born ?? []);
  const died = canonicalCells(patch.died ?? []);
  if (born.length + died.length > MAX_PATCH_CELLS) {
    throw new EditError('too_large', `a patch may name at most ${MAX_PATCH_CELLS} cells`);
  }
  const bornKeys = new Set(born.map(([x, y]) => keyOf(x, y)));
  for (const [x, y] of died) {
    if (bornKeys.has(keyOf(x, y))) {
      throw new EditError('bad_arguments', 'a cell cannot be both born and died in one patch');
    }
  }
  return { born, died };
}

function authorOf(author) {
  if (typeof author !== 'string' || author === '' || author.length > 64) {
    throw new EditError('bad_arguments', 'a transaction needs an author string');
  }
  return author;
}

/**
 * The candidate cells one transaction's operations ask the core to write.
 *
 * The core filters the no-ops and replies with the cells that actually changed;
 * this is what it is asked. Ops apply in order, so a later op wins on a cell it
 * touches. `fill` in `merge` mode only lights its source cells; `overwrite`
 * makes its whole box the source shape; `clear` kills the box.
 *
 * @param {object[]} ops
 * @returns {{born: number[][], died: number[][]}}
 */
export function computeCandidatePatch(ops) {
  const operations = normalizeOperations(ops);
  /** @type {Map<string, boolean>} cell key -> the state the transaction asks for */
  const desired = new Map();
  const setDesired = (x, y, alive) => desired.set(keyOf(x, y), alive);
  for (const op of operations) {
    if (op.kind === 'set') {
      for (const [x, y] of op.cells) setDesired(x, y, op.alive);
      continue;
    }
    const { x: bx, y: by, w, h } = op.box;
    if (op.kind === 'clear') {
      for (let y = by; y < by + h; y += 1) {
        for (let x = bx; x < bx + w; x += 1) setDesired(x, y, false);
      }
      continue;
    }
    const source = new Set(op.cells.map(([x, y]) => keyOf(x, y)));
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const inSource = source.has(keyOf(x, y));
        if (op.mode === 'overwrite') setDesired(bx + x, by + y, inSource);
        else if (inSource) setDesired(bx + x, by + y, true);
      }
    }
  }
  const born = [];
  const died = [];
  for (const [key, alive] of desired) {
    const [x, y] = key.split(',').map(Number);
    (alive ? born : died).push([x, y]);
  }
  return { born: canonicalCells(born), died: canonicalCells(died) };
}

/**
 * One session's edit document.
 *
 * The service creates one per editing session, calls `apply` after it has
 * applied the core's atomic patch, and calls `completeUndo` / `completeRedo`
 * after the corresponding patch has been applied.
 */
export class EditDocument {
  /**
   * @param {{sessionId: string, generation: number, stateHash: string}} options
   */
  constructor({ sessionId, generation, stateHash = '' }) {
    if (typeof sessionId !== 'string' || sessionId === '') {
      throw new EditError('bad_arguments', 'a document needs a session id');
    }
    if (!isInt(generation) || generation < 0) {
      throw new EditError('bad_arguments', 'a document needs a non-negative generation');
    }
    this.sessionId = sessionId;
    this.version = 0;
    this.generation = generation;
    this.stateHash = contentHashFromPayload(stateHash);
    this.hash = digest(
      JSON.stringify({
        sessionId,
        generation,
        stateHash: this.stateHash,
        version: 0,
      }),
    );
    /** @type {object[]} */
    this.transactions = [];
    /** @type {object[]} */
    this.undoStack = [];
    /** @type {object[]} */
    this.redoStack = [];
    /** @type {Map<string, string>} cell key -> the transaction that wrote it last */
    this.attribution = new Map();
    this.byId = new Map();
  }

  /** The version/hash facts a client needs. */
  stateView() {
    return {
      sessionId: this.sessionId,
      version: this.version,
      hash: this.hash,
      stateHash: this.stateHash,
      generation: this.generation,
      undoDepth: this.undoStack.length,
      redoDepth: this.redoStack.length,
      transactionCount: this.transactions.length,
      attributionCells: this.attribution.size,
    };
  }

  /** A committed transaction by id, or `undefined`. */
  findTransaction(txId) {
    return this.byId.get(txId);
  }

  /**
   * Validate a transaction without committing it.
   *
   * The service calls this before it writes to the core, so a duplicate id, a
   * wrong generation or a stale content-dependent intent is refused before the
   * world changes. `apply` calls it again immediately before recording, which is
   * cheap and keeps a caller that forgets to check safe.
   *
   * @param {{txId: string, baseVersion: number, baseHash: string,
   *   ops: object[], author: string, generation: number}} input
   * @returns {{operations: object[], author: string, rebased: boolean}}
   */
  check({ txId, baseVersion, baseHash, ops, author, generation }) {
    if (typeof txId !== 'string' || txId === '' || txId.length > 128) {
      throw new EditError('bad_arguments', 'a transaction needs a txId string');
    }
    if (this.byId.has(txId)) {
      throw new EditError('duplicate_tx', `transaction ${txId} was already committed`);
    }
    if (!isInt(baseVersion) || baseVersion < 0) {
      throw new EditError('bad_arguments', 'a transaction needs a non-negative baseVersion');
    }
    if (typeof baseHash !== 'string') {
      throw new EditError('bad_arguments', 'a transaction needs a baseHash string');
    }
    if (!isInt(generation) || generation !== this.generation) {
      throw new EditError(
        'stale_generation',
        `the world is at generation ${this.generation}, the transaction was built at ${generation}`,
      );
    }
    const operations = normalizeOperations(ops);
    const authorValue = authorOf(author);
    const behind = baseVersion !== this.version || baseHash !== this.hash;
    if (behind && !operations.every((operation) => operation.rebaseable)) {
      throw new EditError(
        'stale_base',
        `the document is at version ${this.version}, the transaction was built at ${baseVersion}`,
      );
    }
    return { operations, author: authorValue, rebased: behind };
  }

  /**
   * Commit one transaction.
   *
   * The caller has already applied `patch` atomically to the core and passes the
   * cells the core reported as actually changed. `generation` is the generation
   * the patch was applied at; a mismatch means the world moved between the check
   * and the write and the transaction must not be recorded.
   *
   * @param {{txId: string, baseVersion: number, baseHash: string,
   *   ops: object[], author: string, patch: {born: number[][], died: number[][]},
   *   generation: number}} input
   * @returns {{version: number, hash: string, patch: object, rebased: boolean}}
   */
  apply({ txId, baseVersion, baseHash, ops, author, patch, generation }) {
    const checked = this.check({ txId, baseVersion, baseHash, ops, author, generation });
    const operations = checked.operations;
    const authorValue = checked.author;
    const behind = checked.rebased;
    const change = normalizePatch(patch);
    this.version += 1;
    const record = {
      txId,
      kind: 'commit',
      author: authorValue,
      baseVersion,
      baseHash,
      ops: operations,
      patch: change,
      version: this.version,
      generation: this.generation,
    };
    this.hash = transactionHash(this.hash, {
      txId,
      author: authorValue,
      ops: operations,
      patch: change,
      version: this.version,
      generation: this.generation,
    });
    record.hash = this.hash;
    this.#record(record);
    return { version: this.version, hash: this.hash, patch: change, rebased: behind };
  }

  /**
   * The inverse patch of a committed transaction, restricted to the cells it is
   * still the last writer of. An undo that would overwrite another author's later
   * work cannot exist by construction: those cells are not in the patch.
   *
   * @param {{txId?: string}} [options] the newest transaction when omitted
   * @returns {{born: number[][], died: number[][], of: string}}
   */
  inverseOf({ txId } = {}) {
    const target = txId === undefined ? this.undoStack[this.undoStack.length - 1] : this.findTransaction(txId);
    if (!target) {
      throw new EditError('unknown_transaction', 'no transaction to undo');
    }
    const born = [];
    const died = [];
    for (const [x, y] of target.patch.died) {
      if (this.attribution.get(keyOf(x, y)) === target.txId) born.push([x, y]);
    }
    for (const [x, y] of target.patch.born) {
      if (this.attribution.get(keyOf(x, y)) === target.txId) died.push([x, y]);
    }
    return { born, died, of: target.txId };
  }

  /**
   * Record the inverse transaction after the caller applied its patch.
   *
   * @param {{of: string, author: string, patch: {born: number[][], died: number[][]},
   *   generation: number}} input
   */
  completeUndo({ of, author, patch, generation }) {
    const target = this.undoStack.find((entry) => entry.txId === of);
    if (!target) {
      throw new EditError('unknown_transaction', `transaction ${of} is not on the undo stack`);
    }
    if (!isInt(generation) || generation !== this.generation) {
      throw new EditError('stale_generation', 'the world moved before the undo was recorded');
    }
    const change = normalizePatch(patch);
    this.version += 1;
    const record = {
      txId: `undo-${of}-${this.version}`,
      kind: 'undo',
      of,
      author: authorOf(author),
      ops: [],
      patch: change,
      version: this.version,
      generation: this.generation,
    };
    this.hash = transactionHash(this.hash, {
      txId: record.txId,
      kind: 'undo',
      of,
      author: record.author,
      patch: change,
      version: this.version,
      generation: this.generation,
    });
    record.hash = this.hash;
    this.#record(record);
    this.undoStack = this.undoStack.filter((entry) => entry.txId !== of);
    this.redoStack.push({ of, author: record.author, undoPatch: change, undoId: record.txId });
    return { version: this.version, hash: this.hash, patch: change };
  }

  /** The patch a redo would apply, restricted to what the undo still owns. */
  redoPatch() {
    const entry = this.redoStack[this.redoStack.length - 1];
    if (!entry) throw new EditError('unknown_transaction', 'no transaction to redo');
    const born = [];
    const died = [];
    for (const [x, y] of entry.undoPatch.died) {
      if (this.attribution.get(keyOf(x, y)) === entry.undoId) born.push([x, y]);
    }
    for (const [x, y] of entry.undoPatch.born) {
      if (this.attribution.get(keyOf(x, y)) === entry.undoId) died.push([x, y]);
    }
    return { born, died, of: entry.of };
  }

  /** Record the redo transaction after the caller applied its patch. */
  completeRedo({ author, patch, generation }) {
    const entry = this.redoStack[this.redoStack.length - 1];
    if (!entry) throw new EditError('unknown_transaction', 'no transaction to redo');
    if (!isInt(generation) || generation !== this.generation) {
      throw new EditError('stale_generation', 'the world moved before the redo was recorded');
    }
    const change = normalizePatch(patch);
    this.version += 1;
    const record = {
      txId: `redo-${entry.of}-${this.version}`,
      kind: 'redo',
      of: entry.of,
      author: authorOf(author),
      ops: [],
      patch: change,
      version: this.version,
      generation: this.generation,
    };
    this.hash = transactionHash(this.hash, {
      txId: record.txId,
      kind: 'redo',
      of: entry.of,
      author: record.author,
      patch: change,
      version: this.version,
      generation: this.generation,
    });
    record.hash = this.hash;
    this.#record(record);
    this.redoStack.pop();
    return { version: this.version, hash: this.hash, patch: change };
  }

  /**
   * Transactions after `version` for incremental resync, or `null` when the
   * requested version has fallen out of the retained window.
   */
  patchesSince(version) {
    if (!isInt(version) || version < 0) {
      throw new EditError('bad_arguments', 'since must be a non-negative integer');
    }
    const first = this.transactions[0];
    if (this.transactions.length === 0) {
      return version === this.version ? [] : null;
    }
    if (version > this.version || version < first.version - 1) return null;
    return this.transactions
      .filter((record) => record.version > version)
      .map((record) => ({
        version: record.version,
        hash: record.hash,
        txId: record.txId,
        author: record.author,
        kind: record.kind,
        patch: record.patch,
      }));
  }

  /** Record a transaction and its consequences. */
  #record(record) {
    this.transactions.push(record);
    this.byId.set(record.txId, record);
    for (const [x, y] of record.patch.born) this.attribution.set(keyOf(x, y), record.txId);
    for (const [x, y] of record.patch.died) this.attribution.set(keyOf(x, y), record.txId);
    if (record.kind === 'commit' || record.kind === 'redo') this.undoStack.push(record);
    if (record.kind === 'commit') this.redoStack = [];
    while (this.transactions.length > PATCH_WINDOW) {
      const dropped = this.transactions.shift();
      this.byId.delete(dropped.txId);
      // Compaction. An old transaction that left the retained window is not
      // undoable any more: every transaction older than it has left the window
      // too, so an attribution entry that still names it can only protect a
      // target that can no longer be undone. The stacks are filtered with it and
      // its entries are removed, which bounds a long session's memory by the
      // window rather than by everything ever edited. The cost is stated in the
      // interface: undo depth is the window.
      this.undoStack = this.undoStack.filter((entry) => entry.txId !== dropped.txId);
      this.redoStack = this.redoStack.filter((entry) => entry.undoId !== dropped.txId);
      for (const [x, y] of [...dropped.patch.born, ...dropped.patch.died]) {
        const key = keyOf(x, y);
        if (this.attribution.get(key) === dropped.txId) this.attribution.delete(key);
      }
    }
  }
}
