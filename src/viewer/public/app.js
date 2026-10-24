/**
 * lifegame viewer — the routed page's shell, shared by every route.
 *
 * The interface is three pages: `/world` (and `/`), `/history` and `/archives`.
 * Each is the same document — `<head>`, header, tab navigation, footer, status
 * line and error banner — with one fragment inside, and each loads this file
 * plus **one** page module (`pages/world.js`, `pages/history.js`,
 * `pages/archives.js`). This file owns everything more than one route needs:
 *
 * - **the language and the theme**, so a choice made on one route is in effect on
 *   the next, from one storage key and one precedence rule;
 * - **the core status line and the error banner**, which every route shows;
 * - **the API client** — one JSON reader, one command caller, one place that
 *   turns an error code into a translated label;
 * - **the event stream** and its polling fallback;
 * - **the shared state**: one object, so the pages are looking at the same world.
 *
 * **A page module never imports this file.** Two ES modules that import each
 * other's state cannot be tested: a test loads `app.js?case=7` to get a fresh
 * page per case, and a module imported by URL would then receive a *different*
 * shell instance with no data in it — which is exactly how the first attempt at
 * this split came to render an empty tree in the browser. The handshake is a DOM
 * event instead (`public/link.mjs`): a page module asks on load, the shell
 * answers with this file's context, and both load orders work. The page's own
 * bindings are filled from that answer, so its functions read `state`, `dom` and
 * `t` exactly as they did when everything was one file.
 *
 * **What the shell does not own is pixels.** Nothing here measures a canvas,
 * reads a palette, computes a viewport, walks the history or lists an archive.
 * Those are the pages', and a route only loads the page it is.
 */

import { LOCALES, LOCALE_STORAGE_KEY, describeError, resolveLocale, translate } from './locales.mjs';
import { SHELL_EVENT, SHELL_REQUEST_EVENT } from './link.mjs';
import { fillOptions, labelOptions } from './options.mjs';
import { readLimits } from './shared.mjs';
import {
  THEME_STORAGE_KEY,
  isExplicitTheme,
  nextTheme,
  readStored,
  resolveTheme,
  writeStored,
} from './theme.mjs';

const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)';

/** How long to wait before re-opening a dropped event stream. */
const STREAM_RETRY_MS = 2000;

/** The session a service always has; a URL without `session` means this one. */
const DEFAULT_SESSION_ID = 'main';

/**
 * The session this page is looking at, from the URL.
 *
 * A page without a `session` parameter talks to the service's default session,
 * which is the one every client had before sessions existed. The id is not kept
 * in storage: two tabs may watch two sessions, and remembering one would make
 * the other's refresh jump.
 */
function sessionFromLocation() {
  try {
    if (typeof location === 'undefined') return DEFAULT_SESSION_ID;
    const wanted = new URLSearchParams(location.search).get('session');
    return wanted === null || wanted === '' ? DEFAULT_SESSION_ID : wanted;
  } catch {
    return DEFAULT_SESSION_ID;
  }
}

/**
 * The names a page module may register on, in one place.
 *
 * A hook is a named moment in the shell's life that a page must react to. The
 * list is closed on purpose: a typo in a name would otherwise register a
 * listener that is never called, which is a silent feature that does not work —
 * the same class of defect the honest DOM in `tests/dom-stub.mjs` exists to
 * catch for element ids.
 */
export const HOOK_NAMES = Object.freeze([
  'theme',
  'retranslate',
  'state',
  'hello',
  'frame',
  'tick',
  'patch',
  'presence',
  'limits',
  'history',
  'afterChange',
]);

/** The event names of the page-to-shell handshake, owned by `link.mjs`. */
export { SHELL_EVENT, SHELL_REQUEST_EVENT };

/**
 * The elements every route declares, and only those.
 *
 * A page module binds its own ids. The split is not cosmetic: the synthetic
 * browser in the test suite returns **null** for an id the route does not
 * declare, so an element read from a route that does not have it fails a test
 * instead of silently existing. Everything here is in `pages/layout.html`.
 */
const dom = {
  coreStatus: document.getElementById('core-status'),
  error: document.getElementById('error'),
  locale: document.getElementById('locale'),
  toggleTheme: document.getElementById('toggle-theme'),
  session: document.getElementById('session'),
  sessionNew: document.getElementById('session-new'),
  sessionQueued: document.getElementById('session-queued'),
};

/**
 * The shared state. One object, declared once, mutated by the shell and by
 * whichever page module is loaded.
 *
 * Fields a route does not use simply stay at their initial value: the history
 * page never touches `viewport`, and the world page never touches `archives`.
 * Keeping them together is what lets a page read what the shell learned in the
 * same tick it arrives, rather than keeping a second copy that drifts.
 */
const state = {
  // Which session this page is looking at. Every request and the event stream
  // carry it, and the value is the URL's rather than a stored one.
  sessionId: sessionFromLocation(),
  // Null until the core says how big the world is. There is no default here on
  // purpose: the design target is the core's to declare, and a copy of it in the
  // page is the copy that drifts.
  world: null,
  // Where the live cells are, as the core last reported them. The world page
  // centres its first view on this; the shell only remembers it.
  bounds: null,
  rule: '',
  representation: null,
  limits: readLimits(null),
  history: false,
  // Where the world route is looking. A span of zero means "not placed yet":
  // the view is a function of the canvas, and until the canvas has a size and
  // the core has declared a world there is no view to ask for. `viewport.mjs`
  // owns the rule that fills it.
  viewport: { x0: 0, y0: 0, span: 0 },
  running: false,
  tps: 1,
  locale: 'en',
  theme: 'dark',
  // The world page fills this from its own control at start-up; the shell keeps
  // the field so the page's functions read one object rather than two.
  gridWidth: null,
  generation: 0,
  population: 0,
  lastFrame: null,
  inFlight: false,
  refreshAgain: false,
  zoomLimited: false,
  timer: null,
  // The push transport. `streamConnected` decides whether a page publishes a
  // viewport change or falls back to polling for a frame after every gesture.
  stream: null,
  streamConnected: false,
  streamTimer: null,
  clientId: null,
  subscriptionKey: '',
  subscriptionInFlight: false,
  subscriptionAgain: false,
  switching: false,
  // The recorded history as a tree. `head` is the node the world is on and the
  // node the next record appends to, so it is both the working point and the row
  // the tree marks as selected.
  historyRows: [],
  head: null,
  // How many rows the history page shows at once. The number belongs to that
  // page's window control, which fills this field when it starts; the shell only
  // carries it.
  timelineWindow: 0,
  selecting: false,
  // The history route's preview: its own viewport (null until the first
  // generation is shown), whether the user has panned or zoomed it — after which
  // its span stops following its canvas — and the one-request-at-a-time pair a
  // drag needs. The frame it last drew is the page's own, not shared state: only
  // that page redraws it.
  previewViewport: null,
  previewMoved: false,
  previewInFlight: false,
  previewAgain: false,
  // The panel, and the archive manager.
  panel: 'normal',
  archives: [],
  exported: null,
  renaming: null,
  confirmingDelete: null,
  resizeObserver: null,
  // Live touch and mouse contacts, by pointer id, and the gesture in progress.
  // A map rather than a single drag record because a pinch is two of them and
  // the page has to notice the second finger arriving and the first one leaving.
  pointers: new Map(),
  gesture: null,
};

// -- hooks ----------------------------------------------------------------

/** The registered listeners, by hook name. */
const listeners = new Map(HOOK_NAMES.map((name) => [name, []]));

/**
 * Register a page module's interest in a moment of the shell's life.
 *
 * @returns {() => void} the unsubscribe, so a page can drop a listener.
 */
function on(name, listener) {
  if (!listeners.has(name)) {
    throw new Error(`no such shell hook: ${JSON.stringify(name)}`);
  }
  listeners.get(name).push(listener);
  return () => {
    const list = listeners.get(name);
    const at = list.indexOf(listener);
    if (at >= 0) list.splice(at, 1);
  };
}

/** Tell every listener of a hook, ignoring what they return. */
function emit(name, payload) {
  for (const listener of [...(listeners.get(name) ?? [])]) listener(payload);
}

/**
 * Tell every listener and wait for them.
 *
 * Two hooks are answers rather than notifications: `afterChange` is "the world
 * moved, get a fresh picture" and `history` is "the recording changed, read it
 * again". The caller has to be able to await those, and a route with no listener
 * resolves immediately, which is what makes them safe to call from anywhere.
 */
function emitAsync(name, payload) {
  return Promise.all((listeners.get(name) ?? []).map((listener) => listener(payload)));
}

/** The shell's answer to "may I have the shared context". */
function afterChange() {
  return emitAsync('afterChange');
}

/** The shell's answer to "the recording changed" — a no-op with no history page. */
function refreshHistory() {
  return emitAsync('history');
}

// -- text -----------------------------------------------------------------

/** One entry from the locale table, in the language the page is showing. */
function t(key, params) {
  return translate(state.locale, key, params);
}

/**
 * Put the current language into the document.
 *
 * Called once at start-up and again on every change. It walks `data-i18n`
 * rather than holding a list of nodes, so a new element in a fragment is
 * translated by adding the attribute and nothing else — a list of nodes would be
 * one more place to forget. What is left is the page's own: a hook the page
 * answers, because only the page knows which of its nodes are not simple text.
 */
function retranslate() {
  document.documentElement.lang = state.locale;
  document.title = t('brand.title');
  for (const node of document.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n);
  }
  updateThemeControl();
  labelOptions(dom.locale, (value) => t(`locale.${value}`));
  dom.session.setAttribute('aria-label', t('label.session'));
  dom.sessionNew.setAttribute('aria-label', t('action.newSession'));
  dom.sessionNew.title = t('label.newSessionTitle');
  if (dom.sessionQueued && dom.sessionQueued.dataset.count) {
    const queued = Number(dom.sessionQueued.dataset.count);
    dom.sessionQueued.textContent = queued > 0 ? t('label.queued', { count: queued }) : '';
  }
  emit('retranslate');
}

// -- language -------------------------------------------------------------

/** The storage, or null when even reading it throws — private mode, no origin. */
function safeStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function initialiseLocale() {
  const stored = readStored(LOCALE_STORAGE_KEY, safeStorage());
  state.locale = resolveLocale(stored, navigator.language);
  fillOptions(dom.locale, [...LOCALES], (value) => t(`locale.${value}`));
  dom.locale.value = state.locale;
}

function applyLocale(locale, persist) {
  state.locale = locale;
  dom.locale.value = locale;
  if (persist) writeStored(LOCALE_STORAGE_KEY, locale, safeStorage());
  retranslate();
}

// -- theme ----------------------------------------------------------------

function systemPrefersDark() {
  return window.matchMedia(SYSTEM_DARK_QUERY).matches;
}

function updateThemeControl() {
  const other = nextTheme(state.theme);
  dom.toggleTheme.textContent = t('action.theme', { theme: t(`theme.${state.theme}`) });
  dom.toggleTheme.title = t('action.themeTitle', { theme: t(`theme.${other}`) });
}

/**
 * Put a theme in effect.
 *
 * `data-theme` is always a concrete value: the layout sets one before the first
 * paint and this keeps it in step afterwards. That keeps the stylesheet down to
 * two blocks with no media query, and leaves "no explicit choice means follow
 * the system" as a rule stated once — in theme.mjs — rather than twice.
 *
 * The canvas reads its colours back out of the active theme, so the palette
 * change is announced on a hook: the shell has no pixels of its own to repaint.
 */
function applyTheme(theme, persist) {
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
  if (persist) writeStored(THEME_STORAGE_KEY, theme, safeStorage());
  updateThemeControl();
  emit('theme', theme);
}

function initialiseTheme() {
  const stored = readStored(THEME_STORAGE_KEY, safeStorage());
  state.theme = resolveTheme(stored, systemPrefersDark());
  document.documentElement.dataset.theme = state.theme;
  updateThemeControl();
}

// -- talking to the service ----------------------------------------------

function showError(message) {
  dom.error.textContent = message;
  dom.error.hidden = false;
}

function clearError() {
  dom.error.hidden = true;
  dom.error.textContent = '';
}

/**
 * Show a failure with a translated label and the core's own message as detail.
 *
 * The label is ours and is translated; the message is the core's and is not,
 * because it names the field or the bound that was wrong and a translation of it
 * would be a second description of the same fact. See README.md.
 */
function showCodeError(code, message) {
  showError(describeError(state.locale, code, message));
}

function setCoreStatus(kind, message) {
  dom.coreStatus.dataset.state = kind;
  dom.coreStatus.textContent = message;
}

function statusOk() {
  return state.rule === ''
    ? t('status.connecting')
    : t('status.ok', { rule: state.rule, representation: state.representation ?? '' });
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {
      ok: false,
      error: 'bad_reply',
      message: `HTTP ${response.status} with a non-JSON body`,
    };
  }
}

/** Ask the service for a JSON reply and hand back the parsed body. */
async function postJson(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { response, reply: await readJson(response) };
}

/**
 * A path with this page's session attached, when it is not the default.
 *
 * The default is omitted so a request written before sessions existed is still
 * byte-identical to what it was: the id is added only where it changes the
 * answer, which is also what keeps the existing request assertions honest.
 */
export function apiUrl(path) {
  if (state.sessionId === DEFAULT_SESSION_ID) return path;
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}session=${encodeURIComponent(state.sessionId)}`;
}

async function callCore(payload) {
  let response;
  try {
    response = await fetch(apiUrl('/api/command'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    setCoreStatus('down', t('status.serviceUnreachable'));
    showError(t('error.serviceUnreachable', { message: error.message }));
    return null;
  }
  const reply = await readJson(response);
  if (response.status === 503 || reply.error === 'core_unavailable') {
    setCoreStatus('down', t('status.coreUnavailable'));
    showError(t('error.coreUnavailable', { message: reply.message ?? response.status }));
    stopPolling();
    state.running = false;
    emit('state', reply);
    return null;
  }
  if (!response.ok) {
    showCodeError(reply.error ?? 'internal', reply.message ?? `HTTP ${response.status}`);
    return null;
  }
  if (reply.ok === false) {
    showCodeError(reply.error, reply.message);
    return reply;
  }
  setCoreStatus('ok', statusOk());
  clearError();
  return reply;
}

/**
 * Take the facts a reply carries into the shared state.
 *
 * Only what the reply actually says: a field the core left out is not a field
 * this page may invent, because the world belongs to the core.
 */
function absorb(payload) {
  if (!payload) return payload;
  if (typeof payload.population === 'number') state.population = payload.population;
  if (typeof payload.generation === 'number') state.generation = payload.generation;
  if (typeof payload.running === 'boolean') state.running = payload.running;
  // The rate the core is actually running at, which is not the same as the range
  // it declared: the range is a limit and is applied by the page that owns the
  // rate control.
  if (typeof payload.tps === 'number') state.tps = payload.tps;
  if (payload.world) state.world = payload.world;
  if (typeof payload.rule === 'string' && payload.rule !== '') state.rule = payload.rule;
  if (Array.isArray(payload.bounds)) state.bounds = payload.bounds;
  if (typeof payload.history === 'boolean') state.history = payload.history;
  if (typeof payload.representation === 'string') state.representation = payload.representation;
  return payload;
}

/**
 * Take the bounds and the vocabulary the core declared.
 *
 * Called from `state` and from the stream's `hello`. The rate control and the
 * representation list are built from here and from nowhere else: a copy in a
 * page would be the copy that drifts, and a page that offers a rate the core
 * refuses is a page that lies. The shell only records the limits; the page that
 * owns the controls applies them.
 */
function rememberLimits(limits) {
  state.limits = limits;
  emit('limits', limits);
}

async function fetchState() {
  let response;
  try {
    response = await fetch(apiUrl('/api/state'));
  } catch (error) {
    setCoreStatus('down', t('status.serviceUnreachable'));
    showError(t('error.serviceUnreachable', { message: error.message }));
    return null;
  }
  const reply = await readJson(response);
  if (!reply.ok) {
    setCoreStatus('down', t('status.coreUnavailable'));
    showError(t('error.coreUnavailable', { message: reply.message ?? response.status }));
    return null;
  }
  absorb(reply);
  // The service carries the core's declared limits, its history flag and the
  // representation on every state reply, because a page that fell back to
  // polling never sees the stream's `hello` — and a page with no limits has a
  // rate control it cannot offer.
  if (reply.limits) rememberLimits(readLimits({ limits: reply.limits }));
  emit('state', reply);
  setCoreStatus('ok', statusOk());
  clearError();
  return reply;
}

// -- sessions -------------------------------------------------------------

/**
 * Fill the session control from the service.
 *
 * The list is the service's registry, so a session created in another tab
 * appears here on the next load. A service that cannot answer leaves the
 * control empty and the button disabled rather than offering a session that
 * cannot be reached.
 */
async function loadSessions() {
  if (!dom.session) return;
  try {
    const response = await fetch('/api/sessions');
    const reply = await readJson(response);
    if (!response.ok || reply.ok === false || !Array.isArray(reply.sessions)) {
      dom.sessionNew.disabled = true;
      return;
    }
    fillOptions(
      dom.session,
      reply.sessions.map((session) => session.id),
      (id) => reply.sessions.find((session) => session.id === id)?.label ?? id,
    );
    dom.session.value = state.sessionId;
    dom.sessionNew.disabled = false;
    const queued = Number.isInteger(reply.queued) ? reply.queued : 0;
    if (dom.sessionQueued) {
      dom.sessionQueued.dataset.count = String(queued);
      dom.sessionQueued.textContent = queued > 0 ? t('label.queued', { count: queued }) : '';
      dom.sessionQueued.hidden = queued === 0;
    }
    // A tab keeps the session it is showing: every link in the navigation
    // carries the id, or a person who changes page silently returns to `main`.
    if (state.sessionId !== DEFAULT_SESSION_ID && typeof document.querySelectorAll === 'function') {
      for (const link of document.querySelectorAll('a.tab')) {
        const href = link.getAttribute('href');
        if (href === null) continue;
        link.setAttribute(
          'href',
          `${href}${href.includes('?') ? '&' : '?'}session=${encodeURIComponent(state.sessionId)}`,
        );
      }
    }
  } catch {
    dom.sessionNew.disabled = true;
  }
}

/** Go to another session: every call needs its id, so the page reloads. */
function goToSession(id) {
  if (typeof location === 'undefined' || typeof location.assign !== 'function') return;
  const url = new URL(location.href);
  if (id === DEFAULT_SESSION_ID) url.searchParams.delete('session');
  else url.searchParams.set('session', id);
  location.assign(url.toString());
}

/**
 * Create a session at the size of the one on screen.
 *
 * A new session at the same size is the comparison a person is making: the same
 * world, run twice. A session created before the core has described its world
 * lets the core choose its own size.
 */
async function createSession() {
  if (!dom.sessionNew) return;
  dom.sessionNew.disabled = true;
  try {
    const body = {};
    if (state.world) {
      body.width = state.world.width;
      body.height = state.world.height;
    }
    const { response, reply } = await postJson('/api/sessions', body);
    if (!response.ok || reply.ok === false) {
      showCodeError(reply.error ?? 'internal', reply.message ?? `HTTP ${response.status}`);
      dom.sessionNew.disabled = false;
      return;
    }
    goToSession(reply.session.id);
  } catch (error) {
    showError(t('error.sessionFailed', { message: error.message }));
    dom.sessionNew.disabled = false;
  }
}

// -- the push transport ---------------------------------------------------
//
// The service pushes what changed. `GET /api/events` is one Server-Sent Events
// stream per page: `hello` names the client and carries the core's declared
// limits, `tick` and `state` say the world moved, `frame` carries the pixels for
// the rectangle this page subscribed to, and `error` says the core is unhappy.
//
// Two details are worth stating because they are not obvious:
//
// - **The stream name `error` collides with the browser's own.** `EventSource`
//   fires an `error` event when the connection drops, and a server-sent
//   `event: error` dispatches on the same name. A server event arrives as a
//   `MessageEvent` carrying `data`; a transport failure arrives as an event with
//   no `data`. The listener tells them apart by that, rather than by renaming an
//   event the protocol asked for.
// - **Polling is not removed, it is demoted.** If the stream cannot be opened,
//   or drops, the page goes back to asking for frames on a timer, which is what
//   it did before. A push transport that failed silently would leave a blank
//   page and no explanation.
//
// The shell owns the connection; the *rectangle* is the page's, because only the
// page that draws the canvas knows what it is looking at. `hello` is therefore
// announced rather than acted on.

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function closeStream() {
  if (state.stream !== null) {
    state.stream.close();
    state.stream = null;
  }
  state.streamConnected = false;
  state.clientId = null;
  state.subscriptionKey = '';
}

function onStreamLost() {
  closeStream();
  scheduleStreamRetry();
  if (state.timer === null && state.running) {
    // Polling is now the only way this page learns that the world moved.
    scheduleTick();
  }
  void afterChange();
}

function scheduleStreamRetry() {
  if (state.streamTimer !== null) return;
  state.streamTimer = setTimeout(() => {
    state.streamTimer = null;
    // Re-check at fire time: an environment that never had `EventSource` must
    // not be retried into one that appears later.
    if (typeof EventSource !== 'function') return;
    startStream();
  }, STREAM_RETRY_MS);
}

function startStream() {
  if (typeof EventSource !== 'function') {
    // Not every environment has it, and a test harness may deliberately not.
    if (state.running) scheduleTick();
    return;
  }
  closeStream();
  let source;
  try {
    source = new EventSource(apiUrl('/api/events'));
  } catch (error) {
    showError(t('error.streamOpen', { message: error.message }));
    if (state.running) scheduleTick();
    return;
  }
  state.stream = source;

  source.addEventListener('hello', (event) => {
    const payload = safeParse(event.data) ?? {};
    state.clientId = payload.clientId ?? null;
    state.streamConnected = true;
    if (typeof payload.representation === 'string') state.representation = payload.representation;
    if (payload.world) state.world = payload.world;
    if (typeof payload.rule === 'string' && payload.rule !== '') state.rule = payload.rule;
    if (payload.limits) rememberLimits(readLimits({ limits: payload.limits }));
    state.history = payload.history === true;
    // The stream carries the changes now, so the timer stops.
    stopPolling();
    setCoreStatus('ok', statusOk());
    clearError();
    emit('hello', payload);
    // The recording is read again on `hello` as well as on `tick`, because a
    // core that was restarted (a representation switch) records into a new
    // session, and a page that kept the old tree would show a dead branch.
    void refreshHistory();
  });

  source.addEventListener('state', (event) => {
    const payload = safeParse(event.data);
    absorb(payload);
    if (payload?.limits) rememberLimits(readLimits({ limits: payload.limits }));
    emit('state', payload);
  });

  source.addEventListener('tick', (event) => {
    const payload = absorb(safeParse(event.data));
    emit('tick', payload);
  });

  source.addEventListener('frame', (event) => {
    const frame = safeParse(event.data);
    if (frame === null) return;
    absorb(frame);
    emit('frame', frame);
  });

  // A committed transaction and a collaborator's presence travel on the same
  // stream; the editing page is the only consumer, and it ignores both while the
  // mode is closed.
  source.addEventListener('patch', (event) => {
    const payload = safeParse(event.data);
    if (payload === null) return;
    emit('patch', payload);
  });

  source.addEventListener('presence', (event) => {
    const payload = safeParse(event.data);
    if (payload === null) return;
    emit('presence', payload);
  });

  source.addEventListener('error', (event) => {
    if (typeof event.data === 'string') {
      // The service is reporting, not the transport failing.
      const payload = safeParse(event.data) ?? {};
      showCodeError(payload.error ?? 'internal', payload.message ?? event.data);
      if (payload.error === 'core_unavailable') {
        setCoreStatus('down', t('status.coreUnavailable'));
      }
      return;
    }
    showError(t('error.streamLost'));
    onStreamLost();
  });
}

// -- the fallback poll loop ----------------------------------------------
//
// When the stream is not up, a page asks for what it draws on a timer. The
// timer is the shell's — a route without a canvas has nothing to ask for, and
// `afterChange` resolves immediately when nothing is listening.

function stopPolling() {
  if (state.timer !== null) {
    clearTimeout(state.timer);
    state.timer = null;
  }
}

function scheduleTick() {
  stopPolling();
  if (!state.running) return;
  const interval = Math.max(16, Math.round(1000 / state.tps));
  state.timer = setTimeout(async () => {
    await afterChange();
    scheduleTick();
  }, interval);
}

// -- the handshake --------------------------------------------------------

/**
 * The context a page module receives. One object, handed to every page, holding
 * the shared state and the shell's own operations — never a page's.
 */
const context = {
  state,
  dom,
  t,
  describeError,
  on,
  emit,
  readJson,
  postJson,
  apiUrl,
  callCore,
  absorb,
  rememberLimits,
  showError,
  showCodeError,
  clearError,
  setCoreStatus,
  statusOk,
  safeStorage,
  afterChange,
  refreshHistory,
  startPolling: scheduleTick,
  stopPolling,
};

/**
 * Hand the context to whoever is listening.
 *
 * Called once at start-up — for a page module that loaded *before* the shell,
 * whose request went out before this file existed — and again for every
 * `lifegame:shell-request`, which is the normal order (the layout loads the
 * shell first). Both orders therefore work, and that is a property a test
 * exercises rather than a hope.
 */
function publishContext() {
  document.dispatchEvent(new CustomEvent(SHELL_EVENT, { detail: context }));
}

// -- events ---------------------------------------------------------------

dom.toggleTheme.addEventListener('click', () => applyTheme(nextTheme(state.theme), true));

dom.locale.addEventListener('change', () => {
  applyLocale(dom.locale.value === 'zh' ? 'zh' : 'en', true);
});

dom.session.addEventListener('change', () => goToSession(dom.session.value));
dom.sessionNew.addEventListener('click', () => {
  void createSession();
});

// Follow the operating system while — and only while — the user has not chosen.
// An explicit choice is absolute, so a system change must not override it.
window.matchMedia(SYSTEM_DARK_QUERY).addEventListener('change', () => {
  const stored = readStored(THEME_STORAGE_KEY, safeStorage());
  if (isExplicitTheme(stored)) return;
  applyTheme(resolveTheme(stored, systemPrefersDark()), false);
});

document.addEventListener(SHELL_REQUEST_EVENT, publishContext);

// -- start ----------------------------------------------------------------

async function main() {
  // The language first, so every string the rest of this function produces is
  // already in the right one. Then the theme, which the layout set before the
  // first paint and which this keeps in step from here on.
  state.representation = null;
  initialiseLocale();
  initialiseTheme();
  retranslate();
  // Whoever is listening gets the context now. A page module that already asked
  // for it (one that loaded before this file) is answered here; a page module
  // that loads later is answered by the request listener above.
  publishContext();
  void loadSessions();

  await fetchState();
  startStream();
}

void main();
