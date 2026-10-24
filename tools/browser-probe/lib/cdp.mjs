/**
 * A small Chrome DevTools Protocol client over Node's built-in WebSocket.
 *
 * There is no npm dependency here on purpose. The interface this probe drives
 * is plain HTML, CSS and ES modules, so the only thing it needs from the
 * browser is the ability to navigate, evaluate, press the mouse and take a
 * picture — four CDP domains, spoken over the `WebSocket` that Node has
 * shipped since 22. A driver library would add an install step, a lockfile and
 * a second version authority for something this file does in 150 lines.
 *
 * Two behaviours matter for a probe that must never hang:
 *
 * * Every request carries a deadline, and a reply that never arrives rejects
 *   the call rather than leaving the run waiting on a socket.
 * * A socket that closes rejects everything still pending, so a browser that
 *   crashes mid-run surfaces as a tool failure with a message instead of a
 *   silent stall.
 */

import { ToolError } from './errors.mjs';

const DEFAULT_CALL_TIMEOUT_MS = 20000;

export class CdpClient {
  /**
   * @param {WebSocket} socket an already-open socket
   * @param {{callTimeoutMs?: number}} [options]
   */
  constructor(socket, options = {}) {
    this.socket = socket;
    this.callTimeoutMs = options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
    this.nextId = 0;
    this.pending = new Map();
    this.closed = false;

    socket.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.id === undefined) return;
      const entry = this.pending.get(message.id);
      if (entry === undefined) return;
      this.pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) {
        entry.reject(
          new ToolError(`${entry.method}: ${message.error.message ?? JSON.stringify(message.error)}`, {
            code: 'cdp_error',
          }),
        );
        return;
      }
      entry.resolve(message.result ?? {});
    });

    const failEverything = (reason) => {
      this.closed = true;
      for (const [, entry] of this.pending) {
        clearTimeout(entry.timer);
        entry.reject(new ToolError(`${entry.method}: the browser connection ${reason}`, { code: 'cdp_closed' }));
      }
      this.pending.clear();
    };
    socket.addEventListener('close', () => failEverything('closed'));
    socket.addEventListener('error', () => failEverything('failed'));
  }

  /**
   * Connect to a DevTools WebSocket endpoint.
   *
   * @param {string} url for example the `webSocketDebuggerUrl` of a target
   * @param {{timeoutMs?: number, callTimeoutMs?: number}} [options]
   */
  static async connect(url, options = {}) {
    const timeoutMs = options.timeoutMs ?? 15000;
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        try {
          socket.close();
        } catch {
          // Closing a socket that never opened needs nothing from us.
        }
        reject(new ToolError(`the DevTools socket did not open within ${timeoutMs} ms`, { code: 'cdp_timeout' }));
      }, timeoutMs);
      socket.addEventListener(
        'open',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      socket.addEventListener(
        'error',
        () => {
          clearTimeout(timer);
          reject(new ToolError('the DevTools socket refused the connection', { code: 'cdp_refused' }));
        },
        { once: true },
      );
    });
    return new CdpClient(socket, { callTimeoutMs: options.callTimeoutMs });
  }

  /**
   * Send one command and await its reply.
   *
   * @param {string} method a CDP method name, for example `Page.navigate`
   * @param {Record<string, unknown>} [params]
   */
  send(method, params = {}) {
    if (this.closed) {
      return Promise.reject(new ToolError(`${method}: the browser connection is closed`, { code: 'cdp_closed' }));
    }
    this.nextId += 1;
    const id = this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new ToolError(`${method}: no reply within ${this.callTimeoutMs} ms`, { code: 'cdp_timeout' }));
      }, this.callTimeoutMs);
      this.pending.set(id, { resolve, reject, method, timer });
      try {
        this.socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new ToolError(`${method}: cannot send: ${error.message}`, { code: 'cdp_send', cause: error }));
      }
    });
  }

  /**
   * Evaluate an expression in the page and return its value by value.
   *
   * `awaitPromise` is on so a page-side `async` function can be awaited
   * directly, and an exception inside the page is turned into a tool error:
   * a probe that read `undefined` from a throwing expression would report a
   * measurement that was never taken.
   *
   * @param {string} expression
   */
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails !== undefined && result.exceptionDetails !== null) {
      const details = result.exceptionDetails;
      const text =
        details.exception?.description ?? details.exception?.value ?? details.text ?? JSON.stringify(details);
      throw new ToolError(`the page threw while evaluating: ${String(text).split('\n')[0]}`, {
        code: 'page_exception',
      });
    }
    return result.result?.value;
  }

  /** Enable the domains this tool uses, in the order the protocol expects. */
  async enable() {
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Network.enable').catch(() => {
      // Network domain events are not required; the page instruments its own
      // requests. An older browser that refuses this domain is still usable.
    });
  }

  /** Install a script that runs before any page script, on every navigation. */
  async addInitScript(source) {
    return this.send('Page.addScriptToEvaluateOnNewDocument', { source });
  }

  /**
   * Navigate and wait until the document is complete.
   *
   * The wait polls `document.readyState` rather than listening for
   * `Page.loadEventFired`: the load event can fire before this client is
   * listening, and a missed event would cost the full navigation timeout.
   */
  async navigate(url, options = {}) {
    const { timeoutMs = 20000, pollMs = 100 } = options;
    await this.send('Page.navigate', { url });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, pollMs));
      try {
        const state = await this.evaluate('document.readyState');
        if (state === 'complete') return;
      } catch {
        // Mid-navigation: the execution context is replaced and evaluating
        // there fails until the new document exists.
      }
    }
    throw new ToolError(`the page did not finish loading within ${timeoutMs} ms: ${url}`, {
      code: 'navigate_timeout',
    });
  }

  /** The top-level frame id, needed if a caller ever has to scope anything to it. */
  async mainFrameId() {
    const tree = await this.send('Page.getFrameTree');
    return tree.frameTree?.frame?.id ?? null;
  }

  /**
   * A real mouse press or release through the input domain.
   *
   * This is `Input.dispatchMouseEvent`, not a `dispatchEvent` from script: the
   * point of the interaction probe is that the browser's own hit testing and
   * event dispatch run, so a defect in the page's pointer handling is visible
   * here and invisible in a synthetic event.
   */
  async mouse(type, x, y, extra = {}) {
    await this.send('Input.dispatchMouseEvent', {
      type,
      x: Math.round(x),
      y: Math.round(y),
      ...extra,
    });
  }

  /** Capture the viewport as a PNG buffer, or a clipped region of it. */
  async screenshot(clip) {
    const params = { format: 'png' };
    if (clip !== undefined) params.clip = { ...clip, scale: clip.scale ?? 1 };
    const result = await this.send('Page.captureScreenshot', params);
    return Buffer.from(result.data, 'base64');
  }

  /** Close the socket. Nothing is awaited afterwards. */
  close() {
    this.closed = true;
    try {
      this.socket.close();
    } catch {
      // A socket that is already closed needs nothing from us.
    }
  }
}
