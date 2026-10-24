/**
 * lifegame viewer — HTTP service: static files, a thin API over the core.
 *
 * The service is a transport, not a second implementation of the rule. It
 * forwards requests to the Python core through CoreBridge and returns the
 * core's reply unchanged (its `ok`, `error` and `message` fields included), so
 * a client sees exactly one authority for the world.
 *
 * Two responsibilities are the service's own, because the core cannot have
 * them:
 *
 * 1. **Admission control for `frame`.** The core's encoder picks the `cells`
 *    encoding exactly when `8 * live <= ceil(w / 8) * h`, which is
 *    `live * 64 <= w * h`; that path scans the live set and never materialises a
 *    dense grid, so it is safe at any rectangle size. Otherwise the `bits` path
 *    allocates `w * h` bytes of intermediate storage, which a 65536 x 65536
 *    request turns into 2.8 GB. The admission rule below is the encoder's own
 *    rule applied with the last population the core reported, so a legal wide
 *    request is never rejected and a request that could kill the child is
 *    refused with a clear message. The browser applies the same rule when it
 *    chooses its zoom range.
 * 2. **Static file serving**, with the resolved path confined to `public/`.
 * 3. **Composing the routed pages.** The interface is three pages — the world,
 *    the recorded history and the archive manager — and each is the shared
 *    layout plus one fragment, assembled from the single route table in
 *    `routes.mjs`. A path no route claims is a 404; there is no default page to
 *    fall back to, because a fallback turns every typo into a working address.
 *
 * One file is written, and only when the core was asked to record a history: the
 * store at the path the operator named, which defaults to `data/history.db`
 * inside the repository. This service does not write it — the core does, at the
 * operator's request — but a reader of this file should not be told that nothing
 * is written when something is. Archive exports are the second such write, and
 * they are confined to the same directory: an HTTP client may name an archive,
 * not choose a path, because a request must not decide where the server writes.
 */

import { open, readFile, readdir, rename, stat, unlink } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CoreBridge, CoreTimeoutError, CoreUnavailableError, repoRoot } from './bridge.mjs';
import { EditError, MAX_EDIT_CELLS, MAX_EDIT_SIDE } from './edit.mjs';
import { createEditRuntime } from './edit-runtime.mjs';
import { EventHub } from './events.mjs';
import { createPageRenderer } from './routes.mjs';
import {
  MAX_CELLS_FOR_NEAREST,
  MAX_FRAME_CELLS,
  clampTicksPerSecond,
  frameAdmission,
  readLimits,
} from './public/shared.mjs';
import { placedCells, readPatternLibrary } from './patterns.mjs';
import { chooseRepresentation, hasMeasuredOpinion } from './representation.mjs';
import { createSnippetStore, SnippetError } from './snippets.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultPublicDir = path.join(here, 'public');

export { MAX_FRAME_CELLS };

/**
 * Where the core's history store and exported archives live by default.
 *
 * Inside the repository, because that is the rule for anything this project
 * creates (ADR 0002 via scripts/env.ps1). `data/` is git-ignored except for its
 * README, so a session does not end up committed by accident.
 */
export const defaultHistoryPath = path.join(repoRoot, 'data', 'history.db');
export const defaultArchiveDir = path.join(repoRoot, 'data');
/** The published snippet library, next to the archives and the history. */
export const defaultSnippetsDir = path.join(repoRoot, 'data', 'snippets');

/** Request body ceiling, so a client cannot exhaust memory through the API. */
const MAX_BODY_BYTES = 1 << 20;

/**
 * Commands that cannot change the world, so a subscriber does not need a fresh
 * frame after one.
 */
const READ_ONLY_COMMANDS = new Set(['hello', 'state', 'export', 'history']);

const CONTENT_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.ico', 'image/x-icon'],
  ['.map', 'application/json; charset=utf-8'],
]);

/** An error this layer raises itself, as opposed to one the core reported. */
class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
}

/** The id every service has; a request that names no session means this one. */
export const DEFAULT_SESSION_ID = 'main';

/** The most sessions one service holds, the default session included. */
export const MAX_SESSIONS = 64;

/** The most creation requests one service keeps waiting at the session cap. */
export const MAX_QUEUED_SESSIONS = 1024;

/** Where a session other than the default keeps its history. */
export const sessionHistoryDir = path.join(repoRoot, 'data', 'sessions');

/** The history store one session owns. The store creates the directory. */
export function sessionHistoryPath(id, directory = sessionHistoryDir) {
  return id === DEFAULT_SESSION_ID
    ? defaultHistoryPath
    : path.join(directory, `${id}.db`);
}

/**
 * One session's runtime: its core, its event hub, and the facts the service
 * learns from that core.
 *
 * The same shape serves the session a service always has and one it creates
 * later, which is what makes "more than one world per service" a registry rather
 * than a second code path. Nothing here is shared: a crash counter, a switch
 * window and a subscriber list belong to one core, and two sessions must not
 * pause each other.
 */
function createSessionRuntime({
  id,
  label,
  bridge,
  ownsBridge = false,
  maxFrameCells,
}) {
  let population = 0;
  let limits = null;
  let history = false;
  let switching = false;
  const openResponses = new Set();

  const remember = (reply) => {
    if (reply && typeof reply.population === 'number') population = reply.population;
    const frame = reply?.frame;
    if (frame && typeof frame.population === 'number') population = frame.population;
    if (reply && reply.limits !== undefined) {
      limits = readLimits(reply);
      history = reply.history === true;
    }
    return reply;
  };

  const ask = async (cmd, fields) => remember(await bridge.request(cmd, fields));

  /**
   * A `state` reply with the facts the page needs and the core does not repeat,
   * and the session they belong to.
   */
  const stateReply = async () => {
    if (limits === null) await ask('hello');
    const reply = await ask('state');
    return {
      ...reply,
      limits,
      history,
      representation: bridge.representation,
      session: id,
    };
  };

  const hub = new EventHub({
    bridge,
    representation: bridge.representation,
    maxFrameCells,
    session: id,
    population: () => population,
    onPopulation: (value) => {
      population = value;
    },
  });

  // The editing runtime owns the transaction document of this session. It
  // shares the session's `ask` (so limits and the history flag stay current) and
  // the hub (so a committed patch reaches every client as an event).
  const edit = createEditRuntime({
    id,
    ask,
    broadcast: (event, payload) => hub.broadcast(event, payload),
    invalidate: () => hub.invalidate(),
  });

  /**
   * Refuse a world-writing request while this session is being edited.
   *
   * The mode runs against a paused world, so a command that steps, runs, clears
   * or switches representation would move the world out from under the
   * transaction document. Deriving a second generation behind the mode is a
   * different feature, and the refusal is the honest answer until it exists.
   */
  const refuseWhileEditing = () => {
    if (edit.active()) {
      throw new HttpError(
        409,
        'edit_active',
        'the session is in the editing mode; commit or leave it before changing the world',
      );
    }
  };

  const refuseWhileSwitching = () => {
    if (switching) {
      throw new HttpError(
        503,
        'switch_in_progress',
        'a representation switch is in progress; retry in a moment',
      );
    }
  };

  const close = async () => {
    hub.close();
    for (const response of openResponses) {
      try {
        response.end();
      } catch {
        // A connection that is already gone needs nothing from us.
      }
    }
    openResponses.clear();
    if (ownsBridge) await bridge.stop();
  };

  return {
    id,
    label,
    bridge,
    hub,
    ask,
    stateReply,
    refuseWhileSwitching,
    refuseWhileEditing,
    edit,
    openResponses,
    close,
    get limits() {
      return limits;
    },
    get history() {
      return history;
    },
    get population() {
      return population;
    },
    get switching() {
      return switching;
    },
    set switching(value) {
      switching = value;
    },
  };
}

/**
 * Map a URL path onto a file inside `publicDir`, or return null when the path
 * tries to leave it. Decoding happens before resolution so that percent-encoded
 * traversal is caught by the same prefix check as a literal one.
 */
export function resolveStaticPath(publicDir, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const relative = decoded.replace(/^[/\\]+/, '');
  if (relative === '') return null;
  const root = path.resolve(publicDir);
  const resolved = path.resolve(root, relative);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (!resolved.startsWith(prefix)) return null;
  return resolved;
}

/**
 * Resolve an archive name inside `dir`, or return null when the name is not a
 * plain file name.
 *
 * The regex is the rule rather than a sanitiser: a name that contains a
 * separator, a drive letter, a traversal or a NUL is refused, not repaired. A
 * repaired path is a path the caller did not ask for, and the caller here is a
 * browser.
 */
export function resolveArchivePath(name, dir) {
  if (typeof name !== 'string' || name === '' || name === '.' || name === '..') return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.jsonl$/.test(name)) return null;
  const root = path.resolve(dir);
  const resolved = path.resolve(root, name);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (!resolved.startsWith(prefix)) return null;
  return resolved;
}

/**
 * How many generations an archive file holds, or null when it cannot be counted.
 *
 * The header line is the format's, so it is not a generation: the count is the
 * newline count minus one. Counting lines by streaming rather than parsing the
 * file keeps this cheap for a long archive and keeps this service out of the
 * archive's *content* — the store owns that format, and a second reader here
 * would be a second implementation of it.
 */
async function countArchiveGenerations(filePath, ceiling = 1 << 22) {
  let handle = null;
  try {
    handle = await open(filePath, 'r');
    const buffer = Buffer.alloc(65536);
    let total = 0;
    let bytes = 0;
    let lastByte = 0x0a;
    while (bytes < ceiling) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      bytes += bytesRead;
      for (let index = 0; index < bytesRead; index += 1) {
        if (buffer[index] === 0x0a) total += 1;
      }
      lastByte = buffer[bytesRead - 1];
    }
    if (total === 0 && lastByte === 0x0a) return 0;
    // A file that does not end in a newline still has a last line.
    if (lastByte !== 0x0a) total += 1;
    // The first line is the archive header, which is not a generation.
    return Math.max(0, total - 1);
  } catch {
    return null;
  } finally {
    if (handle !== null) await handle.close().catch(() => {});
  }
}

function readInteger(searchParams, key) {
  const raw = searchParams.get(key);
  if (raw === null || raw.trim() === '') {
    throw new HttpError(400, 'bad_request', `query parameter '${key}' is required`);
  }
  if (!/^-?\d+$/.test(raw.trim())) {
    throw new HttpError(400, 'bad_request', `query parameter '${key}' must be an integer`);
  }
  return Number.parseInt(raw, 10);
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new HttpError(413, 'bad_request', `request body larger than ${MAX_BODY_BYTES} bytes`);
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (text === '') throw new HttpError(400, 'bad_request', 'request body is empty');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new HttpError(400, 'bad_request', `request body is not valid JSON: ${error.message}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, 'bad_request', 'request body must be a JSON object');
  }
  return parsed;
}

/**
 * Create the viewer's HTTP server.
 *
 * @param {{bridge?: CoreBridge, publicDir?: string, maxFrameCells?: number,
 *   maxCellsForNearest?: number, patterns?: ReadonlyArray<object>,
 *   patternsPath?: string, sessionHistoryDir?: string, maxSessions?: number,
 *   maxQueuedSessions?: number, snippetsDir?: string,
 *   createBridge?: (options: object) => CoreBridge}} [options]
 */
export function createViewerServer(options = {}) {
  const publicDir = path.resolve(options.publicDir ?? defaultPublicDir);
  // The composer reads the layout and the fragments out of the same directory
  // the static handler serves, so a service pointed at another public directory
  // serves the pages of that directory too.
  const pages = createPageRenderer(publicDir);
  const archiveDir = path.resolve(options.archiveDir ?? defaultArchiveDir);
  const snippets = createSnippetStore({
    directory: path.resolve(options.snippetsDir ?? defaultSnippetsDir),
  });
  const bridge = options.bridge ?? new CoreBridge();
  const maxFrameCells = options.maxFrameCells ?? MAX_FRAME_CELLS;
  // The cap on one `export` payload handed to a page that has to pick a point
  // inside the live set. Exposed as an option so a test can drive the degraded
  // path with a handful of cells instead of a population of thousands.
  const maxCellsForNearest = options.maxCellsForNearest ?? MAX_CELLS_FOR_NEAREST;
  // Ownership is explicit: a caller that hands in its own bridge keeps
  // responsibility for stopping it, and one that lets this function create the
  // bridge gets it stopped together with the listener.
  const ownsBridge = options.ownsBridge ?? options.bridge === undefined;
  // The pattern library is data and is read once. A request names a pattern and
  // the service resolves it; the page never parses RLE. An option lets a test
  // supply a synthetic library without touching the shipped file.
  const patterns = options.patterns ?? readPatternLibrary(options.patternsPath);
  const patternByName = new Map(patterns.map((pattern) => [pattern.name, pattern]));
  // Where a created session records. The default is the repository's data
  // directory; a test points it at a temporary one.
  const sessionsDir = path.resolve(options.sessionHistoryDir ?? sessionHistoryDir);
  // The cap is a product decision (64 sessions, the default included); the
  // factory is a seam so a test can create sessions without starting a Python
  // child per session.
  const maxSessions = options.maxSessions ?? MAX_SESSIONS;
  const maxQueuedSessions = options.maxQueuedSessions ?? MAX_QUEUED_SESSIONS;
  const createBridge =
    options.createBridge ?? ((bridgeOptions) => new CoreBridge(bridgeOptions));

  // The session a service always has. A test that injects a bridge gets it as
  // `main`, which is why every request written before sessions works unchanged:
  // a request that names no session means this one.
  const mainRuntime = createSessionRuntime({
    id: DEFAULT_SESSION_ID,
    label: DEFAULT_SESSION_ID,
    bridge,
    ownsBridge,
    maxFrameCells,
  });
  const runtimes = new Map([[mainRuntime.id, mainRuntime]]);
  let nextSessionNumber = 0;
  // A creation request that arrives at the cap waits here instead of being
  // refused: the service is a local surface, and a person who closes a session
  // should make the waiting one succeed rather than have to press again. The
  // count is part of GET /api/sessions, which is how the page can say how many
  // are waiting.
  const sessionWaiters = [];

  const waitForSlot = () =>
    new Promise((resolve, reject) => {
      sessionWaiters.push({ resolve, reject });
    });

  const wakeWaiters = () => {
    while (sessionWaiters.length > 0 && runtimes.size < maxSessions) {
      sessionWaiters.shift().resolve();
    }
  };

  const sessionById = (id) => {
    const runtime = runtimes.get(id);
    if (runtime === undefined) {
      throw new HttpError(404, 'unknown_session', `no session named ${JSON.stringify(id)}`);
    }
    return runtime;
  };

  const sessionSummaries = () =>
    [...runtimes.values()].map((runtime) => ({
      id: runtime.id,
      label: runtime.label,
      representation: runtime.bridge.representation,
      history: runtime.history,
    }));

  const readViewport = (searchParams) => {
    const keys = ['x0', 'y0', 'w', 'h'];
    const present = keys.filter((key) => searchParams.get(key) !== null);
    if (present.length === 0) return null;
    if (present.length !== keys.length) {
      throw new HttpError(
        400,
        'bad_request',
        `a viewport needs all of ${keys.join(', ')}; got only ${present.join(', ')}`,
      );
    }
    const viewport = {};
    for (const key of keys) {
      const raw = searchParams.get(key).trim();
      if (!/^-?\d+$/.test(raw)) {
        throw new HttpError(400, 'bad_request', `query parameter '${key}' must be an integer`);
      }
      viewport[key] = Number.parseInt(raw, 10);
    }
    if (viewport.x0 < 0 || viewport.y0 < 0) {
      throw new HttpError(400, 'bad_request', "'x0' and 'y0' must not be negative");
    }
    if (viewport.w < 1 || viewport.h < 1) {
      throw new HttpError(400, 'bad_request', "'w' and 'h' must be positive");
    }
    return viewport;
  };

  const handleFrame = async (runtime, request, response, url) => {
    const { ask, refuseWhileSwitching } = runtime;
    refuseWhileSwitching();
    const x0 = readInteger(url.searchParams, 'x0');
    const y0 = readInteger(url.searchParams, 'y0');
    const w = readInteger(url.searchParams, 'w');
    const h = readInteger(url.searchParams, 'h');
    if (x0 < 0 || y0 < 0) {
      throw new HttpError(400, 'bad_request', "'x0' and 'y0' must not be negative");
    }
    if (w < 1 || h < 1) {
      throw new HttpError(400, 'bad_request', "'w' and 'h' must be positive");
    }
    const area = w * h;
    if (!Number.isSafeInteger(area)) {
      throw new HttpError(400, 'bad_request', "'w' and 'h' are too large");
    }
    // The encoder's own rule, shared with the push transport so the two cannot
    // drift apart: see frame-rules.mjs for the derivation and for why the
    // guarantee is made against the last reported population.
    const refusal = frameAdmission({ area, population: runtime.population, maxFrameCells });
    if (refusal !== null) {
      throw new HttpError(400, refusal.error, refusal.message);
    }
    sendJson(response, 200, await ask('frame', { x0, y0, w, h }));
  };

  const handleCommand = async (runtime, request, response) => {
    const { ask, stateReply, hub, refuseWhileSwitching } = runtime;
    refuseWhileSwitching();
    const body = await readJsonBody(request);
    const { cmd } = body;
    if (typeof cmd === 'string' && cmd !== '' && !READ_ONLY_COMMANDS.has(cmd)) {
      runtime.refuseWhileEditing();
    }
    if (typeof cmd !== 'string' || cmd === '') {
      throw new HttpError(400, 'bad_request', "request body needs a string 'cmd'");
    }
    if (cmd === 'frame') {
      throw new HttpError(400, 'bad_request', 'use GET /api/frame for frame requests');
    }
    const fields = { ...body };
    delete fields.cmd;
    const reply = await ask(cmd, fields);
    // A command that changed the world changes what every subscriber is looking
    // at. The read-only commands are excluded so that a poll of `state` does not
    // itself trigger a frame for every client.
    if (reply?.ok !== false && READ_ONLY_COMMANDS.has(cmd) === false) {
      hub.broadcastState(await stateReply());
      hub.invalidate();
    }
    sendJson(response, 200, reply);
  };

  /**
   * Open the Server-Sent Events stream.
   *
   * The connection stays open until the client goes away; the response is
   * registered so a shutdown ends it. An initial comment flushes the headers, so
   * a client knows it is connected before the first real event.
   */
  const handleEvents = async (runtime, request, response, url) => {
    const { hub, openResponses } = runtime;
    const viewport = readViewport(url.searchParams);
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    response.write(': connected\n\n');
    openResponses.add(response);

    const client = await hub.addClient({
      viewport: viewport ?? undefined,
      send: (event, payload) => {
        if (response.writableEnded || response.destroyed) return;
        response.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
      },
    });

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      hub.removeClient(client);
      openResponses.delete(response);
    };
    // `close` on the request fires for a client that goes away; `close` on the
    // response also fires when the server ends it. Both route to one release so
    // a subscriber can never be counted twice.
    request.on('close', release);
    response.on('close', release);
    request.on('error', release);
  };

  /**
   * Change the viewport a subscriber is watching.
   *
   * Server-Sent Events travel one way, so a client that pans or zooms cannot
   * tell the server through the stream itself. Reconnecting on every wheel
   * event would be worse than a small request, so the subscription is updated
   * over HTTP and the next frame is pushed on the same connection.
   */
  const handleSubscription = async (runtime, request, response) => {
    const { hub, refuseWhileSwitching } = runtime;
    refuseWhileSwitching();
    const body = await readJsonBody(request);
    const client = hub.clientById(body.clientId);
    if (!client) {
      throw new HttpError(404, 'unknown_client', `no event stream is open with clientId ${body.clientId}`);
    }
    const viewport = {};
    for (const key of ['x0', 'y0', 'w', 'h']) {
      const value = body[key];
      if (!Number.isInteger(value)) {
        throw new HttpError(400, 'bad_request', `'${key}' must be an integer`);
      }
      viewport[key] = value;
    }
    if (viewport.x0 < 0 || viewport.y0 < 0) {
      throw new HttpError(400, 'bad_request', "'x0' and 'y0' must not be negative");
    }
    if (viewport.w < 1 || viewport.h < 1) {
      throw new HttpError(400, 'bad_request', "'w' and 'h' must be positive");
    }
    const refusal = frameAdmission({
      area: viewport.w * viewport.h,
      population: hub.population,
      maxFrameCells,
    });
    if (refusal !== null) {
      throw new HttpError(400, refusal.error, refusal.message);
    }
    await hub.setViewport(client, viewport);
    sendJson(response, 200, { ok: true, clientId: client.id, viewport: client.viewport });
  };

  /**
   * The switch itself: export the world, restart the core, import it back, and
   * tell every subscriber what it is now talking to.
   *
   * The caller has already decided that `wanted` differs from the running
   * representation; this function owns the flag that makes the window
   * unobservable and always clears it.
   */
  const performSwitch = async (runtime, wanted) => {
    const { ask, bridge, hub, stateReply } = runtime;
    const current = bridge.representation;
    runtime.switching = true;
    try {
      const exported = await ask('export');
      const payload = exported?.export;
      if (!payload || typeof payload.data !== 'string') {
        throw new HttpError(502, 'export_failed', 'the core did not return an export payload');
      }

      // The recorded session travels with the switch. Without this the new core
      // opens the same store and starts a *new* session, which is the timeline
      // truncation C12 recorded; the id comes from the core itself, so the
      // service never has to guess which session the store's newest row is.
      const recorded = runtime.history ? await ask('history') : null;
      const continueSession =
        recorded?.ok === true && Number.isInteger(recorded.session) ? recorded.session : null;
      await bridge.restart({ representation: wanted, continueSession });

      // The rule travels with the world. A switch that dropped it would leave
      // the core running its default while the world it just imported was
      // generated by something else - and an export taken afterwards would carry
      // the wrong rule, which is how a session quietly changes its own meaning.
      // Sent back exactly as it came out; an export from a core that does not
      // report one simply omits it.
      const importArguments = {
        format: payload.format,
        data: payload.data,
        generation: payload.generation,
      };
      if (typeof payload.rule === 'string' && payload.rule !== '') {
        importArguments.rule = payload.rule;
      }
      const imported = await ask('import', importArguments);
      if (imported?.ok === false) {
        throw new HttpError(502, 'import_failed', imported.message ?? 'the core refused the import');
      }

      // The stream tells every client what it is now talking to, and the state
      // event carries the generation the switch preserved.
      hub.representation = wanted;
      const state = await stateReply();
      hub.broadcastState(state);
      hub.invalidate();
      return { current, payload, imported, state };
    } finally {
      runtime.switching = false;
    }
  };

  /**
   * Validate a representation request and perform it, or report that it is
   * already the running one.
   *
   * The offered vocabulary is read from the core, because a list copied here
   * would be the copy that drifts.
   */
  const switchRepresentation = async (runtime, wanted) => {
    const { ask, bridge, stateReply } = runtime;
    if (runtime.limits === null) await ask('hello');
    const offered = runtime.limits?.representations ?? [];
    if (typeof wanted !== 'string' || (offered.length > 0 && !offered.includes(wanted))) {
      throw new HttpError(
        400,
        'bad_request',
        `'representation' must be one of ${offered.join(', ') || 'the values the core offers'}, ` +
          `got ${JSON.stringify(wanted)}`,
      );
    }
    const current = bridge.representation;
    if (wanted === current) {
      return { switched: false, representation: current, current, state: await stateReply() };
    }
    if (runtime.switching) {
      throw new HttpError(
        503,
        'switch_in_progress',
        `a representation switch is already running (current: ${current})`,
      );
    }
    const result = await performSwitch(runtime, wanted);
    return { switched: true, representation: wanted, ...result };
  };

  const handleRepresentation = async (runtime, request, response) => {
    runtime.refuseWhileEditing();
    const body = await readJsonBody(request);
    const result = await switchRepresentation(runtime, body.representation);
    if (!result.switched) {
      sendJson(response, 200, {
        ok: true,
        switched: false,
        representation: result.representation,
        state: result.state,
      });
      return;
    }
    sendJson(response, 200, {
      ok: true,
      switched: true,
      representation: result.representation,
      previousRepresentation: result.current,
      exported: { population: result.payload.population, generation: result.payload.generation },
      imported: {
        changed: result.imported.changed,
        population: result.imported.population,
        generation: result.imported.generation,
      },
      state: result.state,
    });
  };

  /**
   * The library the page offers: names, kinds and the size each one occupies.
   *
   * The cells are not sent. A placement is a name and an origin, and the service
   * resolves the cells against the running world's size; a client that held the
   * cells would be a second copy of the data, and a client that sent them could
   * place a shape the library does not contain.
   */
  const handlePatterns = (response) => {
    sendJson(response, 200, {
      ok: true,
      patterns: patterns.map((pattern) => ({
        name: pattern.name,
        kind: pattern.kind,
        width: pattern.width,
        height: pattern.height,
        population: pattern.cells.length,
      })),
    });
  };

  /**
   * The live set from an `export` payload, as `[x, y]` pairs.
   *
   * The layout is the protocol's - little-endian int32 pairs - and this function
   * reads exactly that rather than inventing a second one. It answers null when
   * the payload does not match its own population, and the caller then declines
   * to choose instead of guessing from a partial set.
   */
  const decodeExportCells = (payload) => {
    if (!payload || typeof payload.data !== 'string') return null;
    if (!Number.isInteger(payload.population) || payload.population < 0) return null;
    const bytes = Buffer.from(payload.data, 'base64');
    if (bytes.length !== payload.population * 8) return null;
    const cells = new Array(payload.population);
    for (let index = 0; index < payload.population; index += 1) {
      cells[index] = [bytes.readInt32LE(index * 8), bytes.readInt32LE(index * 8 + 4)];
    }
    return cells;
  };

  /**
   * Reconsider the storage after a placement, from the whole live set.
   *
   * The shape is a property of the world rather than of the pattern: the same
   * pattern placed into an empty world and into a packed one are different
   * worlds. Below the measured crossover the choice is not taken, so a person's
   * manual choice of storage survives a small placement; above it, the measured
   * shape decides. An export that cannot be read leaves the running storage in
   * place.
   */
  const reconsiderRepresentation = async (runtime) => {
    const { ask, bridge } = runtime;
    if (runtime.limits === null) await ask('hello');
    const offered = runtime.limits?.representations ?? [];
    if (!offered.includes('tiled')) {
      return { representation: bridge.representation, switched: false };
    }
    const exported = await ask('export');
    const cells = decodeExportCells(exported?.export);
    if (cells === null) {
      return { representation: bridge.representation, switched: false, unreadableExport: true };
    }
    if (!hasMeasuredOpinion(cells.length)) {
      return { representation: bridge.representation, switched: false };
    }
    const wanted = chooseRepresentation(cells, offered, bridge.representation);
    if (wanted === bridge.representation) {
      return { representation: wanted, switched: false };
    }
    const result = await switchRepresentation(runtime, wanted);
    return { representation: wanted, switched: result.switched };
  };

  /**
   * Place a named pattern with its bounding box anchored at `(x, y)`.
   *
   * One request, one `set` command: the protocol already takes the whole
   * coordinate list, and the bounds are checked here before the core sees them.
   * After the write the storage is reconsidered from the measured shape; a
   * manual choice still stands until a placement large enough for the
   * measurement to have an opinion.
   */
  const handlePattern = async (runtime, request, response) => {
    const { ask, stateReply, hub, refuseWhileSwitching } = runtime;
    refuseWhileSwitching();
    runtime.refuseWhileEditing();
    const body = await readJsonBody(request);
    const { name, x, y } = body;
    if (typeof name !== 'string' || name === '') {
      throw new HttpError(400, 'bad_request', "request body needs a string 'name'");
    }
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      throw new HttpError(400, 'bad_request', "'x' and 'y' must be integers");
    }
    const pattern = patternByName.get(name);
    if (pattern === undefined) {
      throw new HttpError(
        404,
        'unknown_pattern',
        `no pattern named ${JSON.stringify(name)}; list them with GET /api/patterns`,
      );
    }
    const current = await stateReply();
    const width = current?.world?.width;
    const height = current?.world?.height;
    if (!Number.isInteger(width) || !Number.isInteger(height)) {
      throw new HttpError(502, 'bad_core_reply', 'the core did not report a world size');
    }
    let cells;
    try {
      cells = placedCells(pattern, x, y, width, height);
    } catch (error) {
      throw new HttpError(400, 'bad_placement', error.message);
    }
    const reply = await ask('set', { cells, alive: true });
    if (reply?.ok === false) {
      sendJson(response, 200, reply);
      return;
    }
    const choice = await reconsiderRepresentation(runtime);
    hub.broadcastState(await stateReply());
    hub.invalidate();
    sendJson(response, 200, {
      ...reply,
      name: pattern.name,
      cells: cells.length,
      width: pattern.width,
      height: pattern.height,
      representation: choice.representation,
      switched: choice.switched,
    });
  };

  /**
   * The live set of the generation the world is on, for a page that has to pick
   * a point inside it.
   *
   * The history page centres its preview on the live cell nearest to where the
   * world page was last looking. That needs the cells themselves, and the
   * cheapest honest source is the core's own `export`, which is already the
   * `cells` encoding `decode.mjs` reads and is already part of the protocol —
   * the alternative, a frame request per candidate rectangle, would scan the
   * world once per frame instead of once per selection.
   *
   * **A large population degrades rather than queues.** The payload is eight
   * bytes per cell before base64, so past `MAX_CELLS_FOR_NEAREST` the page is
   * given the population and the core's `bounds` instead of the live set, which
   * is a coarser centre in a reply that stays small. The page says so in words
   * when it happens: a preview centred on the middle of the bounding box is a
   * different answer from one centred on a cell, and the difference is stated
   * rather than hidden.
   */
  const handleCells = async (runtime, response) => {
    const { ask, refuseWhileSwitching } = runtime;
    refuseWhileSwitching();
    const exported = await ask('export');
    const payload = exported?.export;
    if (!payload || typeof payload.data !== 'string') {
      throw new HttpError(502, 'export_failed', 'the core did not return an export payload');
    }
    const population = Number.isInteger(payload.population) ? payload.population : 0;
    const generation = Number.isInteger(payload.generation) ? payload.generation : null;
    if (population > maxCellsForNearest) {
      const state = await ask('state');
      sendJson(response, 200, {
        ok: true,
        truncated: true,
        reason: 'population_above_cap',
        cap: maxCellsForNearest,
        population,
        generation,
        bounds: Array.isArray(state?.bounds) ? state.bounds : null,
        cells: null,
      });
      return;
    }
    sendJson(response, 200, {
      ok: true,
      truncated: false,
      population,
      generation,
      format: payload.format ?? 'cells',
      cells: payload.data,
    });
  };

  /**
   * The recorded generations, straight from the core.
   *
   * The core owns the timeline; this route exists so the page can reach it
   * without speaking the line protocol. A core started without a history refuses
   * the command, and that refusal is translated into one code of this layer's own
   * so the page can label it instead of showing a generic argument error.
   */
  const handleHistory = async (runtime, response) => {
    const { ask, refuseWhileSwitching } = runtime;
    refuseWhileSwitching();
    const reply = await ask('history');
    if (reply?.ok === false) {
      sendJson(response, 200, {
        ok: false,
        error: 'no_history',
        message: reply.message,
        history: false,
        generations: [],
      });
      return;
    }
    sendJson(response, 200, { ...reply, history: true });
  };

  /**
   * Restore a recorded generation.
   *
   * The world moves, so every subscriber is told the new state and shown a fresh
   * frame: a rollback that only the requesting client saw would leave the page in
   * one generation and the service in another.
   */
  const handleRollback = async (runtime, request, response) => {
    const { ask, stateReply, hub, refuseWhileSwitching } = runtime;
    refuseWhileSwitching();
    runtime.refuseWhileEditing();
    const body = await readJsonBody(request);
    const generation = body.generation;
    if (!Number.isInteger(generation) || generation < 0) {
      throw new HttpError(400, 'bad_request', "'generation' must be a non-negative integer");
    }
    const reply = await ask('rollback', { generation });
    if (reply?.ok === false) {
      sendJson(response, 200, reply);
      return;
    }
    const state = await stateReply();
    hub.broadcastState(state);
    hub.invalidate();
    sendJson(response, 200, { ...reply, state });
  };

  /**
   * Move the world and the recording head onto a recorded node.
   *
   * This is the operation the tree needs and a rollback is not: it moves the
   * working point, so whatever the user edits next is recorded as a *sibling* of
   * the nodes that already descend from this one. The world moves too, so every
   * subscriber is told and shown a fresh frame, exactly as for a rollback.
   *
   * Addressed by node id when the client has one, because a generation number is
   * only a label and two branches may hold the same one; the generation form is
   * accepted for the linear case and is resolved against the current branch by
   * the core.
   */
  const handleSelect = async (runtime, request, response) => {
    const { ask, stateReply, hub, refuseWhileSwitching } = runtime;
    refuseWhileSwitching();
    runtime.refuseWhileEditing();
    const body = await readJsonBody(request);
    const hasNode = Number.isInteger(body.node) && body.node > 0;
    const hasGeneration = Number.isInteger(body.generation) && body.generation >= 0;
    if (!hasNode && !hasGeneration) {
      throw new HttpError(
        400,
        'bad_request',
        "'node' or 'generation' must be a positive integer",
      );
    }
    const reply = await ask('select', hasNode ? { node: body.node } : { generation: body.generation });
    if (reply?.ok === false) {
      sendJson(response, 200, reply);
      return;
    }
    const state = await stateReply();
    hub.broadcastState(state);
    hub.invalidate();
    sendJson(response, 200, { ...reply, state });
  };

  /**
   * Write the recorded session to a portable archive.
   *
   * **A request names an archive; it does not choose a path.** An HTTP client
   * that could name an absolute path would be choosing where this process writes,
   * which is not a power a browser should have over a service on the same
   * machine. The name is therefore a plain file name, resolved inside the
   * archive directory, and anything containing a separator, a drive letter or a
   * traversal is refused rather than quietly repaired.
   */
  const handleArchive = async (runtime, request, response) => {
    const { ask, refuseWhileSwitching } = runtime;
    refuseWhileSwitching();
    const body = await readJsonBody(request).catch(() => ({}));
    // A session's default name carries its id: two sessions exporting under one
    // name would silently overwrite each other's file, and an archive is the one
    // thing a person may have no other copy of.
    const fallback = runtime.id === DEFAULT_SESSION_ID ? 'archive.jsonl' : `archive-${runtime.id}.jsonl`;
    const name = typeof body.name === 'string' && body.name !== '' ? body.name : fallback;
    const target = resolveArchivePath(name, archiveDir);
    if (target === null) {
      throw new HttpError(
        400,
        'bad_request',
        `'name' must be a plain .jsonl file name, got ${JSON.stringify(name)}`,
      );
    }
    const reply = await ask('archive', { path: target });
    if (reply?.ok === false) {
      sendJson(response, 200, reply);
      return;
    }
    sendJson(response, 200, {
      ...reply,
      name: path.basename(target),
    });
  };

  /**
   * Every archive in the directory, newest first.
   *
   * Only names this layer would itself accept are listed, so a file someone
   * dropped in the directory by hand cannot become a row the page then fails to
   * act on. The generation count is read from the file's line count rather than
   * by parsing it: the archive's *content* belongs to the store, and a second
   * reader here would be a second implementation of that format.
   */
  const listArchives = async () => {
    let names;
    try {
      names = await readdir(archiveDir);
    } catch {
      return [];
    }
    const entries = [];
    for (const name of names) {
      const target = resolveArchivePath(name, archiveDir);
      if (target === null) continue;
      let info;
      try {
        info = await stat(target);
      } catch {
        continue;
      }
      if (!info.isFile()) continue;
      entries.push({
        name,
        bytes: info.size,
        modified: info.mtime.toISOString(),
        generations: await countArchiveGenerations(target),
      });
    }
    entries.sort((left, right) => {
      if (left.modified === right.modified) return left.name.localeCompare(right.name);
      return left.modified < right.modified ? 1 : -1;
    });
    return entries;
  };

  const handleArchiveList = async (response) => {
    sendJson(response, 200, {
      ok: true,
      directory: path.basename(archiveDir),
      archives: await listArchives(),
    });
  };

  /** The two names an archive operation needs, both resolved and both checked. */
  const requireArchiveName = (value, field = 'name') => {
    const target = resolveArchivePath(value, archiveDir);
    if (target === null) {
      throw new HttpError(
        400,
        'bad_request',
        `'${field}' must be a plain .jsonl file name, got ${JSON.stringify(value)}`,
      );
    }
    return target;
  };

  const exists = async (target) => {
    try {
      const info = await stat(target);
      return info.isFile();
    } catch {
      return false;
    }
  };

  /**
   * Load an archive as the world the core is holding.
   *
   * **This asks the core for a command the protocol does not have yet.** Opening
   * an archive as a *session* — the whole timeline, not only its final world —
   * means replaying the store's deltas, and that belongs to the Python store
   * rather than to a JavaScript service that would then own a second
   * implementation of the archive format. The route therefore forwards
   * `{"cmd":"open"}` and reports the core's refusal honestly instead of
   * pretending the import happened. Until the core implements it the page says
   * so, in the reader's language, rather than showing an empty success.
   */
  const handleArchiveImport = async (runtime, request, response) => {
    const { ask, stateReply, hub, refuseWhileSwitching } = runtime;
    refuseWhileSwitching();
    runtime.refuseWhileEditing();
    const body = await readJsonBody(request);
    const target = requireArchiveName(body.name);
    if (!(await exists(target))) {
      throw new HttpError(404, 'not_found', `no archive named ${JSON.stringify(body.name)}`);
    }
    const reply = await ask('open', { path: target });
    if (reply?.ok === false) {
      const code = reply.error === 'unknown_command' ? 'archive_import_unsupported' : reply.error;
      sendJson(response, 200, { ok: false, error: code, message: reply.message });
      return;
    }
    const state = await stateReply();
    hub.broadcastState(state);
    hub.invalidate();
    sendJson(response, 200, { ...reply, name: path.basename(target), state });
  };

  const handleArchiveRename = async (request, response) => {
    const body = await readJsonBody(request);
    const from = requireArchiveName(body.name);
    const to = requireArchiveName(body.to, 'to');
    if (!(await exists(from))) {
      throw new HttpError(404, 'not_found', `no archive named ${JSON.stringify(body.name)}`);
    }
    if (await exists(to)) {
      throw new HttpError(400, 'archive_exists', `an archive named ${JSON.stringify(body.to)} exists`);
    }
    try {
      await rename(from, to);
    } catch (error) {
      throw new HttpError(500, 'bad_request', `cannot rename the archive: ${error.message}`);
    }
    sendJson(response, 200, {
      ok: true,
      from: path.basename(from),
      to: path.basename(to),
      archives: await listArchives(),
    });
  };

  const handleArchiveDelete = async (request, response) => {
    const body = await readJsonBody(request);
    const target = requireArchiveName(body.name);
    if (!(await exists(target))) {
      throw new HttpError(404, 'not_found', `no archive named ${JSON.stringify(body.name)}`);
    }
    try {
      await unlink(target);
    } catch (error) {
      throw new HttpError(500, 'bad_request', `cannot delete the archive: ${error.message}`);
    }
    sendJson(response, 200, {
      ok: true,
      name: path.basename(target),
      archives: await listArchives(),
    });
  };

  /**
   * Serve a composed page.
   *
   * The markup is assembled once per request from cached fragments — see
   * `routes.mjs` — and sent with the same no-store and nosniff headers the
   * static handler uses, because a page is as much a served document as a
   * stylesheet is.
   */
  const handlePage = (response, html) => {
    const body = Buffer.from(html, 'utf8');
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': body.length,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    response.end(body);
  };

  const handleStatic = async (response, url) => {
    const requested = url.pathname.replace(/^\/static\//, '');
    const filePath = resolveStaticPath(publicDir, requested);
    if (filePath === null) {
      throw new HttpError(403, 'forbidden', 'the requested path is not inside the public directory');
    }
    let info;
    try {
      info = await stat(filePath);
    } catch {
      throw new HttpError(404, 'not_found', `no such file: ${url.pathname}`);
    }
    if (!info.isFile()) {
      throw new HttpError(404, 'not_found', `no such file: ${url.pathname}`);
    }
    const body = await readFile(filePath);
    const contentType = CONTENT_TYPES.get(path.extname(filePath).toLowerCase()) ?? 'application/octet-stream';
    response.writeHead(200, {
      'content-type': contentType,
      'content-length': body.length,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    response.end(body);
  };

  // -- sessions ------------------------------------------------------------

  const handleSessions = (response) => {
    sendJson(response, 200, {
      ok: true,
      default: DEFAULT_SESSION_ID,
      cap: maxSessions,
      queueCap: maxQueuedSessions,
      queued: sessionWaiters.length,
      sessions: sessionSummaries(),
    });
  };

  /**
   * Create one more session: its own core, its own history and its own
   * subscribers.
   *
   * The id is generated by this service rather than chosen by a client, so two
   * sessions cannot silently share a history path. The representation is
   * validated against what a core offers, and the width and height are passed
   * through to the core, which refuses a size it cannot hold — the core remains
   * the authority for its own limits.
   */
  // -- the published snippet library ---------------------------------------
  //
  // A snippet is shared content, not session state: there is one library
  // directory beside the archives, and none of these routes takes a session.
  // The store owns the format, the hashes and the limits; this layer owns the
  // status each refusal becomes and the JSON envelope.
  const SNIPPET_STATUS = Object.freeze({
    invalid_name: 400,
    invalid_snippet: 400,
    invalid_hash: 400,
    too_large: 413,
    name_conflict: 409,
    hash_mismatch: 409,
    unknown_snippet: 404,
    missing_index: 404,
    missing_object: 500,
    invalid_content: 500,
    corrupt_index: 500,
    store_io: 500,
  });

  const snippetFailure = (error) => {
    if (error instanceof SnippetError) {
      const status = SNIPPET_STATUS[error.code] ?? 500;
      throw new HttpError(status, error.code, error.message);
    }
    throw error;
  };

  const handleSnippets = async (response) => {
    try {
      sendJson(response, 200, { ok: true, snippets: await snippets.list() });
    } catch (error) {
      // An empty library has no index yet, which is not an error to a client
      // that asked what is available.
      if (error instanceof SnippetError && error.code === 'missing_index') {
        sendJson(response, 200, { ok: true, snippets: [] });
        return;
      }
      snippetFailure(error);
    }
  };

  const handleSnippetPublish = async (request, response) => {
    const body = await readJsonBody(request);
    try {
      const snippet = await snippets.publish({
        name: body.name,
        cells: body.cells,
        width: body.width,
        height: body.height,
        expectedHash: body.expectedHash,
      });
      sendJson(response, 200, { ok: true, snippet });
    } catch (error) {
      snippetFailure(error);
    }
  };

  const handleSnippetRead = async (name, searchParams, response) => {
    try {
      const snippet = await snippets.read(name, { hash: searchParams.get('hash') });
      sendJson(response, 200, { ok: true, snippet });
    } catch (error) {
      snippetFailure(error);
    }
  };

  const handleSnippetDelete = async (name, request, response) => {
    const body = await readJsonBody(request).catch(() => ({}));
    try {
      const snippet = await snippets.remove(name, { expectedHash: body.expectedHash });
      sendJson(response, 200, { ok: true, snippet });
    } catch (error) {
      snippetFailure(error);
    }
  };

  const handleCreateSession = async (request, response) => {
    const body = await readJsonBody(request).catch(() => ({}));
    const representation = body.representation ?? 'sparse';
    const width = body.width ?? null;
    const height = body.height ?? null;
    const label = typeof body.label === 'string' && body.label !== '' ? body.label : null;
    if (typeof representation !== 'string') {
      throw new HttpError(400, 'bad_request', "'representation' must be a string");
    }
    if (width !== null && (!Number.isInteger(width) || width < 1)) {
      throw new HttpError(400, 'bad_request', "'width' must be a positive integer");
    }
    if (height !== null && (!Number.isInteger(height) || height < 1)) {
      throw new HttpError(400, 'bad_request', "'height' must be a positive integer");
    }
    // The vocabulary is the core's, so the default session's core is asked what
    // it offers rather than a list being copied here.
    if (mainRuntime.limits === null) await mainRuntime.ask('hello');
    const offered = mainRuntime.limits?.representations ?? [];
    if (offered.length > 0 && !offered.includes(representation)) {
      throw new HttpError(
        400,
        'bad_request',
        `'representation' must be one of ${offered.join(', ')}, got ${JSON.stringify(representation)}`,
      );
    }

    // At the cap, this request waits for a session to close — unless the queue
    // is already full, in which case it is refused now rather than held open.
    if (runtimes.size >= maxSessions && sessionWaiters.length >= maxQueuedSessions) {
      throw new HttpError(
        503,
        'session_queue_full',
        `the session queue is full (${maxQueuedSessions} waiting); close a session and retry`,
      );
    }
    while (runtimes.size >= maxSessions) await waitForSlot();

    nextSessionNumber += 1;
    const id = `s${nextSessionNumber}`;
    const historyPath = body.history === false ? null : sessionHistoryPath(id, sessionsDir);
    const sessionBridge = createBridge({
      worldWidth: width,
      worldHeight: height,
      representation,
      historyPath,
    });
    const runtime = createSessionRuntime({
      id,
      label: label ?? id,
      bridge: sessionBridge,
      ownsBridge: true,
      maxFrameCells,
    });
    runtimes.set(id, runtime);
    try {
      const state = await runtime.stateReply();
      sendJson(response, 200, { ok: true, session: { id, label: runtime.label }, state });
    } catch (error) {
      runtimes.delete(id);
      await runtime.close();
      wakeWaiters();
      throw error;
    }
  };

  // -- the editing mode ----------------------------------------------------
  //
  // A transaction is one atomic edit; the runtime owns the document and the
  // pause, and this layer owns the HTTP status a refusal becomes.
  const EDIT_STATUS = Object.freeze({
    bad_arguments: 400,
    too_large: 413,
    stale_base: 409,
    stale_generation: 409,
    duplicate_tx: 409,
    unknown_transaction: 404,
    not_editing: 409,
  });

  const editFailure = (error) => {
    if (error instanceof EditError) {
      throw new HttpError(EDIT_STATUS[error.code] ?? 500, error.code, error.message);
    }
    throw error;
  };

  const handleEditEnter = async (runtime, response) => {
    try {
      sendJson(response, 200, await runtime.edit.enter());
    } catch (error) {
      editFailure(error);
    }
  };

  const handleEditLeave = async (runtime, response) => {
    try {
      sendJson(response, 200, await runtime.edit.leave());
    } catch (error) {
      editFailure(error);
    }
  };

  const handleEditTransaction = async (runtime, request, response) => {
    const body = await readJsonBody(request);
    try {
      sendJson(response, 200, await runtime.edit.commit(body));
    } catch (error) {
      editFailure(error);
    }
  };

  const handleEditUndo = async (runtime, request, response) => {
    const body = await readJsonBody(request).catch(() => ({}));
    try {
      sendJson(response, 200, await runtime.edit.undo(body));
    } catch (error) {
      editFailure(error);
    }
  };

  const handleEditRedo = async (runtime, request, response) => {
    const body = await readJsonBody(request).catch(() => ({}));
    try {
      sendJson(response, 200, await runtime.edit.redo(body));
    } catch (error) {
      editFailure(error);
    }
  };

  const handleEditState = (runtime, url, response) => {
    try {
      sendJson(response, 200, runtime.edit.state(url.searchParams.get('since')));
    } catch (error) {
      editFailure(error);
    }
  };

  /** Presence is ephemeral: it is recorded, broadcast, and never written down. */
  const handleEditPresence = async (runtime, request, response) => {
    const body = await readJsonBody(request);
    try {
      sendJson(response, 200, runtime.edit.presenceOf(body.clientId, body));
    } catch (error) {
      editFailure(error);
    }
  };

  const handleEditPresenceList = (runtime, response) => {
    try {
      sendJson(response, 200, { ok: true, presence: runtime.edit.presenceList() });
    } catch (error) {
      editFailure(error);
    }
  };

  const handleCloseSession = async (request, response) => {
    const body = await readJsonBody(request);
    const id = body.session;
    if (typeof id !== 'string' || id === '') {
      throw new HttpError(400, 'bad_request', "request body needs a string 'session'");
    }
    if (id === DEFAULT_SESSION_ID) {
      throw new HttpError(400, 'default_session', 'the default session cannot be closed');
    }
    const runtime = sessionById(id);
    runtimes.delete(id);
    await runtime.close();
    wakeWaiters();
    sendJson(response, 200, { ok: true, session: id });
  };

  /**
   * The surfaces an editor may rely on, named rather than restated.
   *
   * The single-machine editing API is implemented; collaboration and roles are
   * still planned. This route names the HTTP surfaces, the session rules, the
   * shareable view point, the editing limits and the mode's state, which is the
   * seam a page or an API client builds on. The command vocabulary is
   * deliberately absent: it belongs to the core's protocol, and a copy here would
   * be the copy that drifts.
   */
  const handleCapabilities = async (runtime, response) => {
    const state = await runtime.stateReply();
    sendJson(response, 200, {
      ok: true,
      session: runtime.id,
      world: state.world ?? null,
      rule: state.rule ?? null,
      representation: runtime.bridge.representation,
      limits: state.limits ?? null,
      history: runtime.history,
      surfaces: {
        command: '/api/command',
        pattern: '/api/pattern',
        patterns: '/api/patterns',
        snippets: '/api/snippets',
        edit: '/api/edit',
        editTransaction: '/api/edit/transaction',
        editState: '/api/edit/state',
        editPresence: '/api/edit/presence',
        sessions: '/api/sessions',
        closeSession: '/api/sessions/close',
        events: '/api/events',
      },
      sessions: {
        default: DEFAULT_SESSION_ID,
        cap: maxSessions,
        queueCap: maxQueuedSessions,
        queued: sessionWaiters.length,
      },
      focus: { shareable: 'url', parameter: 'focus' },
      editing: {
        mode: 'implemented',
        paused: true,
        limits: { side: MAX_EDIT_SIDE, cells: MAX_EDIT_CELLS },
        transaction: '/api/edit/transaction',
        state: '/api/edit/state',
        presence: '/api/edit/presence',
        undo: '/api/edit/undo',
        redo: '/api/edit/redo',
      },
    });
  };

  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
    const route = `${request.method} ${url.pathname}`;
    const sessionId = url.searchParams.get('session') ?? DEFAULT_SESSION_ID;

    const dispatch = async () => {
      if (request.method === 'GET') {
        // The routed pages first. `render` answers null for a path no route
        // claims, and the dispatch falls through to the 404 at the bottom —
        // there is deliberately no default page.
        const page = pages.render(url.pathname);
        if (page !== null) return handlePage(response, page);
      }
      if (request.method === 'GET' && url.pathname.startsWith('/static/')) {
        return handleStatic(response, url);
      }
      if (request.method === 'GET' && url.pathname === '/api/sessions') {
        return handleSessions(response);
      }
      if (request.method === 'POST' && url.pathname === '/api/sessions') {
        return handleCreateSession(request, response);
      }
      if (request.method === 'POST' && url.pathname === '/api/sessions/close') {
        return handleCloseSession(request, response);
      }
      if (request.method === 'GET' && url.pathname === '/api/state') {
        const runtime = sessionById(sessionId);
        runtime.refuseWhileSwitching();
        return sendJson(response, 200, await runtime.stateReply());
      }
      if (request.method === 'GET' && url.pathname === '/api/frame') {
        return handleFrame(sessionById(sessionId), request, response, url);
      }
      if (request.method === 'GET' && url.pathname === '/api/events') {
        return handleEvents(sessionById(sessionId), request, response, url);
      }
      if (request.method === 'POST' && url.pathname === '/api/command') {
        return handleCommand(sessionById(sessionId), request, response);
      }
      if (request.method === 'GET' && url.pathname === '/api/patterns') {
        return handlePatterns(response);
      }
      if (request.method === 'GET' && url.pathname === '/api/snippets') {
        return handleSnippets(response);
      }
      if (request.method === 'POST' && url.pathname === '/api/snippets') {
        return handleSnippetPublish(request, response);
      }
      if (url.pathname.startsWith('/api/snippets/')) {
        let name;
        try {
          name = decodeURIComponent(url.pathname.slice('/api/snippets/'.length));
        } catch {
          throw new HttpError(400, 'bad_request', 'the snippet name is not valid URL encoding');
        }
        if (name === '' || name.includes('/')) {
          throw new HttpError(404, 'not_found', 'no such snippet');
        }
        if (request.method === 'GET') {
          return handleSnippetRead(name, url.searchParams, response);
        }
        if (request.method === 'DELETE') {
          return handleSnippetDelete(name, request, response);
        }
        throw new HttpError(404, 'not_found', 'no such route');
      }
      if (request.method === 'GET' && url.pathname === '/api/capabilities') {
        return handleCapabilities(sessionById(sessionId), response);
      }
      if (request.method === 'GET' && url.pathname === '/api/edit') {
        return sendJson(response, 200, sessionById(sessionId).edit.state());
      }
      if (request.method === 'POST' && url.pathname === '/api/edit/enter') {
        return handleEditEnter(sessionById(sessionId), response);
      }
      if (request.method === 'POST' && url.pathname === '/api/edit/leave') {
        return handleEditLeave(sessionById(sessionId), response);
      }
      if (request.method === 'POST' && url.pathname === '/api/edit/transaction') {
        return handleEditTransaction(sessionById(sessionId), request, response);
      }
      if (request.method === 'POST' && url.pathname === '/api/edit/undo') {
        return handleEditUndo(sessionById(sessionId), request, response);
      }
      if (request.method === 'POST' && url.pathname === '/api/edit/redo') {
        return handleEditRedo(sessionById(sessionId), request, response);
      }
      if (request.method === 'GET' && url.pathname === '/api/edit/state') {
        return handleEditState(sessionById(sessionId), url, response);
      }
      if (request.method === 'GET' && url.pathname === '/api/edit/presence') {
        return handleEditPresenceList(sessionById(sessionId), response);
      }
      if (request.method === 'POST' && url.pathname === '/api/edit/presence') {
        return handleEditPresence(sessionById(sessionId), request, response);
      }
      if (request.method === 'POST' && url.pathname === '/api/pattern') {
        return handlePattern(sessionById(sessionId), request, response);
      }
      if (request.method === 'POST' && url.pathname === '/api/subscription') {
        return handleSubscription(sessionById(sessionId), request, response);
      }
      if (request.method === 'POST' && url.pathname === '/api/representation') {
        return handleRepresentation(sessionById(sessionId), request, response);
      }
      if (request.method === 'GET' && url.pathname === '/api/history') {
        return handleHistory(sessionById(sessionId), response);
      }
      if (request.method === 'GET' && url.pathname === '/api/cells') {
        return handleCells(sessionById(sessionId), response);
      }
      if (request.method === 'POST' && url.pathname === '/api/rollback') {
        return handleRollback(sessionById(sessionId), request, response);
      }
      if (request.method === 'POST' && url.pathname === '/api/select') {
        return handleSelect(sessionById(sessionId), request, response);
      }
      if (request.method === 'POST' && url.pathname === '/api/archive') {
        return handleArchive(sessionById(sessionId), request, response);
      }
      if (request.method === 'GET' && url.pathname === '/api/archives') {
        return handleArchiveList(response);
      }
      if (request.method === 'POST' && url.pathname === '/api/archive/import') {
        return handleArchiveImport(sessionById(sessionId), request, response);
      }
      if (request.method === 'POST' && url.pathname === '/api/archive/rename') {
        return handleArchiveRename(request, response);
      }
      if (request.method === 'POST' && url.pathname === '/api/archive/delete') {
        return handleArchiveDelete(request, response);
      }
      throw new HttpError(404, 'not_found', `no route for ${route}`);
    };

    dispatch().catch((error) => {
      if (error instanceof HttpError) {
        sendJson(response, error.status, {
          ok: false,
          error: error.code,
          message: error.message,
        });
        return;
      }
      if (error instanceof CoreUnavailableError) {
        sendJson(response, 503, { ok: false, error: 'core_unavailable', message: error.message });
        return;
      }
      if (error instanceof CoreTimeoutError) {
        sendJson(response, 504, { ok: false, error: 'core_timeout', message: error.message });
        return;
      }
      sendJson(response, 500, {
        ok: false,
        error: 'internal',
        message: `${error?.name ?? 'Error'}: ${error?.message ?? error}`,
      });
    });
  });

  /**
   * Close the listener and, when this server created it, the core.
   *
   * Idle keep-alive sockets are destroyed first: `server.close()` alone waits
   * for them to time out, which would hang a test teardown that has already
   * stopped making requests.
   */
  server.closeViewer = async () => {
    // A queued creation cannot be served by a service that is closing; tell it
    // so rather than leaving the HTTP request hanging.
    for (const waiter of sessionWaiters.splice(0)) {
      waiter.reject(new HttpError(503, 'service_closing', 'the service is shutting down'));
    }
    // Every session first: an open event stream is a live connection, and
    // `server.close()` alone would wait for it. Each runtime ends its own
    // subscribers and, when this server created it, its own core.
    for (const runtime of runtimes.values()) await runtime.close();
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  };

  server.bridge = bridge;
  return server;
}

/**
 * Start a viewer on an ephemeral or explicit port.
 *
 * `port: 0` asks the operating system for a free port, which is what the tests
 * use so that a run never collides with a developer's own server.
 */
export async function startViewerServer(options = {}) {
  const createdBridge = options.bridge === undefined;
  const bridge = options.bridge ?? new CoreBridge(options.bridgeOptions ?? {});
  const server = createViewerServer({ ...options, bridge, ownsBridge: createdBridge });
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 8765;

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  const url = `http://${host}:${address.port}`;
  return {
    server,
    bridge,
    host,
    port: address.port,
    url,
    close: () => server.closeViewer(),
  };
}

function parseArguments(argv) {
  const options = {
    port: 8765,
    host: '127.0.0.1',
    // Null means "let the core decide", which is why the design target is not
    // written here: it is the core's default and appears once, in the core.
    worldWidth: null,
    worldHeight: null,
    representation: 'sparse',
    // Recording is on by default for a real server, into a file inside the
    // repository; `--no-history` turns it off and `--history <path>` moves it.
    historyPath: defaultHistoryPath,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    switch (flag) {
      case '--port':
        options.port = Number.parseInt(value, 10);
        index += 1;
        break;
      case '--host':
        options.host = value;
        index += 1;
        break;
      case '--width':
        options.worldWidth = Number.parseInt(value, 10);
        index += 1;
        break;
      case '--height':
        options.worldHeight = Number.parseInt(value, 10);
        index += 1;
        break;
      case '--representation':
        options.representation = value;
        index += 1;
        break;
      case '--history':
        options.historyPath = value;
        index += 1;
        break;
      case '--no-history':
        options.historyPath = null;
        break;
      case '--python':
        options.pythonPath = value;
        index += 1;
        break;
      case '--help':
        options.help = true;
        break;
      default:
        break;
    }
  }
  return options;
}

const runDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (runDirectly) {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(
      'usage: node src/viewer/server.mjs [--port 8765] [--host 127.0.0.1]\n' +
        '       [--width N] [--height N] [--representation NAME]\n' +
        '       [--history <path>] [--no-history] [--python <path>]\n' +
        '\n' +
        'The world size, the representations and the rate bounds are the core\'s:\n' +
        'omit --width/--height to use its defaults, and see its `hello` reply for\n' +
        'what it offers. A history is recorded by default at data/history.db.\n',
    );
    process.exit(0);
  }
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
    process.stderr.write(`viewer: --port must be an integer in 0..65535, got ${options.port}\n`);
    process.exit(2);
  }

  // No local vocabulary of representations: a name the core does not offer is
  // refused by the core, and its stderr is what says so.
  const bridgeOptions = { representation: options.representation };
  if (Number.isInteger(options.worldWidth)) bridgeOptions.worldWidth = options.worldWidth;
  if (Number.isInteger(options.worldHeight)) bridgeOptions.worldHeight = options.worldHeight;
  if (options.historyPath) bridgeOptions.historyPath = options.historyPath;
  // Absent `--python`, the bridge uses the project's own interpreter, so the
  // default is not repeated here.
  if (options.pythonPath) bridgeOptions.pythonPath = options.pythonPath;

  const viewer = await startViewerServer({
    port: options.port,
    host: options.host,
    bridgeOptions,
  });

  process.stdout.write(`viewer: listening on ${viewer.url}\n`);
  process.stdout.write(
    options.historyPath
      ? `viewer: recording history to ${options.historyPath}\n`
      : 'viewer: not recording a history (--no-history)\n',
  );

  const shutdown = async (signal) => {
    process.stdout.write(`viewer: ${signal} received, stopping\n`);
    try {
      await viewer.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}
