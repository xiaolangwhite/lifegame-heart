/**
 * The page-side recorder, injected into every new document before any page
 * script runs.
 *
 * This file is deliberately not a module and is never imported by Node: it is
 * read as text and handed to `Page.addScriptToEvaluateOnNewDocument`. It has to
 * therefore be a single self-contained statement with no imports and no
 * reference to anything outside itself.
 *
 * It records and nothing else. It does not wrap the page's behaviour in a way
 * that changes it: every prototype it touches is restored-behaviour-preserving
 * (the original fetch, the original XHR.open and the real EventSource are what
 * actually run), so a page under this instrument behaves as it does without it.
 *
 * Why the ordering matters: a wrapper installed after load would miss the
 * requests the page makes while it starts up — the event stream, the first
 * state poll — and a listener attached later would miss the first press. The
 * requests the page issues during start-up are exactly what defect reports have
 * been missing.
 */
(() => {
  const cap = 500;
  const probe = {
    installed: true,
    installedAt: Date.now(),
    events: [],
    requests: [],
    errors: [],
    truncated: false,
  };
  globalThis.__browserProbe = probe;

  const push = (list, entry) => {
    list.push(entry);
    if (list.length > cap) {
      list.shift();
      probe.truncated = true;
    }
  };

  const describe = (node) => {
    if (node === null || node === undefined) return 'none';
    if (node === globalThis) return 'window';
    if (node === document) return '#document';
    if (node.nodeType === 3) return '#text';
    const tag = node.tagName ? String(node.tagName).toLowerCase() : String(node.nodeName || '?').toLowerCase();
    const id = node.id ? '#' + node.id : '';
    const className = node.className;
    const first = typeof className === 'string' && className.trim() !== '' ? '.' + className.trim().split(/\s+/)[0] : '';
    return tag + id + first;
  };

  const eventTypes = [
    'pointerdown',
    'pointerup',
    'pointermove',
    'pointerenter',
    'pointerleave',
    'pointercancel',
    'mousedown',
    'mouseup',
    'click',
    'dblclick',
    'keydown',
    'keyup',
    'focusin',
    'focusout',
  ];
  for (const type of eventTypes) {
    document.addEventListener(
      type,
      (event) => {
        push(probe.events, {
          type,
          target: describe(event.target),
          x: typeof event.clientX === 'number' ? event.clientX : null,
          y: typeof event.clientY === 'number' ? event.clientY : null,
          buttons: typeof event.buttons === 'number' ? event.buttons : null,
          at: Date.now(),
        });
      },
      true,
    );
  }

  globalThis.addEventListener('error', (event) => {
    push(probe.errors, {
      kind: 'error',
      message: event && event.message ? String(event.message) : 'unknown error',
      source: event && event.filename ? String(event.filename) : '',
      line: event && event.lineno ? event.lineno : null,
    });
  });
  globalThis.addEventListener('unhandledrejection', (event) => {
    const reason = event && event.reason ? event.reason : 'unhandled rejection';
    push(probe.errors, {
      kind: 'unhandledrejection',
      message: String((reason && reason.message) || reason),
    });
  });

  const realFetch = typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null;
  if (realFetch !== null) {
    globalThis.fetch = function (input, init) {
      let method = 'GET';
      let url = '';
      if (typeof input === 'string') {
        url = input;
      } else if (input && typeof input === 'object') {
        url = String(input.url || '');
        if (input.method) method = String(input.method);
      }
      if (init && init.method) method = String(init.method);
      const record = { transport: 'fetch', method: method.toUpperCase(), url, status: null, at: Date.now() };
      push(probe.requests, record);
      return realFetch.apply(this, arguments).then(
        (response) => {
          record.status = response.status;
          return response;
        },
        (error) => {
          record.error = String((error && error.message) || error);
          throw error;
        },
      );
    };
  }

  const realOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    const record = {
      transport: 'xhr',
      method: String(method).toUpperCase(),
      url: String(url),
      status: null,
      at: Date.now(),
    };
    push(probe.requests, record);
    this.addEventListener('loadend', function () {
      record.status = this.status;
    });
    return realOpen.apply(this, arguments);
  };

  const RealEventSource = globalThis.EventSource;
  if (typeof RealEventSource === 'function') {
    const Wrapped = function (url, config) {
      const record = {
        transport: 'eventsource',
        method: 'GET',
        url: String(url),
        status: null,
        at: Date.now(),
      };
      push(probe.requests, record);
      const instance = config === undefined ? new RealEventSource(url) : new RealEventSource(url, config);
      instance.addEventListener('open', () => {
        record.status = 200;
      });
      instance.addEventListener('error', () => {
        if (record.status === null) record.error = 'the event stream reported an error';
      });
      return instance;
    };
    Wrapped.prototype = RealEventSource.prototype;
    globalThis.EventSource = Wrapped;
  }

  probe.describe = describe;
  probe.reset = () => {
    probe.events.length = 0;
    probe.requests.length = 0;
  };
})();
