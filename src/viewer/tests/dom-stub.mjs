/**
 * A synthetic browser, so the page's own modules can be executed by `node:test`.
 *
 * The point of this file is coverage of the code that only runs in a browser.
 * Everything that could be made a pure function has been — locale resolution,
 * theme resolution, colour parsing, the whole viewport arithmetic — but the two
 * render paths, the pointer gestures, the timeline and the event-stream wiring
 * are wiring, and wiring is exactly where the one real defect in this module
 * hid: `paintBits` called a colour constant that had been deleted, and
 * `node --check` cannot see that, because it parses syntax and does not resolve
 * bindings.
 *
 * So this is a *stub browser*, not a test double of the page: it records what the
 * page asked of the browser (pixels written, requests sent, listeners
 * registered) and lets a test drive the real `app.js` through it.
 *
 * **The element registry is built from the composed page the service serves.**
 * Passing `html` makes the stub create exactly the elements that page declares,
 * so a test can assert that every id the page's scripts read actually exists in
 * the page they were served with rather than in a fixture someone kept in step
 * by hand.
 *
 * **An id the markup does not declare is `null`, and that is the point.** The
 * stub used to invent the element on first request, which is precisely how a
 * page that had lost its `#timeline` container passed a green test suite while
 * drawing nothing at all in a real browser. A synthetic document that answers
 * `getElementById` with something that does not exist is not a browser, it is a
 * fixture that hides the defect it was written for. The ids a page asked for are
 * still recorded, so a test can compare them with the markup.
 *
 * Nothing here is imported by anything that ships.
 */

import { readFileSync } from 'node:fs';

import { ROUTES, defaultPageRenderer, renderRoute } from '../routes.mjs';

/** A 2D context that records what it was asked to draw. */
export function createRecordingContext() {
  const calls = { fillRect: [], stroke: [], moveTo: [], lineTo: [], drawImage: [], putImageData: [] };
  const context = {
    calls,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    imageSmoothingEnabled: true,
    setTransform() {},
    beginPath() {},
    fillRect(x, y, w, h) {
      calls.fillRect.push({ x, y, w, h, fillStyle: context.fillStyle });
    },
    moveTo(x, y) {
      calls.moveTo.push({ x, y });
    },
    lineTo(x, y) {
      calls.lineTo.push({ x, y });
    },
    stroke() {
      calls.stroke.push({ style: context.strokeStyle, lineWidth: context.lineWidth });
    },
    drawImage(...args) {
      calls.drawImage.push(args);
    },
    putImageData(image, x, y) {
      calls.putImageData.push({ image, x, y });
    },
    createImageData(width, height) {
      return { width, height, data: new Uint8ClampedArray(width * height * 4) };
    },
  };
  return context;
}

/** A canvas element stub: a size, a context, and a position on the page. */
export function createCanvas({ width = 800, height = 600, left = 0, top = 0 } = {}) {
  const context = createRecordingContext();
  const listeners = new Map();
  const canvas = {
    tagName: 'CANVAS',
    width,
    height,
    rect: { left, top, width, height, right: left + width, bottom: top + height },
    /** Non-enumerable in the browser; a plain own property is fine here. */
    dataset: {},
    classList: createClassList(),
    _captured: new Set(),
    getContext() {
      return context;
    },
    getBoundingClientRect() {
      return { ...canvas.rect };
    },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    removeEventListener(type, listener) {
      const list = listeners.get(type) ?? [];
      const at = list.indexOf(listener);
      if (at >= 0) list.splice(at, 1);
    },
    dispatch(type, event = {}) {
      for (const listener of listeners.get(type) ?? []) listener({ preventDefault() {}, ...event });
    },
    listenerCount(type) {
      return (listeners.get(type) ?? []).length;
    },
    setPointerCapture(pointerId) {
      canvas._captured.add(pointerId);
    },
    hasPointerCapture(pointerId) {
      return canvas._captured.has(pointerId);
    },
    releasePointerCapture(pointerId) {
      canvas._captured.delete(pointerId);
    },
  };
  canvas.context = context;
  return canvas;
}

function createClassList() {
  const set = new Set();
  return {
    add: (name) => set.add(name),
    remove: (name) => set.delete(name),
    contains: (name) => set.has(name),
    /** Replace the whole list, as assigning `className` does in a browser. */
    set: (value) => {
      set.clear();
      for (const name of String(value).split(/\s+/)) if (name !== '') set.add(name);
    },
    values: () => [...set],
    toString: () => [...set].join(' '),
    get size() {
      return set.size;
    },
  };
}

/**
 * A generic element stub: children, text, attributes and listeners.
 *
 * `textContent` clears the children when it is set, which is what the browser
 * does and what `fillOptions` relies on when it relabels a select in place.
 */
export function createElement(tag = 'div', id = '') {
  const listeners = new Map();
  const children = [];
  const attributes = new Map();
  // A real element has a style object, and the page uses it for the one thing
  // that cannot be an attribute: the tree's indentation, which is a number the
  // script computes rather than one of a fixed set of classes.
  const properties = new Map();
  const classList = createClassList();
  let text = '';

  /**
   * The containment links, kept by `append`/`replaceChildren`.
   *
   * A browser dispatches an event along the ancestor chain and answers
   * `closest()` from it, and a test that drives a real gesture needs both. The
   * absence of this is why the defect that stopped every click on the history
   * tree from selecting was invisible here: a click was dispatched straight at
   * the row, so a page that had bound its listener correctly still passed while
   * a real browser delivered the same click to the list.
   */
  const adopt = (node) => {
    if (node !== null && typeof node === 'object') node.parent = element;
  };
  const releaseChildren = () => {
    for (const child of children) {
      if (child !== null && typeof child === 'object' && child.parent === element) child.parent = null;
    }
  };

  const element = {
    tagName: tag.toUpperCase(),
    id,
    parent: null,
    value: '',
    title: '',
    hidden: false,
    disabled: false,
    type: '',
    name: '',
    // A scroll container, as the browser reports one: two numbers the page sets
    // when it pans by hand (the history tree) and reads when it does not.
    scrollTop: 0,
    scrollLeft: 0,
    dataset: {},
    classList,
    style: {
      setProperty(name, value) {
        properties.set(name, String(value));
      },
      getPropertyValue(name) {
        return properties.get(name) ?? '';
      },
      removeProperty(name) {
        properties.delete(name);
      },
    },
    children,
    options: [],
    _captured: new Set(),
    get textContent() {
      return text;
    },
    set textContent(value) {
      text = String(value);
      releaseChildren();
      children.length = 0;
      if (element.tagName === 'SELECT') element.options = children;
    },
    append(...nodes) {
      for (const node of nodes) {
        children.push(node);
        adopt(node);
      }
      if (element.tagName === 'SELECT') element.options = children;
      text = '';
    },
    replaceChildren(...nodes) {
      releaseChildren();
      children.length = 0;
      for (const node of nodes) {
        children.push(node);
        adopt(node);
      }
      if (element.tagName === 'SELECT') element.options = children;
      text = '';
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
      if (name.startsWith('data-')) {
        const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        element.dataset[key] = String(value);
      }
    },
    getAttribute(name) {
      return attributes.has(name) ? attributes.get(name) : null;
    },
    hasAttribute(name) {
      return attributes.has(name);
    },
    removeAttribute(name) {
      attributes.delete(name);
    },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    removeEventListener(type, listener) {
      const list = listeners.get(type) ?? [];
      const at = list.indexOf(listener);
      if (at >= 0) list.splice(at, 1);
    },
    dispatch(type, event = {}) {
      for (const listener of listeners.get(type) ?? []) {
        listener({ preventDefault() {}, target: element, ...event });
      }
    },
    /**
     * Dispatch along the ancestor chain, as a browser bubbles an event.
     *
     * `event.target` stays the element the event was dispatched *at*, however
     * far up the chain it travels — which is what makes the click's target rule
     * expressible at all: the browser decides it from the press and the release,
     * not from where the listener sits.
     */
    bubble(type, event = {}, chain = null) {
      const full = { preventDefault() {}, target: element, ...event };
      const path = chain ?? realChain(element);
      for (const node of path) node.dispatch(type, full);
      return full;
    },
    /** The nearest ancestor-or-self carrying the class, as a browser answers. */
    closest(selector) {
      const wanted = selector.startsWith('.') ? selector.slice(1) : null;
      let node = element;
      while (node !== undefined && node !== null) {
        if (wanted !== null && matchesClass(node, wanted)) return node;
        node = node.parent ?? null;
      }
      return null;
    },
    listenerCount(type) {
      return (listeners.get(type) ?? []).length;
    },
    /**
     * Focus, so a page that moves the keyboard around the tree can be driven.
     * The browser keeps the focused element on the document; so does this.
     */
    focus() {
      element.focused = true;
      const doc = globalThis.document;
      if (doc !== undefined && doc !== null) doc.activeElement = element;
    },
    blur() {
      element.focused = false;
      const doc = globalThis.document;
      if (doc !== undefined && doc !== null && doc.activeElement === element) doc.activeElement = null;
    },
    setPointerCapture(pointerId) {
      element._captured.add(pointerId);
    },
    hasPointerCapture(pointerId) {
      return element._captured.has(pointerId);
    },
    releasePointerCapture(pointerId) {
      element._captured.delete(pointerId);
    },
    /** Every descendant-or-self carrying the given class, for audit assertions. */
    querySelectorAll(selector) {
      return queryAll(element, selector);
    },
  };
  // `className` and `classList` are two views of one list, as in a browser: the
  // pages assign one and the tests read the other, and a stub where they
  // disagreed would let a row carry a class nothing could find.
  Object.defineProperty(element, 'className', {
    configurable: true,
    enumerable: true,
    get: () => classList.toString(),
    set: (value) => classList.set(value),
  });
  return element;
}

function matchesClass(node, name) {
  return node.classList !== undefined && node.classList.contains(name);
}

function queryAll(root, selector) {
  const found = [];
  const wanted = selector.startsWith('.') ? selector.slice(1) : null;
  const walk = (node) => {
    if (wanted !== null && matchesClass(node, wanted)) found.push(node);
    for (const child of node.children ?? []) walk(child);
  };
  for (const child of root.children ?? []) walk(child);
  return found;
}

/**
 * Drive a whole pointer gesture the way a browser dispatches one.
 *
 * The synthetic browser could only ever be handed a sequence of events by hand,
 * and that is exactly how a defect that broke *every* click on the history tree
 * survived a green suite: the case dispatched `click` straight at the row, while
 * a browser delivers the click to the nearest common *inclusive ancestor* of the
 * press and the release — which is no longer the row once an ancestor has taken
 * the pointer capture. Three rules are modelled here, and each was measured in a
 * real browser (Edge 155, driven over CDP) before it was written down:
 *
 * 1. **bubbling** — the press lands on the deepest element under the pointer and
 *    travels up to whatever listens for it;
 * 2. **pointer capture** — from the event *after* the press, the element on the
 *    chain that holds the capture receives the moves and the release, so
 *    `pointerup`'s target is that element;
 * 3. **the click's target** — the nearest common inclusive ancestor of the press
 *    and the release, which is how a capture taken by an ancestor takes the click
 *    away from the element that was pressed.
 *
 * **The caller states the containment.** The registry `installBrowser` builds has
 * no document tree — it holds the elements the markup *names*, not every tag
 * between them — so a case says which element the pointer is over and, with
 * `chain`, which elements are above it (`span -> button -> li -> ol -> #timeline`,
 * nearest first). Elements the page appends to each other do carry real links, so
 * `closest()` answers from them; a chain the page built itself needs no `chain`.
 *
 * Not modelled, deliberately: hit testing, geometry (no element here has a
 * position), and the boundary events a capture change fires
 * (`pointerout`/`pointerleave`/`pointerover`/`pointerenter`) — which are what a
 * real browser uses to close a row's overlay on the way to the capture target.
 * A case that needs any of those has to drive it itself.
 *
 * @param {object} hit the element under the pointer when the press happens
 * @param {{pointerId?: number, button?: number, from?: {x: number, y: number},
 *   moves?: {x: number, y: number}[], clickCount?: number, chain?: object[]}} [options]
 * @returns {{clickTarget: object, capture: object, events: {type: string, target: object}[]}}
 */
export function pointerGesture(hit, options = {}) {
  const pointerId = options.pointerId ?? 1;
  const button = options.button ?? 0;
  const clickCount = options.clickCount ?? 1;
  const from = options.from ?? { x: 0, y: 0 };
  const moves = options.moves ?? [];
  const events = [];
  // `[hit, ...ancestors]`: what the event travels along, outermost last.
  const path = options.chain ?? realChain(hit);

  const fire = (node, type, point) => {
    events.push({ type, target: node });
    const index = path.indexOf(node);
    const tail = index < 0 ? [node] : path.slice(index);
    tail[0].bubble(
      type,
      {
        pointerId,
        button,
        buttons: type === 'pointerdown' || type === 'pointermove' ? 1 : 0,
        clientX: point.x,
        clientY: point.y,
        clickCount,
      },
      tail,
    );
  };

  fire(hit, 'pointerdown', from);
  const capture = path.find((node) => node.hasPointerCapture?.(pointerId) === true) ?? hit;
  let last = from;
  for (const move of moves) {
    last = move;
    fire(capture, 'pointermove', move);
  }
  fire(capture, 'pointerup', last);
  // The capture target is an ancestor-or-self of the hit, so it *is* the nearest
  // common inclusive ancestor of the press and the release: with no capture the
  // two are the same element and the click is that element's.
  const clickTarget = capture;
  fire(clickTarget, 'click', last);
  return { clickTarget, capture, events };
}

/** `[element, ...ancestors]` from the containment `append` recorded. */
function realChain(element) {
  const path = [];
  for (let node = element; node !== undefined && node !== null; node = node.parent ?? null) {
    path.push(node);
  }
  return path;
}

/** A controllable `EventSource`, so a test decides when an event arrives. */
export class StubEventSource {

  static opened = [];
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.closed = false;
    this.listeners = new Map();
    StubEventSource.opened.push(url);
    StubEventSource.instances.push(this);
  }

  static reset() {
    StubEventSource.opened = [];
    StubEventSource.instances = [];
  }

  static get latest() {
    return StubEventSource.instances[StubEventSource.instances.length - 1] ?? null;
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  removeEventListener(type, listener) {
    const list = this.listeners.get(type) ?? [];
    const at = list.indexOf(listener);
    if (at >= 0) list.splice(at, 1);
  }

  close() {
    this.closed = true;
    this.readyState = 2;
  }

  /** Deliver a server-sent event, as the browser would. */
  emit(type, payload) {
    if (this.closed) return;
    const message = { type, data: JSON.stringify(payload), lastEventId: '' };
    for (const listener of this.listeners.get(type) ?? []) listener(message);
  }

  /** Deliver a transport failure, which arrives without `data`. */
  fail() {
    if (this.closed) return;
    for (const listener of this.listeners.get('error') ?? []) listener({ type: 'error' });
  }
}

/** A JSON response stub with the fields the page reads. */
export function jsonResponse(payload, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    },
  };
}

/**
 * The elements a page's markup declares, in document order.
 *
 * A regex is enough for this page: it is our own markup, it has no `>` inside an
 * attribute value, and the alternative — parsing HTML without a dependency — is
 * a project of its own. What matters is that the registry is derived from the
 * file that actually ships rather than from a hand-kept fixture.
 *
 * @returns {{tag: string, id: string, i18n: string}[]}
 */
export function parsePage(html) {
  const entries = [];
  const tagPattern = /<([a-z][a-z0-9]*)\b([^>]*)>/gi;
  let match = tagPattern.exec(html);
  while (match !== null) {
    const [, tag, attributes] = match;
    const id = /\bid="([^"]*)"/i.exec(attributes);
    const i18n = /\bdata-i18n="([^"]*)"/i.exec(attributes);
    if (id !== null || i18n !== null) {
      entries.push({ tag, id: id === null ? '' : id[1], i18n: i18n === null ? '' : i18n[1] });
    }
    match = tagPattern.exec(html);
  }
  return entries;
}

/**
 * Install a whole synthetic browser on `globalThis`.
 *
 * @returns a handle with the pieces a test needs to drive the page and to
 *   inspect what the page did.
 */
export function installBrowser(options = {}) {
  const {
    canvas = createCanvas(),
    palette = {
      '--alive': '#7fd4ff',
      '--dead': '#0b0d10',
      '--grid': 'rgba(255, 255, 255, 0.14)',
    },
    devicePixelRatio = 1,
    storage = {},
    prefersDark = false,
    withEventSource = true,
    html = '',
    language = 'en-US',
  } = options;

  const entries = html === '' ? [] : parsePage(html);

  const elements = new Map();
  const i18nNodes = new Map();
  const requestedIds = [];
  const createdCanvases = [];
  /** Every canvas the markup declares, by id, since there is more than one. */
  const canvases = new Map();

  for (const entry of entries) {
    // A canvas the markup declares is a real canvas stub, so a page that draws
    // into it can be asked what it drew. The world's canvas is the one the
    // caller supplied, because every test that predates the second canvas means
    // that one by `browser.canvas`.
    let element;
    if (entry.tag === 'canvas') {
      const made = entry.id === 'grid' ? canvas : createCanvas();
      canvases.set(entry.id, made);
      element = made;
    } else {
      element = createElement(entry.tag, entry.id);
    }
    if (entry.id !== '') elements.set(entry.id, element);
    if (entry.i18n !== '') {
      element.dataset.i18n = entry.i18n;
      i18nNodes.set(`${entry.tag}:${entry.i18n}:${entries.indexOf(entry)}`, element);
    }
  }

  const documentElement = { dataset: {}, tagName: 'HTML', lang: '' };

  const documentListeners = new Map();

  const document = {
    documentElement,
    title: '',
    activeElement: null,
    /**
     * Exactly what the markup declares, and null otherwise.
     *
     * No element is invented here. A page that reads an id its route does not
     * provide is broken in a real browser, and the only way a test can notice is
     * if this refuses to cover for it.
     */
    getElementById(id) {
      if (!requestedIds.includes(id)) requestedIds.push(id);
      return elements.has(id) ? elements.get(id) : null;
    },
    createElement(tag) {
      if (tag === 'canvas') {
        // The page builds an offscreen canvas to compose the bitmap encoding,
        // and that canvas has its own context — so a test that wants to see the
        // bitmap has to look here, not at the visible canvas.
        const offscreen = createCanvas({ width: 300, height: 150 });
        createdCanvases.push(offscreen);
        return offscreen;
      }
      return createElement(tag);
    },
    createTextNode(value) {
      return { nodeType: 3, textContent: String(value) };
    },
    querySelectorAll(selector) {
      if (selector !== '[data-i18n]') return [];
      return [...i18nNodes.values()];
    },
    // The document is the channel between the shell and a page module, so these
    // are real: a shell that answers a request and a page that listens for the
    // answer both go through here.
    addEventListener(type, listener) {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(listener);
    },
    removeEventListener(type, listener) {
      const list = documentListeners.get(type) ?? [];
      const at = list.indexOf(listener);
      if (at >= 0) list.splice(at, 1);
    },
    dispatchEvent(event) {
      for (const listener of documentListeners.get(event.type) ?? []) listener(event);
      return true;
    },
    listenerCount(type) {
      return (documentListeners.get(type) ?? []).length;
    },
  };

  const store = new Map(Object.entries(storage));
  const localStorage = {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
    get length() {
      return store.size;
    },
  };

  const mediaListeners = new Map();
  const matchMedia = (query) => ({
    media: query,
    matches: query.includes('dark') ? prefersDark : false,
    addEventListener(type, listener) {
      if (!mediaListeners.has(query)) mediaListeners.set(query, []);
      mediaListeners.get(query).push(listener);
    },
    removeEventListener() {},
  });

  const windowListeners = new Map();
  const window = {
    devicePixelRatio,
    localStorage,
    matchMedia,
    addEventListener(type, listener) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(listener);
    },
    removeEventListener() {},
    dispatch(type, event = {}) {
      for (const listener of windowListeners.get(type) ?? []) {
        listener({ preventDefault() {}, ...event });
      }
    },
  };

  class HtmlElement {
    constructor() {
      this.tagName = 'ELEMENT';
    }
  }
  class HtmlInputElement extends HtmlElement {}
  class HtmlButtonElement extends HtmlElement {}

  const requests = [];
  let fetchHandler = options.fetch ?? (() => jsonResponse({ ok: false, error: 'no_fetch_stub' }, 501));

  // The page observes the canvas so that a layout change redraws immediately
  // rather than at the next pushed event. The stub records the callbacks and
  // lets a test fire them, which is the only way to prove the redraw happens
  // without a window resize to lean on.
  const resizeObservers = [];
  class StubResizeObserver {
    constructor(callback) {
      this.callback = callback;
      this.targets = [];
      resizeObservers.push(this);
    }

    observe(target) {
      this.targets.push(target);
    }

    unobserve() {}

    disconnect() {
      this.targets = [];
    }
  }

  const previous = new Map();
  const install = (name, value) => {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  };

  install('document', document);
  install('window', window);
  install('navigator', { language });
  install('getComputedStyle', () => ({
    getPropertyValue(name) {
      return palette[name] ?? '';
    },
  }));
  install('localStorage', localStorage);
  install('HTMLInputElement', HtmlInputElement);
  install('HTMLButtonElement', HtmlButtonElement);
  install('matchMedia', matchMedia);
  install('ResizeObserver', StubResizeObserver);
  install('fetch', async (url, init = {}) => {
    const record = { url: String(url), init };
    requests.push(record);
    return fetchHandler(record.url, record.init);
  });
  if (withEventSource) install('EventSource', StubEventSource);

  return {
    document,
    window,
    canvas,
    canvases,
    createdCanvases,
    elements,
    i18nNodes,
    requestedIds,
    pageEntries: entries,
    html,
    requests,
    storage: store,
    mediaListeners,
    resizeObservers,
    /** The canvas the markup declares under this id, or undefined. */
    canvasFor(id) {
      return canvases.get(id);
    },
    /** Fire every size observer, as the browser does after a layout change. */
    notifyResize() {
      for (const observer of resizeObservers) observer.callback([], observer);
    },
    StubEventSource,
    setFetchHandler(handler) {
      fetchHandler = handler;
    },
    /** Requests whose URL starts with the given prefix. */
    requestsTo(prefix) {
      return requests.filter((entry) => entry.url.startsWith(prefix));
    },
    requestBodiesTo(prefix) {
      return requests
        .filter((entry) => entry.url.startsWith(prefix))
        .map((entry) => {
          try {
            return JSON.parse(entry.init.body ?? '{}');
          } catch {
            return null;
          }
        });
    },
    /** Ids the page asked for that its markup does not declare. */
    missingIds() {
      const declared = new Set(entries.filter((entry) => entry.id !== '').map((entry) => entry.id));
      return requestedIds.filter((id) => !declared.has(id));
    },
    /** The ids the page's markup declares, for the contract assertions. */
    declaredIds() {
      return new Set(entries.filter((entry) => entry.id !== '').map((entry) => entry.id));
    },
    /** The text of every translated node, keyed by its `data-i18n` value. */
    translatedText() {
      const found = {};
      for (const node of i18nNodes.values()) found[node.dataset.i18n] = node.textContent;
      return found;
    },
    restore() {
      for (const [name, descriptor] of previous) {
        if (descriptor === undefined) delete globalThis[name];
        else Object.defineProperty(globalThis, name, descriptor);
      }
    },
  };
}

/**
 * The composed page a route serves, so a test installs the markup the service
 * actually sends rather than a fixture kept in step by hand.
 *
 * The page is composed by `routes.mjs` — the same code `server.mjs` uses — so a
 * fragment that stopped being included in a route would change this too.
 */
export function readRoutePage(routeId) {
  return renderRoute(routeId).replace(/\r\n/g, '\n');
}

/** The composed page of a path, for a test that starts from a URL. */
export function readPathPage(pathname) {
  const route = ROUTES.find((entry) => entry.paths.includes(pathname));
  if (route === undefined) throw new Error(`no route serves ${pathname}`);
  return defaultPageRenderer.render(pathname).replace(/\r\n/g, '\n');
}

/** Read the shared layout, for the placeholder and bootstrap contract tests. */
export function readLayout() {
  return readFileSync(new URL('../public/pages/layout.html', import.meta.url), 'utf8').replace(
    /\r\n/g,
    '\n',
  );
}

/** Read one route's fragment, so a test can tell the page's markup from the shell's. */
export function readFragment(routeId) {
  const route = ROUTES.find((entry) => entry.id === routeId);
  if (route === undefined) throw new Error(`no route with id ${routeId}`);
  return defaultPageRenderer.fragment(route).replace(/\r\n/g, '\n');
}

/** Let every pending microtask and timer callback settle. */
export async function settle(rounds = 4) {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
