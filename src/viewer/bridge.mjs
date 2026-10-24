/**
 * lifegame viewer — the bridge that drives the Python world core.
 *
 * The core is the authority for the world. This file never computes a
 * generation, never reads the core's memory and never second-guesses a reply;
 * it starts the core as a child process, writes one JSON request per line and
 * matches answers by `id`.
 *
 * Protocol authority: src/lifegame/world/bridge.py (module docstring and
 * `Bridge._cmd_*`). The two `frame` encodings are defined there and reproduced
 * in README.md; they are not re-derived here.
 *
 * Two properties make this bridge usable from an HTTP server:
 *
 * - **One request in flight.** Requests are queued and issued strictly one at a
 *   time, so the reply stream cannot be reordered and a slow `frame` cannot be
 *   overtaken by the next poll. The pending map exists because answers travel
 *   asynchronously on stdout, not because several may be outstanding.
 * - **A bounded restart policy.** A crash increments a counter; any reply at
 *   all clears it. A request that arrives while the counter is non-zero waits
 *   out an exponential backoff and then starts a fresh child, so a restart is
 *   transparent to the caller. Once the counter reaches the limit the bridge
 *   refuses to respawn and every request fails with `core_unavailable`, which
 *   is what stops a core that dies on start-up from being respawned forever.
 *
 * No file is written by this module: transport is pipes, and logging is left to
 * the caller. The one file the *core* may write is its history store, and only
 * when the caller asked for one by naming a path.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { readLimits } from './public/shared.mjs';

/** The protocol version this bridge speaks, from the core's own constant. */
export const PROTOCOL_VERSION = 1;

/** Repository root, resolved from this file rather than from the caller's cwd. */
export const repoRoot = path.resolve(import.meta.dirname, '..', '..');

/**
 * The interpreter the project provisions for itself: `<repo>/.venv/Scripts/
 * python.exe` on Windows, `<repo>/.venv/bin/python` elsewhere.
 */
export function defaultPythonPath(root = repoRoot) {
  return process.platform === 'win32'
    ? path.join(root, '.venv', 'Scripts', 'python.exe')
    : path.join(root, '.venv', 'bin', 'python');
}

/** What a caller should do when the interpreter is missing. */
export const BOOTSTRAP_HINT =
  'run: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/bootstrap.ps1';

/** Raised when the core is not running and could not be started. */
export class CoreUnavailableError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'CoreUnavailableError';
    this.code = 'core_unavailable';
  }
}

/** Raised when the core is running but did not answer in time. */
export class CoreTimeoutError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'CoreTimeoutError';
    this.code = 'core_timeout';
  }
}

/**
 * The command line the core is started with.
 *
 * Exported because it is a decision, not an implementation detail: the world
 * size is omitted unless the caller named one, so the design target lives in the
 * core and nowhere else, and the history flag appears only when a path was
 * given. A test asserts both, because a duplicated default is invisible until it
 * drifts.
 *
 * @param {{worldWidth?: number|null, worldHeight?: number|null,
 *   representation: string, historyPath?: string|null,
 *   continueSession?: number|null}} options
 * @returns {string[]}
 */
export function coreArguments(options) {
  const args = ['-m', 'lifegame.world', '--representation', options.representation];
  if (Number.isInteger(options.worldWidth)) args.push('--width', String(options.worldWidth));
  if (Number.isInteger(options.worldHeight)) args.push('--height', String(options.worldHeight));
  if (options.historyPath) args.push('--history', options.historyPath);
  if (Number.isInteger(options.continueSession)) {
    args.push('--continue-session', String(options.continueSession));
  }
  return args;
}

const DEFAULTS = {
  // No world size here on purpose: the core owns its default, and a copy of it
  // in this file would be the copy that drifts. Omitted, the argument is not
  // passed and the core decides.
  worldWidth: null,
  worldHeight: null,
  representation: 'sparse',
  historyPath: null,
  continueSession: null,
  requestTimeoutMs: 30000,
  crashLimit: 3,
  restartBaseDelayMs: 250,
  restartMaxDelayMs: 4000,
  killGraceMs: 750,
};

export class CoreBridge {
  /** @type {import('node:child_process').ChildProcess | null} */
  #child = null;
  /** @type {Map<number, {resolve: Function, reject: Function, timer: any}>} */
  #pending = new Map();
  #nextId = 1;
  #stdoutBuffer = '';
  #stderrBuffer = '';
  #queue = Promise.resolve();
  #stopping = false;
  #crashes = 0;
  #lastFailureAt = 0;
  #lastError = null;
  #listeners = new Set();
  #requests = 0;
  #options;
  /**
   * The child this bridge is deliberately taking down.
   *
   * A restart has to be distinguishable from a crash: the crash counter exists
   * to stop a core that dies on start-up from being respawned forever, and a
   * switch between representations is a planned exit. Without this, one
   * representation switch would spend one of the three lives.
   */
  #expectedExit = null;
  /**
   * The limits the core declared in its last `hello`.
   *
   * The vocabulary of representations is the core's, not this file's: the bridge
   * validates a restart against what the core said it offers rather than against
   * a list copied here. Until a `hello` has been seen there is nothing to
   * validate against, and the request is passed through so the core answers for
   * itself.
   */
  #limits = null;

  constructor(options = {}) {
    this.#options = { ...DEFAULTS, ...options };
    this.pythonPath = options.pythonPath ?? defaultPythonPath(options.repoRoot ?? repoRoot);
    this.cwd = options.cwd ?? options.repoRoot ?? repoRoot;
    this.worldWidth = this.#options.worldWidth;
    this.worldHeight = this.#options.worldHeight;
  }

  /** True while a child process is attached. */
  get running() {
    return this.#child !== null;
  }

  /**
   * The child's pid, or null. Exposed for logging and for tests that need to
   * simulate a core crash without reaching into private state.
   */
  get pid() {
    return this.#child?.pid ?? null;
  }

  /** A snapshot for diagnostics; never consulted by the request path. */
  stats() {
    return {
      running: this.running,
      pid: this.pid,
      pending: this.#pending.size,
      requests: this.#requests,
      crashes: this.#crashes,
      crashLimit: this.#options.crashLimit,
      lastError: this.#lastError,
    };
  }

  /** Stderr collected from the child, for logs. Never part of the protocol. */
  get stderr() {
    return this.#stderrBuffer;
  }

  /** Which representation the core is started on: `sparse` or `tiled`. */
  get representation() {
    return this.#options.representation;
  }

  /** Subscribe to unsolicited events (`tick`). Returns an unsubscribe function. */
  onEvent(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Issue a request, queued behind every request already accepted. Resolves
   * with the core's reply, which carries the `id` this call assigned.
   *
   * @param {string} cmd
   * @param {object} [fields]
   * @param {{timeoutMs?: number}} [options]
   */
  async request(cmd, fields = {}, options = {}) {
    const run = this.#queue.then(
      () => this.#issue(cmd, fields, options),
      () => this.#issue(cmd, fields, options),
    );
    // Keep the queue alive after a rejection: the next caller must still run.
    this.#queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** Start the child without waiting for a reply. Returns its pid. */
  start() {
    this.#ensureChild();
    return this.pid;
  }

  /** Send `quit`, wait for the child to leave, then make sure it is gone. */
  async stop() {
    this.#stopping = true;
    await this.#shutdownChild();
  }

  /** The representations the core last said it offers, or an empty list. */
  get representations() {
    return this.#limits?.representations ?? [];
  }

  /** The limits the core declared, or null before the first `hello`. */
  get limits() {
    return this.#limits;
  }

  /**
   * Replace the running core with a fresh one, optionally on another
   * representation.
   *
   * The caller is responsible for carrying the world across: this method starts
   * an *empty* world, because the core holds the only copy of the live set and
   * this bridge cannot read it. `POST /api/representation` does exactly that —
   * export, restart, import — and leaves the two halves adjacent so the window
   * in which the world is empty is not observable from outside.
   *
   * @param {{representation?: string, continueSession?: number|null}} [options]
   */
  async restart(options = {}) {
    const wanted = options.representation;
    if (wanted !== undefined) {
      const offered = this.representations;
      if (offered.length > 0 && !offered.includes(wanted)) {
        throw new RangeError(
          `representation must be one of ${offered.join(', ')}, got ${JSON.stringify(wanted)}`,
        );
      }
      this.#options.representation = wanted;
    }
    if (options.continueSession !== undefined) {
      // A planned restart can hand the new core the recorded session it should
      // keep writing to. The option persists for later restarts because the
      // session remains the one this core was recording; a switch that wants a
      // fresh session passes null and clears it.
      this.#options.continueSession = options.continueSession;
    }
    await this.#shutdownChild();
    // A planned restart is not a strike against the crash limit.
    this.#crashes = 0;
    return this.start();
  }

  // -- internals ---------------------------------------------------------

  /** Take the child down, whether or not it answers `quit`. */
  async #shutdownChild() {
    const child = this.#child;
    if (!child) return;
    this.#expectedExit = child;
    try {
      await this.request('quit', {}, { timeoutMs: 2000 });
    } catch {
      // A core that cannot answer `quit` is killed below regardless.
    }
    await this.#waitForExit(child, this.#options.killGraceMs);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await this.#waitForExit(child, this.#options.killGraceMs);
    }
    this.#detach(child);
  }

  /**
   * Wait out the backoff that follows a crash. A request that arrives during
   * the window is delayed rather than refused, so a restart is invisible to
   * the caller; only the crash limit produces `core_unavailable`.
   */
  #awaitRestartWindow() {
    if (this.#child !== null || this.#crashes === 0) return Promise.resolve();
    const delay = this.#restartDelayMs();
    const waited = Date.now() - this.#lastFailureAt;
    if (waited >= delay) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, delay - waited);
      if (typeof timer.unref === 'function') timer.unref();
    });
  }

  #restartDelayMs() {
    const exponent = Math.max(0, this.#crashes - 1);
    return Math.min(
      this.#options.restartBaseDelayMs * 2 ** exponent,
      this.#options.restartMaxDelayMs,
    );
  }

  #ensureChild() {
    if (this.#child) return this.#child;
    if (this.#stopping) {
      throw new CoreUnavailableError('the core bridge is stopping');
    }
    if (!existsSync(this.pythonPath)) {
      throw new CoreUnavailableError(
        `the world core interpreter is missing: ${this.pythonPath} (${BOOTSTRAP_HINT})`,
      );
    }
    if (this.#crashes >= this.#options.crashLimit) {
      throw new CoreUnavailableError(
        `the world core crashed ${this.#crashes} times without answering; refusing to restart ` +
          `(last error: ${this.#lastError ?? 'unknown'})`,
      );
    }

    const args = coreArguments({
      worldWidth: this.worldWidth,
      worldHeight: this.worldHeight,
      representation: this.#options.representation,
      historyPath: this.#options.historyPath,
      continueSession: this.#options.continueSession,
    });
    let child;
    try {
      child = spawn(this.pythonPath, args, {
        cwd: this.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      this.#recordCrash(`spawn failed: ${error.message}`);
      throw new CoreUnavailableError(`the world core could not start: ${error.message}`);
    }

    this.#child = child;
    this.#stdoutBuffer = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => this.#onStdout(chunk));
    child.stderr.on('data', (chunk) => {
      this.#stderrBuffer = (this.#stderrBuffer + chunk).slice(-8192);
    });
    child.on('error', (error) => {
      this.#recordCrash(`spawn failed: ${error.message}`);
      this.#detach(child);
    });
    child.on('exit', (code, signal) => {
      if (this.#expectedExit === child) {
        // A restart or a shutdown asked for this exit; it is not a failure.
        this.#expectedExit = null;
        this.#detach(child);
        return;
      }
      const how = signal ? `signal ${signal}` : `exit code ${code}`;
      // A core that dies during start-up has already said why on stderr, and
      // that is the only place the reason exists: without it a bad command-line
      // argument reads as "the core stopped" and nothing else.
      const detail = this.#stderrBuffer.trim();
      this.#recordCrash(
        detail === ''
          ? `the world core stopped (${how})`
          : `the world core stopped (${how}): ${detail.slice(-600)}`,
      );
      this.#detach(child);
    });
    return child;
  }

  #recordCrash(reason) {
    this.#lastError = reason;
    this.#lastFailureAt = Date.now();
    this.#crashes += 1;
    this.#failPending(new CoreUnavailableError(reason));
  }

  #detach(child) {
    if (this.#child === child) this.#child = null;
  }

  #waitForExit(child, timeoutMs) {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  async #issue(cmd, fields, options) {
    await this.#awaitRestartWindow();
    const child = this.#ensureChild();
    const id = this.#nextId++;
    this.#requests += 1;
    const line = `${JSON.stringify({ cmd, ...fields, id })}\n`;
    const timeoutMs = options.timeoutMs ?? this.#options.requestTimeoutMs;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new CoreTimeoutError(`the world core did not answer '${cmd}' within ${timeoutMs} ms`));
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
      this.#pending.set(id, { resolve, reject, timer });
      child.stdin.write(line, 'utf8', (error) => {
        if (!error) return;
        const entry = this.#pending.get(id);
        if (!entry) return;
        this.#pending.delete(id);
        clearTimeout(entry.timer);
        entry.reject(new CoreUnavailableError(`writing to the world core failed: ${error.message}`));
      });
    });
  }

  #onStdout(chunk) {
    this.#stdoutBuffer += chunk;
    let newline = this.#stdoutBuffer.indexOf('\n');
    while (newline !== -1) {
      const line = this.#stdoutBuffer.slice(0, newline).replace(/\r$/, '');
      this.#stdoutBuffer = this.#stdoutBuffer.slice(newline + 1);
      if (line.trim() !== '') this.#onLine(line);
      newline = this.#stdoutBuffer.indexOf('\n');
    }
  }

  #onLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.#lastError = `the world core wrote a line that is not JSON: ${line.slice(0, 200)}`;
      return;
    }
    if (message === null || typeof message !== 'object') return;

    if ('event' in message && !('id' in message)) {
      // Any traffic from the core proves it is alive, which is what the crash
      // counter measures.
      this.#crashes = 0;
      for (const listener of this.#listeners) {
        try {
          listener(message);
        } catch {
          // A broken listener must not take down the transport.
        }
      }
      return;
    }

    const id = message.id;
    if (typeof id !== 'number') {
      this.#lastError = `the world core answered without an id: ${line.slice(0, 200)}`;
      return;
    }
    const entry = this.#pending.get(id);
    if (!entry) {
      this.#lastError = `the world core answered an unknown id ${id}`;
      return;
    }
    this.#pending.delete(id);
    clearTimeout(entry.timer);
    this.#crashes = 0;
    if (message.limits !== undefined) {
      // The core declares its own bounds; remembering them here is what lets a
      // caller ask which representations exist instead of keeping a list.
      this.#limits = readLimits(message);
    }
    entry.resolve(message);
  }

  #failPending(error) {
    for (const [, entry] of this.#pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.#pending.clear();
  }
}
