/**
 * lifegame viewer — the world route: the canvas, its panel and its controls.
 *
 * This is the page the interface used to be. What is left here is what only the
 * world needs: measuring the canvas, the two rendering paths, the pointer
 * gestures and keys, the zoom and pan arithmetic's wiring, the readouts, and the
 * controls that move the world. The language, the theme, the status line, the
 * error banner and the event stream belong to the shell (`../app.js`), which
 * this module never imports — it asks for the shared context over the
 * `lifegame:shell` handshake in `../link.mjs`.
 *
 * Nothing here computes a generation. Every action is a request, and every pixel
 * comes from a `frame` reply.
 *
 * Four consequences of the protocol shape the code:
 *
 * - **A frame's rectangle is its resolution.** `frame(x0, y0, w, h)` returns w
 *   by h world cells at one cell per pixel, so a viewport wider than the frame
 *   budget cannot be rendered faithfully at all. `maxSpan()` therefore bounds
 *   zoom-out, using the encoder's own rule, which lives in shared.mjs because
 *   the service applies it too.
 * - **The view a page opens with is a function of its canvas.** One cell per
 *   `DEFAULT_PIXELS_PER_CELL` CSS pixels across — `viewport.mjs` owns the rule,
 *   and `placeDefaultView` below is its only caller on this route. The origin
 *   puts the *world's* centre in the middle of that view, and neither the span
 *   nor the origin is decided until the canvas has a size and the core has said
 *   how big the world is: a guessed rectangle is a request the user did not ask
 *   for.
 * - **Rendering has two paths.** `bits` is a bitmap of the frame's rectangle and
 *   is drawn scaled, which is what a dense or mid-zoom view wants. `cells`
 *   carries absolute coordinates and is plotted directly, which keeps a
 *   single cell visible as a dot even when a thousand of them fit in one pixel.
 *   Both live in `frame-draw.mjs`, because the history preview draws the same
 *   world with the same code.
 * - **The palette belongs to the stylesheet.** The canvas paints itself, so it
 *   cannot inherit CSS; the three colours it needs are read back from the active
 *   theme's custom properties whenever the theme changes, which the shell
 *   announces on the `theme` hook.
 * - **Every word comes from the locale table.** This file holds no user-visible
 *   English or Chinese; it holds keys. The shell fills every `data-i18n` node in
 *   the document, and this page fills the rest — the option labels, the titles
 *   and the hint line.
 *
 * Every decision that *can* be a pure function is one, in viewport.mjs,
 * theme.mjs, locales.mjs or shared.mjs, because the browser cannot be driven
 * from `node --test` and a decision that lives only here is a decision nothing
 * checks.
 */

import { decodeCells, forEachLiveBit } from '../decode.mjs';
import {
  EDIT_TOOLS,
  SNIPPET_MODES,
  SNIPPET_TRANSFORMS,
  boxFits,
  boxOf,
  lineCells,
  newCells,
  rectCells,
  stampOperation,
} from '../edit-tools.mjs';
import { DEFAULT_PALETTE, drawFrame, readPalette } from '../frame-draw.mjs';
import { focusFromLocation, writeFocus } from '../focus.mjs';
import { HINT_SEGMENTS } from '../locales.mjs';
import { fillOptions, labelOptions } from '../options.mjs';
import {
  PANEL_STORAGE_KEY,
  canvasVisible,
  resolvePanelMode,
  toggleCollapsed,
  toggleWide,
} from '../panel.mjs';
import {
  CUSTOM_RULE,
  PRESET_RULES,
  RULE_PRESETS,
  parseRule,
  presetFor,
  reportedRule,
} from '../rule.mjs';
import { clampTicksPerSecond } from '../shared.mjs';
import {
  GRID_WIDTHS,
  GRID_WIDTH_STORAGE_KEY,
  clampGridWidth,
  readStored,
  writeStored,
} from '../theme.mjs';
import {
  MIN_SPAN,
  centreViewport as centreAt,
  clampViewport as clampViewportTo,
  defaultSpan,
  frameRequest as computeFrameRequest,
  gestureSample,
  isClick,
  maxSpan as computeMaxSpan,
  panByPixels as translateViewport,
  pinchViewport as pinchToViewport,
  screenToWorld as projectToWorld,
  viewCentre,
  worldCentre,
  zoomAt as rescaleAt,
} from '../viewport.mjs';
import { connectShell } from '../link.mjs';

// -- the shared context, filled by the shell ------------------------------
//
// Module-level bindings, so every function below reads `state`, `dom` and `t`
// exactly as it did when this was one file. `fill` is called by the handshake
// before `ready`, and again if the shell publishes more than once.

let state = null;
const dom = {};
let t = (key) => key;
let afterChange = () => Promise.resolve();
let refreshHistory = () => Promise.resolve();
let callCore = async () => null;
let apiUrl = (path) => path;
let readJson = async () => ({ ok: false, error: 'bad_reply', message: 'no shell' });
let absorb = (payload) => payload;
let showError = () => {};
let showCodeError = () => {};
let describeError = (code) => String(code);
let clearError = () => {};
let setCoreStatus = () => {};
let statusOk = () => '';
let safeStorage = () => null;
let startPolling = () => {};
let stopPolling = () => {};

/**
 * Whether the person has typed in the rule field.
 *
 * The field opens on the rule in force, which arrives *after* this module starts
 * — the shell publishes its context before it has fetched its state — so the
 * opening value is written the first time a rule arrives, and never again once
 * this is true. Rewriting a field under somebody who is typing in it is worse
 * than leaving it empty.
 */
let ruleFieldEdited = false;

/**
 * The pattern library, as the service reported it at start-up.
 *
 * The page does not keep a list of its own: a pattern is data the service owns,
 * and a second copy here would be the copy that drifts. It is empty until the
 * read lands, and the control stays disabled while it is.
 */
let patterns = [];

function fill(context) {
  state = context.state;
  if (!state.edit) {
    // The editing mode's page state. `active`, `version` and `hash` come from
    // the service; the tool, selection and draft are this page's. A draft is not
    // a published snippet, and it is not sent anywhere until the person says so.
    state.edit = {
      active: false,
      busy: false,
      tool: 'paint',
      author: null,
      version: null,
      hash: null,
      undoDepth: 0,
      redoDepth: 0,
      selection: null,
      gesture: null,
      draft: null,
      palette: null,
      presence: new Map(),
    };
  }
  // The shared containers join this page's own. The page's are bound at module
  // scope, below, because a module script runs after the document is parsed and
  // the event wiring needs them then — whichever order the shell loads in.
  Object.assign(dom, context.dom);
  t = context.t;
  afterChange = context.afterChange;
  refreshHistory = context.refreshHistory;
  callCore = context.callCore;
  apiUrl = context.apiUrl;
  readJson = context.readJson;
  absorb = context.absorb;
  showError = context.showError;
  showCodeError = context.showCodeError;
  describeError = context.describeError;
  clearError = context.clearError;
  setCoreStatus = context.setCoreStatus;
  statusOk = context.statusOk;
  safeStorage = context.safeStorage;
  startPolling = context.startPolling;
  stopPolling = context.stopPolling;
  registerHooks(context.on);
}

/**
 * The moments of the shell's life this page has to answer.
 *
 * Registered once, on the first handshake: the shell publishes its context more
 * than once (at start-up, and again for every request), and a second
 * registration would draw every frame twice.
 */
let hooksRegistered = false;
function registerHooks(on) {
  if (hooksRegistered) return;
  hooksRegistered = true;
  on('retranslate', retranslateOwn);
  on('theme', onTheme);
  on('limits', applyLimits);
  on('state', onState);
  on('hello', onHello);
  on('frame', onFrame);
  on('tick', () => updateReadout());
  on('patch', onRemotePatch);
  on('presence', onRemotePresence);
  on('afterChange', refreshAfterChange);
}

/**
 * The elements this page reads.
 *
 * Literal `getElementById` calls rather than a table, because
 * `tests/dom-contract.test.mjs` reads this list out of the file as text and
 * asserts the world fragment declares every id in it. The synthetic browser
 * returns null for an id the markup does not declare, so a container that went
 * missing fails a test rather than quietly existing. Called at module scope
 * below, because a module script runs after the document is parsed and the
 * event wiring needs the elements then.
 */
function bindOwnDom() {
  dom.stage = document.getElementById('stage');
  dom.canvas = document.getElementById('grid');
  dom.canvasArea = document.getElementById('canvas-area');
  dom.panel = document.getElementById('panel');
  dom.panelHandle = document.getElementById('panel-handle');
  dom.panelWide = document.getElementById('panel-wide');
  dom.hint = document.getElementById('hint');
  dom.toggleRun = document.getElementById('toggle-run');
  dom.stepOnce = document.getElementById('step-once');
  dom.clearWorld = document.getElementById('clear-world');
  dom.undoEdit = document.getElementById('undo-edit');
  dom.editMode = document.getElementById('edit-mode');
  dom.editControls = document.getElementById('edit-controls');
  dom.editTool = document.getElementById('edit-tool');
  dom.editUndo = document.getElementById('edit-undo');
  dom.editRedo = document.getElementById('edit-redo');
  dom.snippetName = document.getElementById('snippet-name');
  dom.snippetSave = document.getElementById('snippet-save');
  dom.snippetPublish = document.getElementById('snippet-publish');
  dom.snippetTransform = document.getElementById('snippet-transform');
  dom.snippetMode = document.getElementById('snippet-mode');
  dom.snippetPalette = document.getElementById('snippet-palette');
  dom.editStatus = document.getElementById('edit-status');
  dom.editPresence = document.getElementById('edit-presence');
  dom.gridWidth = document.getElementById('grid-width');
  dom.representation = document.getElementById('representation');
  dom.rulePreset = document.getElementById('rule-preset');
  dom.ruleCustom = document.getElementById('rule-custom');
  dom.ruleApply = document.getElementById('rule-apply');
  dom.ruleError = document.getElementById('rule-error');
  dom.patternName = document.getElementById('pattern-name');
  dom.patternPlace = document.getElementById('pattern-place');
  dom.tps = document.getElementById('tps');
  dom.tpsValue = document.getElementById('tps-value');
  dom.generation = document.getElementById('readout-generation');
  dom.population = document.getElementById('readout-population');
  dom.origin = document.getElementById('readout-origin');
  dom.span = document.getElementById('readout-span');
  dom.rule = document.getElementById('readout-rule');
  dom.world = document.getElementById('readout-world');
  dom.cell = document.getElementById('readout-cell');
  if (dom.canvas !== null) canvas2d = dom.canvas.getContext('2d', { alpha: false });
}

/**
 * The containers this page cannot work without.
 *
 * A missing one is a broken fragment or a broken route, not a state the page can
 * recover from. The first attempt at this split returned early and silently here,
 * which produced a blank page with a green test suite; the answer is to say so
 * where the user can see it, and to let the contract test catch the cause.
 */
function missingContainers() {
  return ownKeys.filter((name) => dom[name] === null || dom[name] === undefined);
}

/**
 * The colours the canvas paints with, resolved from the active theme.
 *
 * The canvas cannot inherit CSS, so `--alive`, `--dead` and `--grid` are read
 * back through `getComputedStyle` and cached here; the cache is refreshed on the
 * shell's `theme` hook. The starting value is the dark palette's, so a
 * stylesheet that cannot be read leaves the page as it was rather than blank.
 * The reading and the drawing both live in `frame-draw.mjs`, because the history
 * preview paints the same world.
 */
let palette = DEFAULT_PALETTE;

/** The 2D context, created once the canvas is known to exist. */
let canvas2d = null;
const offscreen = document.createElement('canvas');

// -- small helpers --------------------------------------------------------

function canvasSize() {
  const rect = dom.canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = Math.max(1, Math.round(rect.width));
  const cssHeight = Math.max(1, Math.round(rect.height));
  const pixelWidth = Math.max(1, Math.round(cssWidth * dpr));
  const pixelHeight = Math.max(1, Math.round(cssHeight * dpr));
  if (dom.canvas.width !== pixelWidth || dom.canvas.height !== pixelHeight) {
    dom.canvas.width = pixelWidth;
    dom.canvas.height = pixelHeight;
  }
  return { cssWidth, cssHeight, dpr };
}

// -- the panel ------------------------------------------------------------

/**
 * What the canvas does when the space it is drawn in changes.
 *
 * The frame already held is still a valid description of the world; it is drawn
 * at the new size immediately and replaced by a correctly sized one as soon as
 * the core answers. Waiting for the next pushed event would leave a stretched
 * canvas on screen until something unrelated happened.
 *
 * The view is re-placed first, which is what makes the default span follow the
 * window: until the user has panned or zoomed, a wider canvas shows more of the
 * world at the same cell size rather than the same world stretched.
 */
function onCanvasResized() {
  repaint();
  if (!canvasVisible(state.panel)) return;
  if (!placeDefaultView()) return;
  clampViewport();
  rememberFocus();
  updateReadout();
  requestViewportUpdate();
}

/**
 * Notice the canvas changing size for reasons the window does not see.
 *
 * Collapsing the panel, or switching language, changes the canvas without a
 * `resize` event on the window, so the browser's own observer is the only signal
 * that arrives in time. Where it is missing — an older browser — the explicit
 * call in `applyPanel` still covers the panel's own three states.
 */
function watchCanvasSize() {
  if (typeof ResizeObserver !== 'function') return;
  state.resizeObserver = new ResizeObserver(() => onCanvasResized());
  state.resizeObserver.observe(dom.canvas);
}

function initialisePanel() {
  let stored = null;
  try {
    stored = safeStorage()?.getItem(PANEL_STORAGE_KEY) ?? null;
  } catch {
    stored = null; // a storage that throws means no preference, not a failure
  }
  applyPanel(resolvePanelMode(stored), false);
}

function applyPanel(mode, persist) {
  state.panel = resolvePanelMode(mode);
  dom.stage.dataset.panel = state.panel;
  if (persist) {
    try {
      safeStorage()?.setItem(PANEL_STORAGE_KEY, state.panel);
    } catch {
      // A preference that cannot be stored is a smaller problem than a page
      // that stops working in private mode.
    }
  }
  updatePanelControls();
  // The layout has already changed by the time this returns, so the canvas can
  // be measured; the observer would also fire, and doing it here as well is what
  // makes the three states work without an observer at all.
  onCanvasResized();
}

function updatePanelControls() {
  const collapsed = state.panel === 'collapsed';
  dom.panelHandle.textContent = collapsed ? t('action.expand') : t('action.collapse');
  dom.panelHandle.title = collapsed ? t('panel.expandTitle') : t('panel.collapseTitle');
  const wide = state.panel === 'wide';
  dom.panelWide.textContent = wide ? t('action.narrow') : t('action.wide');
  dom.panelWide.title = wide ? t('panel.narrowTitle') : t('panel.wideTitle');
}

// -- theme and grid width -------------------------------------------------

/**
 * Read the canvas colours out of the active theme.
 *
 * A value this module cannot parse leaves the previous colour in place rather
 * than painting something arbitrary; `readPalette` is the rule and this is the
 * one place on this route that reaches for the stylesheet.
 */
function readPaletteFromTheme() {
  palette = readPalette(getComputedStyle(document.documentElement), palette);
}

/** Redraw the frame already on screen. Used when only the pixels change. */
function repaint() {
  if (state.lastFrame !== null) render(state.lastFrame);
}

function initialiseGridWidth() {
  const stored = readStored(GRID_WIDTH_STORAGE_KEY, safeStorage());
  state.gridWidth = clampGridWidth(stored);
  fillOptions(dom.gridWidth, GRID_WIDTHS.map(String), (value) =>
    t('label.gridWidth', { width: value }),
  );
  dom.gridWidth.value = String(state.gridWidth);
}

function updateTranslatedTitles() {
  dom.gridWidth.title = t('label.gridWidthTitle');
  dom.representation.title = t('label.storageTitle');
  dom.patternName.setAttribute('aria-label', t('label.pattern'));
  dom.patternPlace.setAttribute('aria-label', t('action.place'));
  // The controls name themselves: a title is what a person sees before pressing
  // something and what a screen reader announces, and it is the only place a
  // shortcut is stated next to the control it belongs to.
  dom.undoEdit.title = t('label.undoTitle');
  dom.toggleRun.title = t(state.running ? 'label.pauseTitle' : 'label.runTitle');
  dom.stepOnce.title = t('label.stepTitle');
  dom.clearWorld.title = t('label.clearTitle');
  dom.patternPlace.title = t('label.placeTitle');
  updateRuleTitles();
}

/** Rewrite the labels of this page's selects, in place, on a language change. */
function updateOptionLabels() {
  labelOptions(dom.gridWidth, (value) => t('label.gridWidth', { width: value }));
  labelOptions(dom.representation, (value) => t(`representation.${value}`));
  // The rule entries are relabelled even though the rule has not changed: the
  // words around it have, and the guard in `updateRuleControl` is about the
  // rule rather than about the language.
  ruleLabelled = null;
  labelOptions(dom.rulePreset, ruleOptionLabel);
}

/**
 * Build the preset select from the list that owns it.
 *
 * `RULE_PRESETS` names the rules and the locale table names the words, so the
 * markup carries an empty `<select>` and this is the only place the two meet.
 * The custom entry is last and is always present: a rule the core reports which
 * is not a preset — including the one it reports at handshake — has to have
 * somewhere to be shown.
 */
function initialiseRuleEditor() {
  fillOptions(dom.rulePreset, [...PRESET_RULES, CUSTOM_RULE], ruleOptionLabel);
  updateRuleTitles();
  updateRuleControl();
  // The field may already be fillable here, and may not be: `updateRuleControl`
  // fills it from the rule once the shell has one, whichever comes first. Once
  // the person has typed in the field this stays true and the field is theirs.
  dom.ruleCustom.addEventListener('input', () => {
    ruleFieldEdited = true;
  });
}

function hintNodes() {
  const nodes = [];
  HINT_SEGMENTS.forEach((segment, index) => {
    if (index > 0) nodes.push(document.createTextNode(' · '));
    if (segment.key) {
      const kbd = document.createElement('kbd');
      kbd.textContent = t(segment.key);
      nodes.push(kbd, document.createTextNode(' '));
    }
    nodes.push(document.createTextNode(t(segment.text)));
  });
  return nodes;
}

// -- viewport -------------------------------------------------------------
//
// The arithmetic itself lives in viewport.mjs, where `node --test` can execute
// it against a synthetic canvas. These functions are the wiring: they read the
// canvas size and the world out of the page and hand them over.

/** True once a view has been placed at least once; see `placeDefaultView`. */
let placed = false;

/** True once the user has panned or zoomed: the view belongs to them after that. */
let userMoved = false;

/** The centre last written to storage, so one gesture does not write it twice. */
let rememberedFocus = null;

/**
 * The rule string the preset select's entries were last labelled for.
 *
 * `updateRuleControl` is reached from every readout update, including a tick
 * that arrives sixty times a second, and eight of the nine entries never change.
 * The ninth is the custom entry, which carries the running rule, so the rule
 * string is the one fact that decides whether the words have to be rewritten.
 */
let ruleLabelled = null;

/**
 * Remember where this page is looking, in world coordinates.
 *
 * The history route's preview centres itself on the live cell nearest to this
 * point, so it is written whenever the view moves rather than only when the page
 * is left: a person who pans and then clicks a node has said where they are
 * working. The rounding happens in `focus.mjs`; this only avoids writing the
 * same point twice, which a drag at a fixed pixel would otherwise do once per
 * event.
 */
function rememberFocus() {
  if (state.viewport.span <= 0) return;
  const { cssWidth, cssHeight } = canvasSize();
  const centre = viewCentre(state.viewport, cssWidth, cssHeight);
  const key = `${Math.round(centre.x)},${Math.round(centre.y)}`;
  if (key === rememberedFocus) return;
  rememberedFocus = key;
  writeFocus(safeStorage(), centre, state.sessionId);
}

/** The user has changed the view, so the default view must not be re-applied. */
function noteUserMoved() {
  userMoved = true;
  rememberFocus();
}

/** The widest span that can be rendered without risking a dense frame. */
function maxSpan() {
  if (state.world === null) return state.viewport.span;
  const { cssWidth, cssHeight } = canvasSize();
  return computeMaxSpan({
    cssWidth,
    cssHeight,
    population: state.population,
    world: state.world,
  });
}

function clampViewport() {
  if (state.world === null) return;
  const { cssWidth, cssHeight } = canvasSize();
  clampViewportTo(state.viewport, state.world, cssWidth, cssHeight);
}

/**
 * True once there is a view to ask for: a world from the core, a canvas with a
 * real size, and a panel state that shows it.
 *
 * The canvas' *measured* rectangle is what decides, not the size the element
 * reports after being clamped to one: a canvas that has not been laid out yet,
 * or one the full-width panel state has hidden, would otherwise produce a
 * request for a rectangle nobody asked for.
 */
function viewReady() {
  if (state.world === null) return false;
  if (!canvasVisible(state.panel)) return false;
  const rect = dom.canvas.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/**
 * Place the view the page opens with, and re-place it when the canvas changes.
 *
 * The rule is `viewport.mjs`'s: one cell per `DEFAULT_PIXELS_PER_CELL` CSS
 * pixels across, with the world's centre in the middle of that view. It is
 * applied on every canvas change until the user has panned or zoomed, and never
 * after: a resize that re-centred a view the user had moved would throw away the
 * place they were working.
 *
 * @returns {boolean} whether there is a view to ask for
 */
function placeDefaultView() {
  if (!viewReady()) return false;
  if (placed && userMoved) return true;
  const { cssWidth, cssHeight } = canvasSize();
  const centre = worldCentre(state.world);
  if (centre === null) return false;
  const next = centreAt({
    point: centre,
    span: defaultSpan(cssWidth),
    cssWidth,
    cssHeight,
    world: state.world,
  });
  state.viewport.span = next.span;
  state.viewport.x0 = next.x0;
  state.viewport.y0 = next.y0;
  placed = true;
  rememberFocus();
  return true;
}

function frameRequest() {
  // Nothing has been placed, so there is nothing to ask for: a request made
  // before the canvas or the world is known is a request for a guessed
  // rectangle, which is what the user would then see.
  if (!placed) return null;
  if (state.world === null) return null;
  const { cssWidth, cssHeight } = canvasSize();
  const result = computeFrameRequest({
    viewport: state.viewport,
    world: state.world,
    cssWidth,
    cssHeight,
    population: state.population,
  });
  // A run can make the world denser than the current view can afford: a
  // viewport that was legal over a sparse world stops being legal once the
  // population grows. The request is pulled in rather than refused, and the
  // readout says so.
  state.viewport.span = result.span;
  state.zoomLimited = result.zoomLimited;
  return result.frame;
}

function screenToWorld(clientX, clientY, frame) {
  const current = frame ?? frameRequest();
  if (current === null) return null;
  const rect = dom.canvas.getBoundingClientRect();
  const { cssWidth, cssHeight } = canvasSize();
  return projectToWorld({
    clientX,
    clientY,
    rect,
    cssWidth,
    cssHeight,
    frame: current,
  });
}

function zoomAt(clientX, clientY, factor) {
  if (state.world === null || !placed) return;
  const rect = dom.canvas.getBoundingClientRect();
  const { cssWidth } = canvasSize();
  const next = rescaleAt({
    viewport: state.viewport,
    clientX,
    clientY,
    rect,
    cssWidth,
    factor,
    minSpan: MIN_SPAN,
    spanLimit: maxSpan(),
  });
  state.viewport.span = next.span;
  state.viewport.x0 = next.x0;
  state.viewport.y0 = next.y0;
  clampViewport();
  noteUserMoved();
}

function panByPixels(deltaX, deltaY) {
  const { cssWidth } = canvasSize();
  translateViewport(state.viewport, deltaX, deltaY, cssWidth);
  clampViewport();
  noteUserMoved();
}

// -- rendering ------------------------------------------------------------

/**
 * Draw a frame onto this route's canvas.
 *
 * The two encodings, the grid and the palette all belong to `frame-draw.mjs`, so
 * the history preview and this page cannot paint the same world differently.
 * What is this page's is the canvas, its grid width control, and the frame it
 * last asked for.
 */
function render(frame) {
  const { cssWidth, cssHeight, dpr } = canvasSize();
  drawFrame({
    context: canvas2d,
    offscreen,
    frame,
    cssWidth,
    cssHeight,
    dpr,
    palette,
    gridWidth: state.gridWidth,
  });
  drawEditOverlay();
}

// -- the panel's view of the transport -----------------------------------

/** Tell the service which rectangle this page is watching. */
async function publishViewport(force = false) {
  if (state.clientId === null) return;
  const request = frameRequest();
  if (request === null) return;
  const key = `${request.x0},${request.y0},${request.w},${request.h}`;
  if (!force && key === state.subscriptionKey) return;
  if (state.subscriptionInFlight) {
    // One update is enough however many gestures arrive while it is in flight;
    // the latest rectangle is sent when it lands.
    state.subscriptionAgain = true;
    return;
  }
  state.subscriptionInFlight = true;
  state.subscriptionKey = key;
  try {
    await fetch(apiUrl('/api/subscription'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientId: state.clientId, ...request }),
    });
  } catch {
    // The stream itself reports a broken service; a lost subscription update is
    // not worth an error banner of its own.
  } finally {
    state.subscriptionInFlight = false;
    if (state.subscriptionAgain) {
      state.subscriptionAgain = false;
      void publishViewport();
    }
  }
}

/** Ask for what the view shows: over the stream when it is up, else by polling. */
function requestViewportUpdate() {
  // Start-up places the panel, which resizes the canvas, which lands here before
  // the view has been centred. Asking then would fetch a frame for the wrong
  // rectangle and fetch a second one immediately after; the first frame is asked
  // for once, below, when the view is final.
  if (!started) return;
  if (state.edit?.active) sendPresence();
  if (state.streamConnected) void publishViewport();
  else void refreshFrame();
}

/** After the world changed: the stream pushes the frame, polling has to ask. */
function refreshAfterChange() {
  if (state.streamConnected) return Promise.resolve();
  return refreshFrame();
}

// -- changing the representation -----------------------------------------

/**
 * Put the core onto the other representation without losing the world.
 *
 * The service does the work — export, restart, import — and reports the state
 * it ended up with. The page's job is to show what happened and to ask for a
 * frame in the new representation; if the switch failed, the control is put
 * back to what is actually running rather than left claiming the new value.
 */
async function switchRepresentation(wanted) {
  if (state.switching || wanted === state.representation) {
    updateRepresentationControl();
    return;
  }
  state.switching = true;
  setCoreStatus('busy', t('status.switching', { representation: t(`representation.${wanted}`) }));
  try {
    const response = await fetch(apiUrl('/api/representation'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ representation: wanted }),
    });
    const reply = await readJson(response);
    if (!response.ok || reply.ok === false) {
      showCodeError(reply.error ?? 'internal', reply.message ?? `HTTP ${response.status}`);
      updateRepresentationControl();
      return;
    }
    if (reply.state) absorb(reply.state);
    if (typeof reply.representation === 'string') state.representation = reply.representation;
    updateRepresentationControl();
    setCoreStatus('ok', statusOk());
    clearError();
    updateReadout();
    // The world is the same, but it is stored differently now, so the frame has
    // to be asked for again. The recording is a *new* session too — a new core
    // process records into its own — so the tree has to be fetched again rather
    // than kept, or the history page would show the previous process's history.
    requestViewportUpdate();
    await refreshHistory();
  } catch (error) {
    showError(t('error.switchFailed', { message: error.message }));
    updateRepresentationControl();
  } finally {
    state.switching = false;
  }
}

function updateRepresentationControl() {
  if (dom.representation && state.representation !== null) {
    dom.representation.value = state.representation;
  }
}

// -- the rule editor ------------------------------------------------------

/**
 * The rule the user is editing, and whether it is one the preset list names.
 *
 * The select shows a preset's own rule string when the running rule *is* that
 * preset, and the custom entry when it is not — a rule the user typed, or one
 * the core reported at handshake. The choice is deliberate: the list means "the
 * rules people ask for by name", so claiming the nearest preset while a
 * different rule runs would be the control lying about the world. The custom
 * entry shows the running rule itself (`rule.custom`), so the control still
 * says which rule it is in force.
 *
 * The text field is deliberately *not* written here. It is only written where a
 * rule was taken — at the handshake and after the core accepted one — because
 * this function runs on every readout, including the ones a refused value
 * produces, and a field that is rewritten under the user mid-correction is a
 * field they cannot finish correcting.
 */
function updateRuleControl() {
  if (!dom.rulePreset) return;
  const current = state.rule === '' ? CUSTOM_RULE : presetFor(state.rule);
  dom.rulePreset.value = current;
  // The field opens on the rule in force, and the words *when* it does matter.
  // The shell publishes its context before it has fetched its state, so this
  // module starts while `state.rule` is still empty: filling the field only
  // during start-up left it empty on a fresh load, and pressing the button then
  // submitted an empty string and was refused in words instead of applying the
  // rule the readout was already showing. Found in a real browser, which is the
  // only place it shows. Fill it the first time the rule arrives, and never
  // again once the person has typed: a field that rewrites itself under a typist
  // is worse than an empty one.
  if (!ruleFieldEdited && dom.ruleCustom && dom.ruleCustom.value === '' && state.rule !== '') {
    dom.ruleCustom.value = state.rule;
  }
  // The words are rewritten only when the rule they describe has changed. A
  // tick can arrive sixty times a second and this runs on each one; the custom
  // entry's label carries the running rule, so the other eight entries would be
  // the same nine assignments every time.
  if (ruleLabelled !== state.rule) {
    ruleLabelled = state.rule;
    labelOptions(dom.rulePreset, ruleOptionLabel);
  }
}

/** The name of one entry of the preset select, in the language on screen. */
function ruleOptionLabel(value) {
  const preset = RULE_PRESETS.find((entry) => entry.rule === value);
  if (preset) return t(preset.key);
  const rule = state.rule === '' ? t('value.none') : state.rule;
  return t('rule.custom', { rule });
}

/** The words the two rule controls carry that are not their own text. */
function updateRuleTitles() {
  if (!dom.rulePreset) return;
  dom.rulePreset.title = t('label.rulePresetTitle');
  dom.ruleCustom.title = t('label.ruleCustomTitle');
  dom.ruleCustom.setAttribute('aria-label', t('label.ruleCustom'));
  dom.ruleApply.setAttribute('aria-label', t('action.setRule'));
}

/** Say why the last attempt was refused, beside the field that produced it. */
function showRuleError(message) {
  if (!dom.ruleError) return;
  dom.ruleError.textContent = message;
  dom.ruleError.hidden = false;
}

/**
 * A core error code and its message, in the language on screen.
 *
 * `describeError` takes the locale explicitly, because the shell and the pages
 * share it and a page knows which language it is showing. This page calls it
 * with `state.locale` so a refusal in the toolbar reads like every other string
 * on the page.
 */
function describeCoreError(code, message) {
  return describeError(state.locale, code, message);
}

/** Nothing is wrong with the field any more: usually a successful send. */
function clearRuleError() {
  if (!dom.ruleError) return;
  dom.ruleError.textContent = '';
  dom.ruleError.hidden = true;
}

/**
 * Ask the core to run a rule.
 *
 * The client checks first, so a malformed value never becomes a request: the
 * round trip would tell the user the same thing, later. The core is still the
 * authority — a value that passes here can come back `bad_rule` — and a refusal
 * is shown with the core's own reason for it. **A refusal never changes the
 * rule**: `state.rule` is written from a reply that said it took the rule, so
 * the readout, the select and the world all keep describing what is running.
 *
 * Changing the rule does not touch the transport. The core applies it from the
 * next generation, so a world that is running keeps running, and one that is
 * paused stays paused until the user steps it.
 */
async function submitRule(text) {
  const parsed = parseRule(text);
  if (!parsed.ok) {
    showRuleError(t(`rule.error.${parsed.reason}`));
    return;
  }
  const reply = await callCore({ cmd: 'set_rule', rule: parsed.rule });
  if (!reply) return;
  if (reply.ok === false) {
    // `callCore` has already shown the banner; this is the reason in the
    // toolbar, where the field the user is looking at is.
    showRuleError(describeCoreError(reply.error ?? 'bad_rule', reply.message));
    return;
  }
  // The core answers with the rule it is running, whatever it was asked for;
  // see `reportedRule` for which field is read and in what order.
  state.rule = reportedRule(reply, parsed.rule);
  // The field now shows what was actually taken, in the core's own spelling.
  // Until this point it holds what the user typed, which is what a refusal
  // leaves them able to fix.
  dom.ruleCustom.value = state.rule;
  clearRuleError();
  updateReadout();
}

/** A preset was chosen: send it now, and put the select back if it is refused. */
async function choosePreset(rule) {
  if (rule === CUSTOM_RULE) {
    // The custom entry is a label for the rule in force, not a rule to send:
    // asking the core for a rule called "custom" would be a request the user
    // did not make. Choosing it is a request for the text field instead, which
    // is the one useful thing the entry can mean.
    dom.ruleCustom.focus();
    return;
  }
  await selectRule(rule);
}

/** Send one rule, then re-state what is running — a refusal changes nothing. */
async function selectRule(rule) {
  if (rule === state.rule) {
    updateRuleControl();
    return;
  }
  await submitRule(rule);
  updateRuleControl();
}

// -- the pattern library --------------------------------------------------

/**
 * Fill the pattern select from the service's library.
 *
 * A failed read leaves the control disabled rather than offering names that
 * cannot be placed: the service resolves a name against data the page does not
 * hold, so a select filled from nothing would be a control that looks ready and
 * refuses.
 */
async function loadPatterns() {
  try {
    const response = await fetch(apiUrl('/api/patterns'));
    const reply = await readJson(response);
    if (!response.ok || reply.ok === false || !Array.isArray(reply.patterns)) {
      dom.patternPlace.disabled = true;
      return;
    }
    patterns = reply.patterns;
    fillOptions(
      dom.patternName,
      patterns.map((pattern) => pattern.name),
      (name) => name,
    );
    // A select with options but no value cannot place anything, and the
    // synthetic document used by the suite does not choose one for us; the
    // first pattern is the useful default here.
    if (dom.patternName.value === '' && patterns.length > 0) {
      dom.patternName.value = patterns[0].name;
    }
    dom.patternPlace.disabled = patterns.length === 0;
  } catch {
    dom.patternPlace.disabled = true;
  }
}

/**
 * Place the selected pattern at the centre of the view.
 *
 * The pattern's box is centred on what the person is looking at and clamped into
 * the world, so a press near an edge puts the shape against the edge rather than
 * refusing. The service resolves the cells and checks the bounds again; a
 * refusal is shown through the same error path the other controls use. The
 * service may choose the other storage after the placement, so the control is
 * re-stated from the reply rather than from what this page expected.
 */
async function placePattern() {
  const pattern = patterns.find((entry) => entry.name === dom.patternName.value);
  if (pattern === undefined || state.world === null) return;
  const size = canvasSize();
  const centre = viewCentre(state.viewport, size.cssWidth, size.cssHeight);
  const clamp = (value, most) => Math.min(Math.max(0, value), Math.max(0, most));
  const x = clamp(Math.round(centre.x - pattern.width / 2), state.world.width - pattern.width);
  const y = clamp(Math.round(centre.y - pattern.height / 2), state.world.height - pattern.height);
  try {
    const response = await fetch(apiUrl('/api/pattern'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: pattern.name, x, y }),
    });
    const reply = await readJson(response);
    if (!response.ok || reply.ok === false) {
      showCodeError(reply.error ?? 'internal', reply.message ?? `HTTP ${response.status}`);
      return;
    }
    if (typeof reply.population === 'number') state.population = reply.population;
    if (typeof reply.representation === 'string') state.representation = reply.representation;
    updateRepresentationControl();
    updateReadout();
    clearError();
    // A placed pattern is a bulk edit that this undo stack cannot reverse — it
    // does not know which of its cells were already alive — so the stack is
    // emptied rather than left claiming an inverse it cannot compute.
    clearUndo();
    requestViewportUpdate();
    await refreshHistory();
  } catch (error) {
    showError(t('error.patternFailed', { message: error.message }));
  }
}

// -- frame refresh and the run loop --------------------------------------

async function refreshFrame() {
  if (state.inFlight) {
    state.refreshAgain = true;
    return;
  }
  const request = frameRequest();
  if (request === null) return;
  state.inFlight = true;
  try {
    const query = new URLSearchParams({
      x0: String(request.x0),
      y0: String(request.y0),
      w: String(request.w),
      h: String(request.h),
    });
    let response;
    try {
      response = await fetch(apiUrl(`/api/frame?${query}`));
    } catch (error) {
      setCoreStatus('down', t('status.serviceUnreachable'));
      showError(t('error.serviceUnreachable', { message: error.message }));
      stopPolling();
      return;
    }
    const reply = await readJson(response);
    if (response.status === 503 || reply.error === 'core_unavailable') {
      setCoreStatus('down', t('status.coreUnavailable'));
      showError(t('error.coreUnavailable', { message: reply.message ?? response.status }));
      stopPolling();
      state.running = false;
      updateControls();
      return;
    }
    if (!reply.ok) {
      showCodeError(reply.error ?? 'internal', reply.message);
      return;
    }
    const frame = reply.frame;
    absorb(frame);
    state.lastFrame = frame;
    render(frame);
    setCoreStatus('ok', statusOk());
    clearError();
    updateReadout();
  } catch (error) {
    // A malformed or unknown frame must not blank the page: the previous frame
    // stays on screen and the reason is stated.
    showError(t('error.draw', { message: error.message }));
  } finally {
    state.inFlight = false;
    updateReadout();
  }
  if (state.refreshAgain) {
    state.refreshAgain = false;
    await refreshFrame();
  }
}

async function setRunning(running) {
  const reply = await callCore(running ? { cmd: 'run', tps: state.tps } : { cmd: 'pause' });
  if (!reply) return;
  absorb(reply);
  // A running world is about to move on its own; a pending undo would toggle a
  // cell against a state the person never saw.
  if (running) clearUndo();
  updateControls();
  // While the stream is up the service pushes every tick, so there is nothing
  // to poll for; the timer exists only for the fallback path.
  if (state.running && !state.streamConnected) startPolling();
  else stopPolling();
  if (!state.running) await afterChange();
}

async function stepOnce() {
  if (state.running) return;
  const reply = await callCore({ cmd: 'step', count: 1 });
  if (!reply) return;
  absorb(reply);
  clearUndo();
  await afterChange();
  if (state.history) await refreshHistory();
}

async function clearWorld() {
  const reply = await callCore({ cmd: 'clear' });
  if (!reply) return;
  absorb(reply);
  state.generation = 0;
  state.population = 0;
  clearUndo();
  await afterChange();
}

/**
 * The cell edits the undo control can reverse, newest last.
 *
 * Undo is not a rollback: it only reverses **cell edits this page made**, and it
 * is cleared the moment something else moves the world — a step, a run, a clear,
 * a placed pattern, a selection, a rollback or a change of generation. Keeping a
 * stale edit would toggle a cell against a world it was never measured in, which
 * is why the stack is emptied rather than guessed at. A toggle is its own
 * inverse, so the entry is the coordinate and nothing else.
 */
let undoStack = [];
let undoInFlight = false;
/** The generation the stack was built against, to notice an outside move. */
let undoGeneration = null;

function updateUndoControl() {
  if (dom.undoEdit) dom.undoEdit.disabled = undoStack.length === 0 || undoInFlight;
}

function clearUndo() {
  undoStack = [];
  undoGeneration = state.generation;
  updateUndoControl();
}

function noteEdit(x, y) {
  undoStack.push([x, y]);
  if (undoStack.length > 64) undoStack.shift();
  undoGeneration = state.generation;
  updateUndoControl();
}

/** Reverse the most recent cell edit, if the world has not moved since. */
async function undoLastEdit() {
  if (undoStack.length === 0 || undoInFlight) return;
  if (undoGeneration !== state.generation) {
    clearUndo();
    return;
  }
  const [x, y] = undoStack[undoStack.length - 1];
  undoInFlight = true;
  updateUndoControl();
  try {
    const reply = await callCore({ cmd: 'toggle', x, y });
    if (!reply) return;
    undoStack.pop();
    absorb(reply);
    await afterChange();
  } finally {
    undoInFlight = false;
    updateUndoControl();
  }
}

async function toggleAt(clientX, clientY) {
  const target = screenToWorld(clientX, clientY, state.lastFrame);
  if (target === null) return;
  const { x, y } = target;
  if (x < 0 || y < 0 || x >= state.world.width || y >= state.world.height) return;
  const reply = await callCore({ cmd: 'toggle', x, y });
  if (!reply) return;
  absorb(reply);
  noteEdit(x, y);
  await afterChange();
}

// -- the editing mode -----------------------------------------------------

const SNIPPET_DRAFT_KEY = 'lifegame.viewer.snippet-draft';
let editTxCounter = 0;

function setEditStatus(text) {
  if (dom.editStatus) dom.editStatus.textContent = text;
}

/** Apply the version/hash facts the service reported to the page. */
function applyEditState(view) {
  if (!state.edit) return;
  if (typeof view.version === 'number') state.edit.version = view.version;
  if (typeof view.hash === 'string') state.edit.hash = view.hash;
  if (typeof view.undoDepth === 'number') state.edit.undoDepth = view.undoDepth;
  if (typeof view.redoDepth === 'number') state.edit.redoDepth = view.redoDepth;
  updateEditControls();
}

/** Show or hide the edit surface and freeze the controls it replaces. */
function applyEditModeUi() {
  const active = state.edit.active;
  dom.editControls.hidden = !active;
  dom.editMode.textContent = t(active ? 'action.editModeDone' : 'action.editMode');
  dom.editMode.title = t('label.editModeTitle');
  dom.toggleRun.disabled = active;
  dom.stepOnce.disabled = active || state.running;
  dom.clearWorld.disabled = active;
  if (dom.representation) dom.representation.disabled = active;
  dom.undoEdit.disabled = true;
  setEditStatus(active ? t('status.editActive') : '');
  updateEditControls();
  updatePresenceRoster();
}

function updateEditControls() {
  if (!state.edit || !dom.editUndo) return;
  dom.editUndo.disabled = !state.edit.active || state.edit.undoDepth === 0;
  dom.editRedo.disabled = !state.edit.active || state.edit.redoDepth === 0;
  dom.snippetSave.disabled = !state.edit.active || state.edit.selection === null;
  dom.snippetPublish.disabled =
    !state.edit.active || state.edit.draft === null || dom.snippetName.value.trim() === '';
}

async function editRequest(path, body = {}) {
  try {
    const response = await fetch(apiUrl(path), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const reply = await readJson(response);
    if (!response.ok || reply.ok === false) {
      await handleEditRefusal(reply);
      return null;
    }
    return reply;
  } catch (error) {
    showError(t('error.editFailed', { message: error.message }));
    return null;
  }
}

/** A refused transaction is visible, and a stale base moves the page forward. */
async function handleEditRefusal(reply) {
  const code = reply?.error ?? 'internal';
  if (code === 'stale_base' || code === 'stale_generation' || code === 'duplicate_tx') {
    await resyncEdit();
  }
  showCodeError(code, reply?.message ?? '');
}

/** Ask the service for the document's version after a refusal. */
async function resyncEdit() {
  try {
    const response = await fetch(apiUrl('/api/edit/state'));
    const reply = await readJson(response);
    if (response.ok && reply.ok !== false && reply.editMode) {
      applyEditState(reply);
      setEditStatus(t('status.editResynced'));
    }
  } catch {
    // A failed resync is reported by the next action; the page is not blanked.
  }
}

async function toggleEditMode() {
  if (!state.edit || state.edit.busy) return;
  state.edit.busy = true;
  try {
    if (state.edit.active) {
      sendPresence({ leaving: true }, true);
      const reply = await editRequest('/api/edit/leave', {});
      if (!reply) return;
      state.edit.active = false;
      state.edit.selection = null;
      state.edit.gesture = null;
      state.edit.presence = new Map();
      updatePresenceRoster();
      setEditStatus('');
      applyEditModeUi();
      await afterChange();
      return;
    }
    const reply = await editRequest('/api/edit/enter', {});
    if (!reply) return;
    state.edit.active = reply.editMode === true;
    if (state.edit.active) {
      const random = Math.random().toString(36).slice(2, 10);
      state.edit.author = state.edit.author ?? `page-${random}`;
      applyEditState(reply);
      await loadSnippetPalette();
      sendPresence({}, true);
    }
    applyEditModeUi();
    await afterChange();
  } finally {
    state.edit.busy = false;
  }
}

/** Commit one transaction; a gesture is one transaction, never one per cell. */
async function commitEdit(ops) {
  if (!state.edit?.active || ops.length === 0) return false;
  editTxCounter += 1;
  const txId = `tx-${Date.now()}-${editTxCounter}`;
  const reply = await editRequest('/api/edit/transaction', {
    txId,
    baseVersion: state.edit.version,
    baseHash: state.edit.hash,
    author: state.edit.author,
    ops,
  });
  if (!reply) return false;
  applyEditState({ ...reply, undoDepth: (state.edit.undoDepth ?? 0) + 1, redoDepth: 0 });
  clearError();
  await afterChange();
  return true;
}

async function editUndo() {
  if (!state.edit?.active || state.edit.undoDepth === 0) return;
  const reply = await editRequest('/api/edit/undo', { author: state.edit.author });
  if (!reply) return;
  applyEditState({
    ...reply,
    undoDepth: Math.max(0, (state.edit.undoDepth ?? 1) - 1),
    redoDepth: (state.edit.redoDepth ?? 0) + 1,
  });
  await afterChange();
}

async function editRedo() {
  if (!state.edit?.active || state.edit.redoDepth === 0) return;
  const reply = await editRequest('/api/edit/redo', { author: state.edit.author });
  if (!reply) return;
  applyEditState({
    ...reply,
    undoDepth: (state.edit.undoDepth ?? 0) + 1,
    redoDepth: Math.max(0, (state.edit.redoDepth ?? 1) - 1),
  });
  await afterChange();
}

/** The live cells of a frame, in absolute world coordinates. */
function frameCells(frame) {
  if (frame.format === 'bits') {
    const cells = [];
    forEachLiveBit(frame.data, frame.w, frame.h, (x, y) => cells.push([frame.x0 + x, frame.y0 + y]));
    return cells;
  }
  return decodeCells(frame.data);
}

async function saveSelection() {
  const selection = state.edit.selection;
  if (!selection) return;
  const query = new URLSearchParams({
    x0: String(selection.x),
    y0: String(selection.y),
    w: String(selection.w),
    h: String(selection.h),
  });
  try {
    const response = await fetch(apiUrl(`/api/frame?${query}`));
    const reply = await readJson(response);
    if (!response.ok || reply.ok === false) {
      showCodeError(reply.error ?? 'internal', reply.message ?? `HTTP ${response.status}`);
      return;
    }
    const cells = frameCells(reply.frame)
      .map(([x, y]) => [x - selection.x, y - selection.y])
      .filter(([x, y]) => x >= 0 && y >= 0 && x < selection.w && y < selection.h);
    state.edit.draft = { width: selection.w, height: selection.h, cells };
    writeStored(SNIPPET_DRAFT_KEY, JSON.stringify(state.edit.draft), safeStorage());
    setEditStatus(t('status.snippetSaved'));
    updateEditControls();
  } catch (error) {
    showError(t('error.editFailed', { message: error.message }));
  }
}

async function publishDraft() {
  const draft = state.edit.draft;
  const name = dom.snippetName.value.trim();
  if (!draft || name === '') return;
  try {
    const response = await fetch(apiUrl('/api/snippets'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, width: draft.width, height: draft.height, cells: draft.cells }),
    });
    const reply = await readJson(response);
    if (!response.ok || reply.ok === false) {
      showCodeError(reply.error ?? 'internal', reply.message ?? `HTTP ${response.status}`);
      return;
    }
    setEditStatus(t('status.snippetPublished'));
    await loadSnippetPalette(reply.snippet.name);
  } catch (error) {
    showError(t('error.editFailed', { message: error.message }));
  }
}

async function loadSnippetPalette(selectName = null) {
  try {
    const response = await fetch(apiUrl('/api/snippets'));
    const reply = await readJson(response);
    if (!response.ok || reply.ok === false) return;
    const names = (reply.snippets ?? []).map((entry) => entry.name);
    fillOptions(dom.snippetPalette, names, (name) => name);
    if (selectName && names.includes(selectName)) dom.snippetPalette.value = selectName;
    else if (dom.snippetPalette.value === '' && names.length > 0) dom.snippetPalette.value = names[0];
    if (dom.snippetPalette.value !== '') await loadPaletteSnippet(dom.snippetPalette.value);
  } catch {
    // A palette that cannot be read is empty; the mode still works without it.
  }
}

async function loadPaletteSnippet(name) {
  if (!name) {
    state.edit.palette = null;
    return;
  }
  try {
    const response = await fetch(apiUrl(`/api/snippets/${encodeURIComponent(name)}`));
    const reply = await readJson(response);
    if (!response.ok || reply.ok === false) {
      state.edit.palette = null;
      return;
    }
    state.edit.palette = reply.snippet;
  } catch {
    state.edit.palette = null;
  }
}

function startEditGesture(event) {
  // The control is the current tool; the state field is only a mirror for code
  // that cannot read the DOM. Reading the select here keeps a test's direct
  // value change and a person's change on the same path.
  const tool = dom.editTool?.value || state.edit?.tool;
  if (!state.edit?.active || tool === 'pan') return false;
  state.edit.tool = tool;
  const cell = screenToWorld(event.clientX, event.clientY, state.lastFrame);
  if (cell === null) return true;
  event.preventDefault();
  dom.canvas.setPointerCapture(event.pointerId);
  state.edit.gesture = {
    pointerId: event.pointerId,
    tool,
    start: [cell.x, cell.y],
    last: [cell.x, cell.y],
    cells: tool === 'paint' || tool === 'erase' ? [[cell.x, cell.y]] : [],
  };
  repaint();
  return true;
}

function moveEditGesture(event) {
  const gesture = state.edit?.gesture;
  if (!gesture || gesture.pointerId !== event.pointerId) return false;
  const cell = screenToWorld(event.clientX, event.clientY, state.lastFrame);
  if (cell === null) return true;
  if (gesture.tool === 'paint' || gesture.tool === 'erase') {
    const segment = lineCells(gesture.last, [cell.x, cell.y]);
    gesture.cells = gesture.cells.concat(newCells(gesture.cells, segment));
  }
  gesture.last = [cell.x, cell.y];
  repaint();
  return true;
}

function endEditGesture(event) {
  const gesture = state.edit?.gesture;
  if (!gesture || gesture.pointerId !== event.pointerId) return false;
  state.edit.gesture = null;
  if (dom.canvas.hasPointerCapture?.(event.pointerId)) {
    dom.canvas.releasePointerCapture(event.pointerId);
  }
  const cell = screenToWorld(event.clientX, event.clientY, state.lastFrame) ?? {
    x: gesture.last[0],
    y: gesture.last[1],
  };
  const inside = ([x, y]) => x >= 0 && y >= 0 && x < state.world.width && y < state.world.height;
  if (gesture.tool === 'paint' || gesture.tool === 'erase') {
    const cells = gesture.cells.filter(inside);
    void commitEdit(cells.length > 0 ? [{ kind: 'set', alive: gesture.tool === 'paint', cells }] : []);
  } else if (gesture.tool === 'line' || gesture.tool === 'rect') {
    const raw =
      gesture.tool === 'line'
        ? lineCells(gesture.start, [cell.x, cell.y])
        : rectCells(gesture.start, [cell.x, cell.y]);
    const cells = raw.filter(inside);
    void commitEdit(cells.length > 0 ? [{ kind: 'set', alive: true, cells }] : []);
  } else if (gesture.tool === 'select') {
    const box = boxOf(gesture.start, [cell.x, cell.y]);
    const x = Math.max(0, box.x);
    const y = Math.max(0, box.y);
    const right = Math.min(state.world.width, box.x + box.w);
    const bottom = Math.min(state.world.height, box.y + box.h);
    state.edit.selection = right > x && bottom > y ? { x, y, w: right - x, h: bottom - y } : null;
    updateEditControls();
    setEditStatus(
      state.edit.selection
        ? `${state.edit.selection.x}, ${state.edit.selection.y} · ${state.edit.selection.w} × ${state.edit.selection.h}`
        : '',
    );
  } else if (gesture.tool === 'stamp') {
    if (!state.edit.palette) {
      showError(t('error.editFailed', { message: t('label.snippet') }));
      return true;
    }
    const operation = stampOperation({
      snippet: state.edit.palette,
      x: gesture.start[0],
      y: gesture.start[1],
      transform: dom.snippetTransform.value,
      mode: dom.snippetMode.value,
    });
    if (!boxFits(operation.box, state.world) || operation.box.w > 256 || operation.box.h > 256) {
      showCodeError('too_large', `the snippet does not fit at ${gesture.start[0]},${gesture.start[1]}`);
      return true;
    }
    void commitEdit([operation]);
  }
  repaint();
  return true;
}

/** Draw the selection and the gesture in progress over the frame. */
function drawEditOverlay() {
  if (!state.edit?.active || !state.lastFrame) return;
  const { cssWidth } = canvasSize();
  const span = state.viewport.span;
  if (!(span > 0)) return;
  const perCell = cssWidth / span;
  const screenBox = (box) => ({
    x: (box.x - state.viewport.x0) * perCell,
    y: (box.y - state.viewport.y0) * perCell,
    w: box.w * perCell,
    h: box.h * perCell,
  });
  // The outline is four line segments rather than `strokeRect`, because the frame
  // drawing already needs a path API and a context with one less method is a
  // canvas the synthetic browser can record.
  const outline = (box) => {
    canvas2d.beginPath();
    canvas2d.moveTo(box.x, box.y);
    canvas2d.lineTo(box.x + box.w, box.y);
    canvas2d.lineTo(box.x + box.w, box.y + box.h);
    canvas2d.lineTo(box.x, box.y + box.h);
    canvas2d.lineTo(box.x, box.y);
    canvas2d.stroke();
  };
  canvas2d.strokeStyle = '#3f8cff';
  canvas2d.lineWidth = 2;
  if (state.edit.selection) outline(screenBox(state.edit.selection));
  const gesture = state.edit.gesture;
  if (gesture) {
    if (gesture.tool === 'rect' || gesture.tool === 'select') {
      outline(screenBox(boxOf(gesture.start, gesture.last)));
    } else if (gesture.tool === 'line') {
      const start = screenBox({ x: gesture.start[0], y: gesture.start[1], w: 1, h: 1 });
      const end = screenBox({ x: gesture.last[0], y: gesture.last[1], w: 1, h: 1 });
      canvas2d.beginPath();
      canvas2d.moveTo(start.x + perCell / 2, start.y + perCell / 2);
      canvas2d.lineTo(end.x + perCell / 2, end.y + perCell / 2);
      canvas2d.stroke();
    }
  }
  // Collaborators: their selection and their cursor, each in a colour of its own.
  const colours = ['#ff6b6b', '#6ee7a8', '#f6c85f', '#c792ea', '#7fd4ff'];
  const now = Date.now();
  let index = 0;
  for (const entry of state.edit.presence?.values() ?? []) {
    if (now - (entry.at ?? 0) > 30000) continue;
    const colour = colours[index % colours.length];
    index += 1;
    if (entry.selection) {
      canvas2d.strokeStyle = colour;
      canvas2d.lineWidth = 1;
      outline(screenBox(entry.selection));
    }
    if (Array.isArray(entry.cursor)) {
      const cx = (entry.cursor[0] - state.viewport.x0) * perCell;
      const cy = (entry.cursor[1] - state.viewport.y0) * perCell;
      canvas2d.strokeStyle = colour;
      canvas2d.lineWidth = 1;
      canvas2d.beginPath();
      canvas2d.moveTo(cx - 5, cy);
      canvas2d.lineTo(cx + 5, cy);
      canvas2d.moveTo(cx, cy - 5);
      canvas2d.lineTo(cx, cy + 5);
      canvas2d.stroke();
      if (typeof canvas2d.fillText === 'function' && typeof entry.author === 'string') {
        canvas2d.fillStyle = colour;
        canvas2d.fillText(entry.author, cx + 7, cy - 7);
      }
    }
  }
}

// -- collaboration ---------------------------------------------------------

/** Send this client's presence, coalescing bursts to a rate the service carries. */
let presenceSentAt = 0;
let presencePending = null;
let presenceTimer = null;

function presencePayload(extra) {
  return {
    clientId: state.clientId,
    author: state.edit.author ?? undefined,
    cursor: state.edit.cursor ?? null,
    view: {
      x0: Math.round(state.viewport.x0),
      y0: Math.round(state.viewport.y0),
      span: state.viewport.span,
    },
    selection: state.edit.selection,
    ...extra,
  };
}

function deliverPresence(payload) {
  presenceSentAt = Date.now();
  void fetch(apiUrl('/api/edit/presence'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {
    // Presence is ambient: a failed report must not interrupt editing.
  });
}

function sendPresence(extra = {}, force = false) {
  if (!state.edit?.active || state.clientId === undefined || state.clientId === null) return;
  const payload = presencePayload(extra);
  const now = Date.now();
  if (!force && now - presenceSentAt < 120) {
    presencePending = payload;
    if (presenceTimer === null) {
      presenceTimer = setTimeout(() => {
        presenceTimer = null;
        const pending = presencePending;
        presencePending = null;
        if (pending !== null) deliverPresence(pending);
      }, 120);
    }
    return;
  }
  deliverPresence(payload);
}

function updatePresenceRoster() {
  if (!dom.editPresence) return;
  const now = Date.now();
  const authors = [];
  for (const entry of state.edit?.presence?.values() ?? []) {
    if (now - (entry.at ?? 0) > 30000) continue;
    if (typeof entry.author === 'string' && entry.author !== '') authors.push(entry.author);
  }
  dom.editPresence.textContent =
    authors.length > 0 ? t('status.editPresence', { authors: authors.join(', ') }) : '';
  dom.editPresence.hidden = authors.length === 0;
}

/** A transaction another client committed: follow it or resynchronise. */
function onRemotePatch(payload) {
  if (!state.edit?.active || payload === null || payload === undefined) return;
  if (payload.sessionId !== state.sessionId) return;
  if (payload.author === state.edit.author) return;
  const current = state.edit.version ?? 0;
  if (payload.version === current + 1) {
    state.edit.version = payload.version;
    state.edit.hash = payload.hash;
    // The global undo stack moved; follow it without another request. A commit
    // adds one undoable entry, an undo trades one for a redo, and a redo trades
    // it back.
    if (payload.kind === 'undo') {
      state.edit.undoDepth = Math.max(0, (state.edit.undoDepth ?? 0) - 1);
      state.edit.redoDepth = (state.edit.redoDepth ?? 0) + 1;
    } else if (payload.kind === 'redo') {
      state.edit.undoDepth = (state.edit.undoDepth ?? 0) + 1;
      state.edit.redoDepth = Math.max(0, (state.edit.redoDepth ?? 0) - 1);
    } else {
      state.edit.undoDepth = (state.edit.undoDepth ?? 0) + 1;
      state.edit.redoDepth = 0;
    }
    updateEditControls();
    setEditStatus(t('status.editRemote', { author: payload.author ?? t('value.none') }));
    void refreshFrame();
    void afterChange();
  } else if (payload.version > current + 1) {
    void resyncEdit();
  }
}

/** A collaborator's cursor, selection or view point. */
function onRemotePresence(payload) {
  if (payload === null || payload === undefined || !state.edit) return;
  if (payload.clientId === state.clientId) return;
  if (!(state.edit.presence instanceof Map)) state.edit.presence = new Map();
  if (payload.leaving === true) state.edit.presence.delete(payload.clientId);
  else state.edit.presence.set(payload.clientId, { ...payload, at: Date.now() });
  updatePresenceRoster();
  repaint();
}

async function refreshEditMode() {
  try {
    const response = await fetch(apiUrl('/api/edit'));
    const reply = await readJson(response);
    if (!response.ok || reply.ok === false) return;
    state.edit.active = reply.editMode === true;
    if (state.edit.active) applyEditState(reply);
    applyEditModeUi();
  } catch {
    // A service that cannot answer leaves the mode off; the control works.
  }
}

// -- readouts and controls ------------------------------------------------

function updateReadout() {
  const { cssWidth } = canvasSize();
  const perCell = state.viewport.span > 0 ? cssWidth / state.viewport.span : 0;
  dom.generation.textContent = String(state.generation);
  dom.population.textContent = String(state.population);
  dom.origin.textContent = `${Math.round(state.viewport.x0)}, ${Math.round(state.viewport.y0)}`;
  dom.span.textContent =
    state.viewport.span <= 0
      ? t('value.none')
      : state.zoomLimited
        ? t('unit.spanLimited', { span: Math.round(state.viewport.span) })
        : String(Math.round(state.viewport.span));
  dom.rule.textContent = state.rule === '' ? t('value.none') : state.rule;
  dom.world.textContent =
    state.world === null ? t('value.none') : `${state.world.width} × ${state.world.height}`;
  dom.cell.textContent =
    perCell <= 0
      ? t('value.none')
      : perCell >= 1
        ? t('unit.px', { value: perCell.toFixed(2) })
        : t('unit.cellsPerPx', { value: (1 / perCell).toFixed(1) });
  // The editor is re-stated here rather than at each reply that can change the
  // rule: every reply that updates a readout goes through this function, so the
  // select and the readout cannot describe two different rules.
  updateRuleControl();
}

function updateControls() {
  dom.toggleRun.textContent = state.running ? t('action.pause') : t('action.run');
  dom.stepOnce.disabled = state.running || state.edit?.active === true;
  updateUndoControl();
  updateEditControls();
  if (dom.tps.disabled !== true) {
    dom.tps.value = String(state.tps);
    dom.tpsValue.textContent = String(state.tps);
  }
}

/**
 * Take the bounds and the vocabulary the core declared.
 *
 * Called from `state` and from the stream's `hello`. The rate control and the
 * representation list are built from here and from nowhere else: a copy in this
 * file would be the copy that drifts, and a page that offers a rate the core
 * refuses is a page that lies.
 */
function applyLimits(limits) {
  const bounds = limits.ticksPerSecond;
  if (bounds === null) {
    dom.tps.disabled = true;
    dom.tps.removeAttribute('min');
    dom.tps.removeAttribute('max');
    dom.tpsValue.textContent = t('value.none');
  } else {
    dom.tps.disabled = false;
    dom.tps.min = String(bounds.min);
    dom.tps.max = String(bounds.max);
    state.tps = clampTicksPerSecond(state.tps, limits);
    dom.tps.value = String(state.tps);
    dom.tpsValue.textContent = String(state.tps);
  }
  const offered = limits.representations;
  if (offered.length > 0) {
    fillOptions(dom.representation, offered, (value) => t(`representation.${value}`));
    if (state.representation === null) state.representation = offered[0];
    dom.representation.value = state.representation;
  }
}

// -- the shell's hooks ----------------------------------------------------

/** Everything this page owns that a language change has to rewrite. */
function retranslateOwn() {
  updateTranslatedTitles();
  updateOptionLabels();
  updateEditOptionLabels();
  updatePanelControls();
  if (dom.editMode) {
    dom.editMode.textContent = t(state.edit?.active ? 'action.editModeDone' : 'action.editMode');
    dom.editMode.title = t('label.editModeTitle');
  }
  updateEditControls();
  updatePresenceRoster();
  dom.hint.replaceChildren(...hintNodes());
  updateReadout();
  updateControls();
}

/** Label the editing selects from the vocabularies that own them. */
function updateEditOptionLabels() {
  if (!dom.editTool) return;
  fillOptions(dom.editTool, EDIT_TOOLS, (value) => t(`tool.${value}`));
  fillOptions(dom.snippetTransform, SNIPPET_TRANSFORMS, (value) => t(`transform.${value}`));
  fillOptions(dom.snippetMode, SNIPPET_MODES, (value) => t(`mode.${value}`));
}

/** The canvas reads its colours out of the stylesheet, so a theme change repaints. */
function onTheme() {
  readPaletteFromTheme();
  repaint();
}

function onHello() {
  updateRepresentationControl();
  updateControls();
  void publishViewport(true);
}

function onFrame(frame) {
  state.lastFrame = frame;
  try {
    render(frame);
  } catch (error) {
    // A frame that cannot be drawn must not blank the page: the previous one
    // stays and the reason is stated.
    showError(t('error.draw', { message: error.message }));
    return;
  }
  setCoreStatus('ok', statusOk());
  clearError();
  updateReadout();
}

/**
 * Centre the first view on the world, once there is a view to centre.
 *
 * Called on every state reply until it succeeds, because the page can be ready
 * before the shell has heard from the core at all. The rule itself lives in
 * `placeDefaultView`: the span is the canvas width over
 * `DEFAULT_PIXELS_PER_CELL`, and the origin puts the world's centre in the
 * middle of the view. After the user has touched the view it is theirs, and a
 * later state reply must not move it.
 */
function centreOnFirstState() {
  placeDefaultView();
}

function onState(reply) {
  // A reply that carries an error has nothing to place or to draw; the controls
  // and the readouts still reflect what is known.
  if (reply !== null && reply !== undefined && reply.ok === false) {
    updateReadout();
    updateControls();
    return;
  }
  // A generation that moved without this page's own toggle (a step, a run, a
  // selection, a rollback) invalidates an undo entry measured against the old
  // state.
  if (undoGeneration !== null && state.generation !== undoGeneration) clearUndo();
  centreOnFirstState();
  updateReadout();
  updateControls();
  // The first frame is asked for here as well as at start-up: the page can be
  // ready before the shell has a world, and this is what arrives when it does.
  if (state.lastFrame === null) void refreshFrame();
}

// -- events ---------------------------------------------------------------

// The page's own elements, bound now: this module runs after the document is
// parsed, and everything below wires listeners onto them. The fields bound here
// are the ones the missing-container check reports on; the shell's own join them
// when the context arrives.
bindOwnDom();
const ownKeys = Object.keys(dom);

dom.toggleRun.addEventListener('click', () => void setRunning(!state.running));
dom.stepOnce.addEventListener('click', () => void stepOnce());
dom.clearWorld.addEventListener('click', () => void clearWorld());
dom.undoEdit.addEventListener('click', () => void undoLastEdit());
dom.editMode.addEventListener('click', () => void toggleEditMode());
dom.editUndo.addEventListener('click', () => void editUndo());
dom.editRedo.addEventListener('click', () => void editRedo());
dom.snippetSave.addEventListener('click', () => void saveSelection());
dom.snippetPublish.addEventListener('click', () => void publishDraft());
dom.snippetName.addEventListener('input', () => updateEditControls());
dom.snippetPalette.addEventListener('change', () => void loadPaletteSnippet(dom.snippetPalette.value));

dom.gridWidth.addEventListener('change', () => {
  state.gridWidth = clampGridWidth(dom.gridWidth.value);
  dom.gridWidth.value = String(state.gridWidth);
  writeStored(GRID_WIDTH_STORAGE_KEY, String(state.gridWidth), safeStorage());
  repaint();
});

dom.representation.addEventListener('change', () => {
  void switchRepresentation(dom.representation.value);
});

// The preset list: choosing an entry sends it at once, so nothing has to be
// confirmed. The entry that means "the rule in force is not one of these" is a
// label rather than a rule, and `choosePreset` treats it as one.
dom.rulePreset.addEventListener('change', () => {
  void choosePreset(dom.rulePreset.value);
});

// The text field: Enter and the button are the same submission, so the two
// halves of "you have said what you want" cannot drift apart. Enter is caught
// here rather than on the window because the page's key handler ignores events
// that come from a field, and rightly so — Space and the arrow keys are text
// editing inside one, not transport control.
dom.ruleApply.addEventListener('click', () => {
  void submitRule(dom.ruleCustom.value);
});

dom.ruleCustom.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  void submitRule(dom.ruleCustom.value);
});

dom.patternPlace.addEventListener('click', () => {
  void placePattern();
});

dom.panelHandle.addEventListener('click', () => applyPanel(toggleCollapsed(state.panel), true));
dom.panelWide.addEventListener('click', () => applyPanel(toggleWide(state.panel), true));

dom.tps.addEventListener('input', () => {
  const tps = clampTicksPerSecond(dom.tps.value, state.limits);
  if (tps === null) return;
  dom.tpsValue.textContent = String(tps);
  state.tps = tps;
  if (state.running) {
    void callCore({ cmd: 'run', tps }).then((reply) => {
      if (reply) {
        absorb(reply);
        startPolling();
      }
    });
  }
});

// -- gestures -------------------------------------------------------------

/**
 * Start a gesture from whatever contacts are currently down.
 *
 * Called on every contact change rather than only on the first press, because
 * the gesture itself changes when a finger arrives or leaves: one contact pans
 * and can edit a cell, two of them pinch. Re-baselining here is what stops the
 * view jumping when the second finger lands or the first one lifts.
 */
function beginGesture() {
  const points = [...state.pointers.values()];
  const gesture = state.gesture;
  dom.canvas.classList.remove('dragging');
  if (points.length === 0) {
    state.gesture = null;
  } else if (points.length === 1) {
    // A drag that continues a pinch is already a camera gesture: it must pan
    // from the first pixel rather than waiting out the click threshold, and it
    // must never be read as a click when the last finger lifts. Without this,
    // ending a pinch with one finger still down toggles whatever cell that
    // finger happens to be over.
    const continued = gesture?.mode === 'pinch';
    state.gesture = {
      mode: 'drag',
      lastX: points[0].x,
      lastY: points[0].y,
      moved: continued ? Number.POSITIVE_INFINITY : 0,
    };
  } else {
    // Two or more contacts: a pinch, anchored on the point between them.
    //
    // The baseline is where the fingers *started*, together with the viewport at
    // that moment, and every move is computed from it rather than from the
    // previous move. Fingers report separately, so a two-finger drag arrives as
    // one finger moving and then the other; composing those intermediate samples
    // would zoom in and back out again on every pair of events, which is a
    // visible pump. One baseline has no intermediate states to compose.
    state.gesture = {
      mode: 'pinch',
      start: gestureSample(points),
      base: { x0: state.viewport.x0, y0: state.viewport.y0, span: state.viewport.span },
    };
  }
}

function moveGesture() {
  const gesture = state.gesture;
  if (gesture === null) return;
  const points = [...state.pointers.values()];

  if (gesture.mode === 'drag') {
    if (points.length !== 1) {
      beginGesture();
      return;
    }
    const deltaX = points[0].x - gesture.lastX;
    const deltaY = points[0].y - gesture.lastY;
    gesture.lastX = points[0].x;
    gesture.lastY = points[0].y;
    gesture.moved += Math.abs(deltaX) + Math.abs(deltaY);
    if (isClick(gesture.moved)) return;
    dom.canvas.classList.add('dragging');
    panByPixels(deltaX, deltaY);
    updateReadout();
    requestViewportUpdate();
    return;
  }

  if (points.length < 2) {
    beginGesture();
    return;
  }
  const after = gestureSample(points);
  if (after === null || gesture.start === null) return;
  const next = pinchToViewport({
    viewport: gesture.base,
    rect: dom.canvas.getBoundingClientRect(),
    cssWidth: canvasSize().cssWidth,
    before: gesture.start,
    after,
    minSpan: MIN_SPAN,
    spanLimit: maxSpan(),
  });
  state.viewport.span = next.span;
  state.viewport.x0 = next.x0;
  state.viewport.y0 = next.y0;
  clampViewport();
  noteUserMoved();
  updateReadout();
  requestViewportUpdate();
}

dom.canvas.addEventListener('pointerdown', (event) => {
  // A right or middle press is not an edit and not a pan. A touch or pen contact
  // reports button 0, including the second and third fingers of a pinch, so this
  // one check covers both input families.
  if (event.button !== 0) return;
  // The editing mode intercepts first: a drawing tool's pointer is an edit, not
  // a camera gesture. A pan tool falls through to the camera path below.
  if (startEditGesture(event)) return;
  dom.canvas.setPointerCapture(event.pointerId);
  state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  beginGesture();
});

dom.canvas.addEventListener('pointermove', (event) => {
  if (state.edit?.active) {
    // Presence is the cursor, the selection and the view point, throttled. A
    // pointer that never stops moving should not become one request per pixel;
    // `sendPresence` coalesces to the rate the service can carry.
    const target = screenToWorld(event.clientX, event.clientY, state.lastFrame);
    if (target !== null) {
      state.edit.cursor = [target.x, target.y];
      sendPresence({ cursor: state.edit.cursor });
    }
  }
  if (moveEditGesture(event)) return;
  if (!state.pointers.has(event.pointerId)) return;
  state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  moveGesture();
});

function endPointer(event) {
  if (endEditGesture(event)) return;
  const gesture = state.gesture;
  if (!state.pointers.has(event.pointerId)) return;
  state.pointers.delete(event.pointerId);
  if (dom.canvas.hasPointerCapture?.(event.pointerId)) {
    dom.canvas.releasePointerCapture(event.pointerId);
  }
  // A press that never travelled is a click, and a click toggles one cell. A
  // pinch never toggles anything, however still the fingers were: two contacts
  // are a camera gesture, not an edit. In the editing mode the toggle is the
  // transaction tools' job, never the camera's.
  if (
    state.edit?.active !== true &&
    state.pointers.size === 0 &&
    gesture?.mode === 'drag' &&
    isClick(gesture.moved)
  ) {
    void toggleAt(event.clientX, event.clientY);
  }
  if (state.edit?.active) sendPresence({}, true);
  beginGesture();
}

dom.canvas.addEventListener('pointerup', endPointer);
dom.canvas.addEventListener('pointercancel', (event) => {
  // The browser took the gesture away — a system gesture, a lost contact. Drop
  // it without editing anything, then re-baseline on what is left.
  state.pointers.delete(event.pointerId);
  if (state.edit?.gesture?.pointerId === event.pointerId) {
    state.edit.gesture = null;
    repaint();
  }
  beginGesture();
});

dom.canvas.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault();
    const factor = Math.exp(event.deltaY * 0.0015);
    zoomAt(event.clientX, event.clientY, factor);
    updateReadout();
    requestViewportUpdate();
  },
  { passive: false },
);

window.addEventListener('keydown', (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLButtonElement) return;
  if (event.code === 'Space') {
    event.preventDefault();
    void setRunning(!state.running);
  } else if ((event.ctrlKey || event.metaKey) && (event.key === 'z' || event.key === 'Z')) {
    // The standard undo gesture, and only for this page's own cell edits: the
    // field's own text undo is left alone because the early return above covers
    // an input target.
    event.preventDefault();
    void undoLastEdit();
  } else if (event.key === '.' || event.key === 'ArrowRight') {
    event.preventDefault();
    void stepOnce();
  } else if (event.key === 'h' || event.key === 'H') {
    // The panel keys are letters rather than the obvious 'p', because Space,
    // '.', and the arrows are already taken and a letter that does nothing on
    // this page is free.
    event.preventDefault();
    applyPanel(toggleCollapsed(state.panel), true);
  } else if (event.key === 'w' || event.key === 'W') {
    event.preventDefault();
    applyPanel(toggleWide(state.panel), true);
  }
});

window.addEventListener('resize', () => {
  onCanvasResized();
});

// -- start ----------------------------------------------------------------

/** True once the page has placed its first view; see `requestViewportUpdate`. */
let started = false;

function start() {
  const missing = missingContainers();
  if (missing.length > 0) {
    // Loud, not silent. A blank page with a passing test suite is what the first
    // attempt at this split produced, and it is the worst possible failure.
    showError(t('error.missingContainers', { names: missing.join(', ') }));
    return;
  }
  // The palette and the grid width first: they are read from storage and the
  // stylesheet, and they affect how the very first frame is drawn.
  readPaletteFromTheme();
  initialiseGridWidth();
  // The preset select before the first state reply is applied: a rule the core
  // reported at handshake has to have a place to be shown, and the entry that
  // means "not one of these" is built here.
  initialiseRuleEditor();
  // The pattern list is data from the service, so it is read rather than
  // written here. It does not block the first frame: the control stays disabled
  // until the list lands, which is visible and harmless.
  void loadPatterns();
  // The limits the core declared. The shell may have heard from the core before
  // this page was ready — it publishes its context and then asks — so this is
  // also the catch-up for a `limits` event that went out to nobody. Applying
  // them twice is harmless: the second application is the same numbers.
  applyLimits(state.limits);
  // The panel before the first frame: its width is part of the canvas size, and
  // a frame requested at the wrong size would be redrawn immediately.
  initialisePanel();
  watchCanvasSize();
  retranslateOwn();
  // A `?focus=x,y` link shares a view point with this session. Storing it here
  // is what makes the sharing survive the link: the history preview reads the
  // session's entry, not the URL.
  const sharedFocus = focusFromLocation();
  if (sharedFocus !== null) writeFocus(safeStorage(), sharedFocus, state.sessionId);
  // The view may already be placeable — the shell may have finished its first
  // state reply before this page was ready — in which case this centres it and
  // asks for the first frame. Otherwise the `state` hook does both.
  onState(null);
  started = true;
}

connectShell(fill, start);
