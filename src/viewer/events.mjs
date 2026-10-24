/**
 * lifegame viewer — the push transport.
 *
 * The page used to poll `/api/frame` on a timer, which meant it asked for a
 * frame whether or not anything had changed, and it could never be told about a
 * change it had not asked for. The core, meanwhile, has always *announced* its
 * automatic steps: `Bridge._tick` writes `{"event":"tick", ...}` on stdout, and
 * CoreBridge has always surfaced those through `onEvent`. Nothing was listening.
 *
 * This hub listens, and turns the three sources of change into Server-Sent
 * Events on one connection per client:
 *
 * | Source | Event |
 * |---|---|
 * | the connection opening | `hello` — protocol version, world, rule, representation |
 * | a core `tick` while running | `tick`, then a fresh `frame` for each subscription |
 * | a REST mutation, routed through `invalidate` | `state`, then a fresh `frame` |
 * | the core failing or refusing | `error`, leaving the connection open to recover |
 *
 * Two properties matter for correctness:
 *
 * - **A slow client coalesces rather than queues.** Every client has an
 *   in-flight flag; a change that arrives while that client's frame is being
 *   built sets `again` instead of starting a second request. Without it, a core
 *   running at 60 ticks per second would queue 60 frames per second per client
 *   against a transport that issues one request at a time, and the lag would
 *   grow without bound.
 * - **A frame is built against a snapshot of the subscription.** The viewport can
 *   change while the core is answering; the reply belongs to the rectangle that
 *   was asked for, so the snapshot is what the event carries.
 *
 * Nothing is written to disk and no dependency is added: Server-Sent Events are
 * `text/event-stream` over the HTTP response this transport already owns.
 */

import { CoreUnavailableError, PROTOCOL_VERSION } from './bridge.mjs';
import { MAX_FRAME_CELLS, NO_LIMITS, frameAdmission, readLimits } from './public/shared.mjs';

/** Sent as an SSE comment so an idle connection is not dropped by a proxy. */
const HEARTBEAT_MS = 15000;

export class EventHub {
  #bridge;
  #session;
  #maxFrameCells;
  #onPopulation;
  #populationOf;
  #onLog;
  #clients = new Set();
  #nextClientId = 1;
  #hello = null;
  #representation;
  #closed = false;
  #pumping = false;
  #pumpAgain = false;
  #heartbeat = null;
  #unsubscribe;
  /** The population the last reply this hub saw reported. */
  #lastPopulation = 0;
  /** The world the core described; a subscription is kept inside it. */
  #world = { width: 65536, height: 65536 };
  /** The limits the core declared, passed on to every client unchanged. */
  #limits = NO_LIMITS;

  /**
   * @param {{
   *   bridge: import('./bridge.mjs').CoreBridge,
   *   session?: string,
   *   representation?: string,
   *   maxFrameCells?: number,
   *   population?: () => number,
   *   onPopulation?: (population: number) => void,
   *   onLog?: (message: string) => void,
   * }} options
   *
   * `population` is how the hub learns the size of the live set, and it has to
   * be told rather than asked: the core's `hello` reply does not carry a
   * population, and the admission rule needs one before it can decide whether a
   * pushed frame may be asked for at all. The service passes the same number its
   * REST routes use, so one rule sees one value.
   */
  constructor(options) {
    this.#bridge = options.bridge;
    this.#session = options.session ?? 'main';
    this.#maxFrameCells = options.maxFrameCells ?? MAX_FRAME_CELLS;
    this.#onPopulation = options.onPopulation ?? (() => {});
    this.#populationOf = options.population ?? (() => 0);
    this.#onLog = options.onLog ?? (() => {});
    this.#representation = options.representation ?? 'sparse';
    this.#unsubscribe = this.#bridge.onEvent((message) => this.#onCoreEvent(message));
  }

  get size() {
    return this.#clients.size;
  }

  /** The representation the core was started with, as the client is told it. */
  get representation() {
    return this.#representation;
  }

  set representation(value) {
    this.#representation = value;
    this.#hello = null;
  }

  /**
   * Attach one SSE client.
   *
   * **A client that has not named a rectangle is not shown one.** There is no
   * default view on this side, because the default view is a function of a
   * canvas this process cannot measure (`viewport.mjs`,
   * `DEFAULT_PIXELS_PER_CELL`); inventing a rectangle here would be a second
   * declaration of it, and would push a frame for a view the page is not
   * looking at. A client with no rectangle receives `hello` and nothing else
   * until it subscribes over `POST /api/subscription`.
   *
   * @param {{viewport?: {x0: number, y0: number, w: number, h: number}, send: (event: string, payload: object) => void}} options
   * @returns {Promise<object>} the client handle, for `removeClient` and `setViewport`
   */
  async addClient(options) {
    const client = {
      id: this.#nextClientId,
      viewport:
        options.viewport === undefined || options.viewport === null
          ? null
          : { ...options.viewport },
      send: options.send,
      inflight: false,
      again: true,
      closed: false,
    };
    this.#nextClientId += 1;
    this.#clients.add(client);
    this.#startHeartbeat();

    try {
      const hello = await this.#describe();
      // A rectangle named in the query string is fitted to the world the core
      // just described: the core would answer cells that do not exist with an
      // error rather than a frame, and the client asked for a view rather than
      // for a fault.
      if (client.viewport !== null) client.viewport = this.#clampToWorld(client.viewport);
      client.send('hello', {
        clientId: client.id,
        protocolVersion: PROTOCOL_VERSION,
        session: this.#session,
        world: hello.world,
        rule: hello.rule,
        representation: this.#representation,
        // Passed through rather than summarised: the page offers a rate, a
        // representation list and a coordinate bound, and all three are the
        // core's to declare. A bound the hub invented here would be the copy
        // that drifts.
        limits: this.#limits,
        history: hello.history === true,
      });
    } catch (error) {
      client.send('error', { error: error.code ?? 'internal', message: error.message });
    }
    await this.#pushFrame(client);
    return client;
  }

  removeClient(client) {
    if (!client) return;
    client.closed = true;
    this.#clients.delete(client);
    if (this.#clients.size === 0) this.#stopHeartbeat();
  }

  /** The client with this id, or null. Used to route a viewport update. */
  clientById(id) {
    const wanted = asInteger(id, NaN);
    if (Number.isNaN(wanted)) return null;
    for (const client of this.#clients) {
      if (client.id === wanted) return client;
    }
    return null;
  }

  /** Point one client at a different rectangle and send it that rectangle now. */
  async setViewport(client, viewport) {
    if (!client || client.closed) return;
    client.viewport = this.#clampToWorld({
      x0: asInteger(viewport.x0, 0),
      y0: asInteger(viewport.y0, 0),
      w: asInteger(viewport.w, this.#world.width),
      h: asInteger(viewport.h, this.#world.height),
    });
    await this.#pushFrame(client);
  }

  /**
   * Fit a rectangle inside the world.
   *
   * A subscription outside the world is not an error worth reporting — the
   * client asked for a view, not for specific cells — but it *is* an error the
   * core would raise, so the rectangle is clipped here rather than turned into
   * a frame request that cannot succeed.
   */
  #clampToWorld(viewport) {
    const width = Math.max(1, Math.min(viewport.w, this.#world.width));
    const height = Math.max(1, Math.min(viewport.h, this.#world.height));
    return {
      w: width,
      h: height,
      x0: Math.max(0, Math.min(viewport.x0, this.#world.width - width)),
      y0: Math.max(0, Math.min(viewport.y0, this.#world.height - height)),
    };
  }

  /**
   * Something outside the tick loop changed the world or its metadata: every
   * client is told the new state and shown a fresh frame.
   */
  invalidate() {
    for (const client of this.#clients) client.again = true;
    this.#schedulePump();
  }

  /** Send a `state` event to every client without asking for frames. */
  broadcastState(state) {
    this.broadcast('state', state);
  }

  /** Send one event to every connected client. */
  broadcast(event, payload) {
    for (const client of this.#clients) {
      if (!client.closed) client.send(event, payload);
    }
  }

  close() {
    this.#closed = true;
    this.#stopHeartbeat();
    if (this.#unsubscribe) this.#unsubscribe();
    for (const client of this.#clients) client.closed = true;
    this.#clients.clear();
  }

  /** The population the last reply reported, which the admission rule reads. */
  get population() {
    return this.#currentPopulation();
  }

  // -- internals ---------------------------------------------------------

  /**
   * The best population this hub knows: what it has seen, or what the service
   * has seen. The larger of the two, because the rule errs towards refusing a
   * frame it cannot cheaply serve rather than towards asking for one.
   */
  #currentPopulation() {
    return Math.max(this.#lastPopulation, this.#populationOf() ?? 0);
  }

  /**
   * Remember the population the core last reported.
   *
   * This is the input the admission rule needs, and it has to be fed from every
   * reply that carries one: the rule decides whether a pushed frame may be asked
   * for at all, so a stale zero would let a dense rectangle through.
   */
  #rememberPopulation(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return;
    this.#lastPopulation = value;
    this.#onPopulation(value);
  }

  async #describe() {
    if (this.#hello === null) {
      this.#hello = await this.#bridge.request('hello');
      const world = this.#hello?.world;
      if (world && Number.isFinite(world.width) && Number.isFinite(world.height)) {
        this.#world = { width: world.width, height: world.height };
      }
      this.#limits = readLimits(this.#hello);
      this.#rememberPopulation(this.#hello?.population);
    }
    return this.#hello;
  }

  #startHeartbeat() {
    if (this.#heartbeat !== null) return;
    const timer = setInterval(() => {
      for (const client of this.#clients) {
        if (!client.closed) client.send('ping', { at: Date.now() });
      }
    }, HEARTBEAT_MS);
    // A heartbeat must never be the reason the process stays alive.
    if (typeof timer.unref === 'function') timer.unref();
    this.#heartbeat = timer;
  }

  #stopHeartbeat() {
    if (this.#heartbeat === null) return;
    clearInterval(this.#heartbeat);
    this.#heartbeat = null;
  }

  #onCoreEvent(message) {
    if (message.event !== 'tick') return;
    for (const client of this.#clients) {
      if (!client.closed) client.send('tick', message);
    }
    this.invalidate();
  }

  #schedulePump() {
    if (this.#closed) return;
    if (this.#pumping) {
      this.#pumpAgain = true;
      return;
    }
    this.#pumpAgain = true;
    queueMicrotask(() => void this.#pump());
  }

  async #pump() {
    if (this.#pumping || this.#closed) return;
    this.#pumping = true;
    try {
      while (this.#pumpAgain && !this.#closed) {
        this.#pumpAgain = false;
        for (const client of [...this.#clients]) {
          if (client.closed || !client.again) continue;
          await this.#pushFrame(client);
        }
      }
    } finally {
      this.#pumping = false;
    }
  }

  async #pushFrame(client) {
    if (client.closed || this.#closed) return;
    if (client.viewport === null) {
      // Nothing to draw yet: the client has not said where it is looking, and
      // this side does not invent a view. See `addClient`.
      client.again = false;
      return;
    }
    if (client.inflight) {
      // The previous frame is still being built; one more is enough, however
      // many changes arrive before it lands.
      client.again = true;
      return;
    }
    const viewport = { ...client.viewport };
    const area = viewport.w * viewport.h;
    const refusal = frameAdmission({
      area,
      population: this.#currentPopulation(),
      maxFrameCells: this.#maxFrameCells,
    });
    if (refusal !== null) {
      client.again = false;
      client.send('error', { error: refusal.error, message: refusal.message, viewport });
      return;
    }

    client.again = false;
    client.inflight = true;
    try {
      const reply = await this.#bridge.request('frame', viewport);
      if (client.closed) return;
      this.#rememberPopulation(reply?.frame?.population);
      if (reply && reply.ok !== false && reply.frame) {
        client.send('frame', reply.frame);
      } else {
        client.send('error', {
          error: reply?.error ?? 'bad_reply',
          message: reply?.message ?? 'the core did not return a frame',
        });
      }
    } catch (error) {
      if (client.closed) return;
      client.send('error', {
        error: error instanceof CoreUnavailableError ? 'core_unavailable' : (error.code ?? 'internal'),
        message: error.message,
      });
    } finally {
      client.inflight = false;
    }
  }
}

function asInteger(value, fallback) {
  const number = typeof value === 'number' ? value : Number.parseInt(value, 10);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}
