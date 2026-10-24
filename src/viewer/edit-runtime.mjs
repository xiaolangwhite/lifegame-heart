/**
 * lifegame viewer — the editing runtime for one session.
 *
 * The document in `edit.mjs` is the model; this file is the service around it.
 * It owns the four things the model must not: when the mode is open, the pause
 * and resume of a running world, the call to the core's atomic `patch`, and the
 * broadcast that tells every client what changed.
 *
 * The division is deliberate. The runtime never computes a generation and never
 * keeps a copy of the world: it sends the candidate cells a transaction asks
 * for, and the core answers with the cells it actually changed. Those actual
 * cells are what the document records, so undo attribution cannot claim a cell a
 * transaction only mentioned.
 */

import { EditDocument, EditError, computeCandidatePatch, contentHashFromPayload } from './edit.mjs';

/**
 * Create the editing runtime of one session.
 *
 * @param {{id: string, ask: Function,
 *   broadcast: (event: string, payload: object) => void,
 *   invalidate: () => void, author?: string}} options
 */
export function createEditRuntime({ id, ask, broadcast, invalidate, author = 'local' }) {
  if (typeof id !== 'string' || id === '') {
    throw new EditError('bad_arguments', 'an edit runtime needs a session id');
  }
  if (typeof ask !== 'function') {
    throw new EditError('bad_arguments', 'an edit runtime needs an ask function');
  }
  let document = null;
  let wasRunning = false;
  let resumeTps = null;

  /**
   * The ephemeral presence of the collaborators: cursor, selection and view
   * point. It is not persisted and it is not part of the document; an entry
   * expires when its client stops talking, so a closed tab does not stay in the
   * roster forever.
   */
  const presence = new Map();
  const PRESENCE_TTL_MS = 30_000;

  const active = () => document !== null;

  const prunePresence = () => {
    const cutoff = Date.now() - PRESENCE_TTL_MS;
    for (const [clientId, entry] of presence) {
      if (entry.at < cutoff) presence.delete(clientId);
    }
  };

  const presenceList = () => {
    if (document === null) return [];
    prunePresence();
    return [...presence.values()];
  };

  const mustInt = (value, name) => {
    if (!Number.isInteger(value) || Math.abs(value) > 1e9) {
      throw new EditError('bad_arguments', `presence ${name} must be an integer`);
    }
    return value;
  };

  /** Validate one presence report and return the entry that will be broadcast. */
  function presenceEntry(clientId, payload) {
    if (typeof clientId !== 'string' || clientId === '' || clientId.length > 64) {
      throw new EditError('bad_arguments', "presence needs a 'clientId' string");
    }
    const entry = {
      clientId,
      author: typeof payload.author === 'string' && payload.author !== ''
        ? payload.author.slice(0, 64)
        : author,
      cursor: null,
      selection: null,
      view: null,
      at: Date.now(),
    };
    if (payload.cursor !== undefined && payload.cursor !== null) {
      if (!Array.isArray(payload.cursor) || payload.cursor.length !== 2) {
        throw new EditError('bad_arguments', 'presence cursor must be an [x, y] pair');
      }
      entry.cursor = [mustInt(payload.cursor[0], 'cursor x'), mustInt(payload.cursor[1], 'cursor y')];
    }
    if (payload.selection !== undefined && payload.selection !== null) {
      const box = payload.selection;
      if (box === null || typeof box !== 'object') {
        throw new EditError('bad_arguments', 'presence selection must be a box');
      }
      const { x, y, w, h } = box;
      if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) {
        throw new EditError('bad_arguments', 'presence selection needs positive w and h');
      }
      entry.selection = {
        x: mustInt(x, 'selection x'),
        y: mustInt(y, 'selection y'),
        w,
        h,
      };
    }
    if (payload.view !== undefined && payload.view !== null) {
      const view = payload.view;
      if (view === null || typeof view !== 'object') {
        throw new EditError('bad_arguments', 'presence view must be an object');
      }
      const span = Number(view.span);
      if (!Number.isFinite(span) || span <= 0) {
        throw new EditError('bad_arguments', 'presence view needs a positive span');
      }
      entry.view = {
        x0: mustInt(view.x0, 'view x0'),
        y0: mustInt(view.y0, 'view y0'),
        span,
      };
    }
    return entry;
  }

  const view = () => {
    if (document === null) {
      return { editMode: false, sessionId: id };
    }
    return { editMode: true, sessionId: id, ...document.stateView() };
  };

  /**
   * Open the mode: pause a running world, fingerprint the live set, and start
   * the document at the generation the world is actually at.
   */
  async function enter() {
    if (document !== null) return { ok: true, ...view() };
    const state = await ask('state');
    if (state?.ok === false) return state;
    wasRunning = state.running === true;
    resumeTps = Number.isInteger(state.tps) ? state.tps : null;
    if (wasRunning) {
      const paused = await ask('pause');
      if (paused?.ok === false) return paused;
    }
    const exported = await ask('export');
    if (exported?.ok === false) return exported;
    document = new EditDocument({
      sessionId: id,
      generation: exported.export.generation,
      stateHash: contentHashFromPayload(exported.export.data),
    });
    return { ok: true, ...view() };
  }

  /** Close the mode, restoring the run state it had when it opened. */
  async function leave() {
    if (document === null) return { ok: true, editMode: false, sessionId: id, resumed: false };
    const resume = wasRunning;
    const tps = resumeTps;
    document = null;
    wasRunning = false;
    resumeTps = null;
    presence.clear();
    if (resume) {
      const reply = await ask('run', tps === null ? {} : { tps });
      if (reply?.ok === false) return { ...reply, editMode: false, resumed: false };
    }
    return { ok: true, editMode: false, sessionId: id, resumed: resume };
  }

  /**
   * Commit one transaction.
   *
   * The check happens before the core is touched, so a duplicate id, a stale
   * base or a wrong generation changes nothing. The core then applies the
   * candidate cells atomically and reports the ones that actually changed; the
   * document records that change, and the event tells every client.
   */
  async function commit(input = {}) {
    if (document === null) {
      throw new EditError('not_editing', 'the session is not in the editing mode');
    }
    const checked = document.check({
      txId: input.txId,
      baseVersion: input.baseVersion,
      baseHash: input.baseHash,
      ops: input.ops,
      author: input.author ?? author,
      generation: document.generation,
    });
    const candidates = computeCandidatePatch(checked.operations);
    const reply = await ask('patch', {
      born: candidates.born,
      died: candidates.died,
      expectGeneration: document.generation,
    });
    if (reply?.ok === false) return reply;
    const applied = document.apply({
      txId: input.txId,
      baseVersion: input.baseVersion,
      baseHash: input.baseHash,
      ops: checked.operations,
      author: checked.author,
      patch: { born: reply.born, died: reply.died },
      generation: document.generation,
    });
    const payload = {
      sessionId: id,
      txId: input.txId,
      author: checked.author,
      patch: applied.patch,
      version: applied.version,
      hash: applied.hash,
      rebased: applied.rebased,
    };
    broadcast('patch', payload);
    invalidate();
    return { ok: true, ...payload };
  }

  /** Undo the newest transaction as an inverse transaction. */
  async function undo(input = {}) {
    if (document === null) {
      throw new EditError('not_editing', 'the session is not in the editing mode');
    }
    const inverse = document.inverseOf(input.txId === undefined ? {} : { txId: input.txId });
    let change = inverse;
    if (inverse.born.length > 0 || inverse.died.length > 0) {
      const reply = await ask('patch', {
        born: inverse.born,
        died: inverse.died,
        expectGeneration: document.generation,
      });
      if (reply?.ok === false) return reply;
      change = { born: reply.born, died: reply.died };
    }
    const authorValue = input.author ?? author;
    const applied = document.completeUndo({
      of: inverse.of,
      author: authorValue,
      patch: change,
      generation: document.generation,
    });
    const payload = {
      sessionId: id,
      kind: 'undo',
      of: inverse.of,
      author: authorValue,
      patch: applied.patch,
      version: applied.version,
      hash: applied.hash,
    };
    broadcast('patch', payload);
    invalidate();
    return { ok: true, ...payload };
  }

  /** Redo the last undone transaction as a new transaction. */
  async function redo(input = {}) {
    if (document === null) {
      throw new EditError('not_editing', 'the session is not in the editing mode');
    }
    const inverse = document.redoPatch();
    let change = inverse;
    if (inverse.born.length > 0 || inverse.died.length > 0) {
      const reply = await ask('patch', {
        born: inverse.born,
        died: inverse.died,
        expectGeneration: document.generation,
      });
      if (reply?.ok === false) return reply;
      change = { born: reply.born, died: reply.died };
    }
    const authorValue = input.author ?? author;
    const applied = document.completeRedo({
      author: authorValue,
      patch: change,
      generation: document.generation,
    });
    const payload = {
      sessionId: id,
      kind: 'redo',
      of: inverse.of,
      author: authorValue,
      patch: applied.patch,
      version: applied.version,
      hash: applied.hash,
    };
    broadcast('patch', payload);
    invalidate();
    return { ok: true, ...payload };
  }

  /** Record one client's presence and tell every other client about it. */
  function presenceOf(clientId, payload = {}) {
    if (document === null) {
      throw new EditError('not_editing', 'the session is not in the editing mode');
    }
    prunePresence();
    if (payload.leaving === true) {
      presence.delete(clientId);
      broadcast('presence', { clientId, leaving: true, at: Date.now() });
      return { ok: true, presence: presenceList() };
    }
    const entry = presenceEntry(clientId, payload);
    presence.set(clientId, entry);
    broadcast('presence', entry);
    return { ok: true, presence: presenceList() };
  }

  /**
   * The resynchronisation view. With `since`, answer the patches after that
   * version while the window covers it, and `full: true` when it does not.
   */
  function state(since) {
    if (document === null) return { ok: true, ...view() };
    if (since === undefined || since === null || since === '') {
      return { ok: true, ...view() };
    }
    const version = Number(since);
    if (!Number.isInteger(version) || version < 0) {
      throw new EditError('bad_arguments', "'since' must be a non-negative integer");
    }
    const patches = document.patchesSince(version);
    if (patches === null) return { ok: true, ...view(), full: true };
    return { ok: true, ...view(), patches };
  }

  return Object.freeze({
    id,
    active,
    view,
    enter,
    leave,
    commit,
    undo,
    redo,
    state,
    presenceOf,
    presenceList,
  });
}
