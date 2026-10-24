/**
 * lifegame viewer — the history route: the recorded tree and the preview.
 *
 * The core hands back one node per recorded generation, each naming its parent,
 * and that is what this page draws. It is two panes rather than one column,
 * because a node is a *place in the world* and the only way to know which place
 * is to look at it:
 *
 * - **The left pane is the tree.** A row is one node, one line tall: the
 *   generation, the branch it belongs to, the marks that say whether it is the
 *   working point, and a connector per level so the parent-child relation is
 *   visible and two children of one fork are told apart. The node's own numbers
 *   — storage kind, population, change count, time — live in an overlay that is
 *   opened by the pointer or the keyboard and that is *out of the flow*, so
 *   opening it cannot change a row's height or push the rows below it down.
 *   Indentation is fork depth, decided by `history.mjs` and handed to the
 *   stylesheet as `--depth`; the guides are that module's arithmetic too.
 * - **The tree is draggable.** Dragging the list pans the tree — the surface a
 *   person reaching for a long run uses before they think about scrolling — and
 *   a drag that travelled is not a click, so panning never changes the
 *   selection. It is wired through Pointer Events, with `touch-action: none` on
 *   the list so a touch drag cannot be stolen by the page's own scrolling.
 * - **The right pane is a preview of the generation the world is on.** At load
 *   that is the current generation: with a measured canvas and a recording, the
 *   pane shows it without waiting to be asked, because the page's subject is the
 *   recording and this is the generation the person is working on. Clicking a
 *   node moves the working point onto it (`select`, not `rollback`: the reason a
 *   person clicks a generation is to work on from it) and previews that one.
 *   Either way the generation is shown centred on **the live cell nearest to
 *   where the world page was last looking**, read once per placement through
 *   `GET /api/cells`. Nothing is scanned per frame. A live set too large to send
 *   degrades to the centre of the core's `bounds`, and the note beside the canvas
 *   says so.
 * - **The automatic preview is not a selection.** It changes what is drawn and
 *   nothing else: the working point stays where the core put it, because looking
 *   at the current generation is not a decision to work on from it, and recording
 *   one as the other would branch the recording on the next edit. So the
 *   load-time preview sends no `select`.
 * - **The page states a rule difference and never acts on one.** A node carries
 *   the rule that produced it, and a session's rule can change part-way through,
 *   so the generation a person selects may have been produced by a rule the world
 *   is no longer running — and `select` restores cells and not the rule. The page
 *   says which two rules are involved and offers one press that adopts the
 *   generation's own; that press is the **only** thing on this route that sends
 *   `set_rule`. Choosing a node, the two step controls, the automatic preview and
 *   dragging the tree all leave the rule in force exactly as they found it.
 *
 * The preview's own view is a canvas: the default span is its width over the
 * same number of pixels per cell the world route uses (`viewport.mjs` owns that
 * rule), it can be panned and zoomed without touching the selection, and while
 * the user has not moved it, a resize re-derives its span.
 *
 * The tree is windowed: a long run records a generation per tick, so the newest
 * `TIMELINE_WINDOW` rows are shown with a control that widens the window by
 * another page each time it is pressed.
 */

import { DEFAULT_PALETTE, drawFrame, paintGround, readPalette } from '../frame-draw.mjs';
import { focusFromLocation, readFocus } from '../focus.mjs';
import {
  flattenHistory,
  formatHistoryTime,
  indentLevel,
  nodeById,
  previewFocus,
  ruleGap,
} from '../history.mjs';
import { connectShell } from '../link.mjs';
import { reportedRule } from '../rule.mjs';
import { GRID_WIDTH_STORAGE_KEY, clampGridWidth, readStored } from '../theme.mjs';
import {
  DRAG_THRESHOLD_PX,
  MIN_SPAN,
  centreViewport as centreAt,
  clampViewport as clampViewportTo,
  defaultSpan,
  frameRequest as computeFrameRequest,
  maxSpan as computeMaxSpan,
  panByPixels as translateViewport,
  zoomAt as rescaleAt,
} from '../viewport.mjs';
import { decodeCells } from '../decode.mjs';

/**
 * How many rows are in the document at once.
 *
 * Rendering a thousand of them would put a thousand rows in the layout for every
 * tick; the newest window is shown instead, and this control widens it.
 */
const TIMELINE_WINDOW = 40;

// -- the shared context, filled by the shell ------------------------------

let state = null;
const dom = {};
let t = (key) => key;
let describeError = () => '';
let readJson = async () => ({ ok: false, error: 'bad_reply', message: 'no shell' });
let callCore = async () => null;
let apiUrl = (path) => path;
let absorb = (payload) => payload;
let afterChange = () => Promise.resolve();
let showError = () => {};
let clearError = () => {};
let safeStorage = () => null;

function fill(context) {
  state = context.state;
  // The shared containers join this page's own, which are bound at module scope
  // below because a module script runs after the document is parsed and the
  // event wiring needs them then, whichever order the shell loads in.
  Object.assign(dom, context.dom);
  t = context.t;
  describeError = context.describeError;
  readJson = context.readJson;
  callCore = context.callCore;
  apiUrl = context.apiUrl;
  absorb = context.absorb;
  afterChange = context.afterChange;
  showError = context.showError;
  clearError = context.clearError;
  safeStorage = context.safeStorage;
  registerHooks(context.on);
}

/**
 * The elements this page reads. Literal `getElementById` calls, because the
 * contract test reads this list out of the file as text and asserts the history
 * fragment declares every id in it — including `#timeline`, the container whose
 * loss drew nothing at all in a browser while the suite stayed green.
 */
function bindOwnDom() {
  dom.timeline = document.getElementById('timeline');
  dom.timelineNote = document.getElementById('timeline-note');
  dom.timelineList = document.getElementById('timeline-list');
  dom.stepBack = document.getElementById('step-back');
  dom.stepForward = document.getElementById('step-forward');
  dom.preview = document.getElementById('preview');
  dom.previewArea = document.getElementById('preview-area');
  dom.previewNote = document.getElementById('preview-note');
  // The statement about the selected generation's rule, and the one press that
  // adopts it; see `updateRuleGap` and `adoptGenerationRule`.
  dom.ruleGap = document.getElementById('rule-gap');
  dom.ruleGapNote = document.getElementById('rule-gap-note');
  dom.ruleGapAdopt = document.getElementById('rule-gap-adopt');
  dom.ruleGapError = document.getElementById('rule-gap-error');
  // The footer's hint line is shared; this route is the one whose interaction
  // it describes, so this page fills it. The world route fills it with its own.
  dom.hint = document.getElementById('hint');
  if (dom.preview !== null) preview2d = dom.preview.getContext('2d', { alpha: false });
}

let hooksRegistered = false;
function registerHooks(on) {
  if (hooksRegistered) return;
  hooksRegistered = true;
  on('retranslate', retranslateOwn);
  on('theme', onTheme);
  // The rule in force arrives with the state reply and can change under this page
  // only when somebody presses the button below, so the statement is re-decided
  // whenever a rule arrives rather than only when the tree does.
  on('state', updateRuleGap);
  // The shell announces the moments; this page decides what to read. A tick
  // changes both the recording and the generation the preview is showing, so
  // both are read again — the preview's rectangle does not move, only its
  // contents.
  on('history', refreshHistory);
  on('hello', () => {
    void refreshHistory();
    void refreshPreviewFrame();
  });
  on('tick', () => {
    // A tick records a generation, so the tree grows and the generation the
    // preview is showing changes. Its rectangle does not, so only the pixels
    // are fetched again.
    void refreshHistory();
    void refreshPreviewFrame();
  });
}

function retranslateOwn() {
  dom.hint.textContent = t('hint.history');
  updatePreviewNote();
  renderTimeline();
}

function missingContainers() {
  return ownKeys.filter((name) => dom[name] === null || dom[name] === undefined);
}

// -- the tree -------------------------------------------------------------

/** Ask the core, through the service, which generations it recorded. */
async function refreshHistory() {
  let response;
  try {
    response = await fetch(apiUrl('/api/history'));
  } catch {
    return;
  }
  const reply = await readJson(response);
  if (!reply.ok) {
    state.history = false;
    state.historyRows = [];
    state.head = null;
  } else {
    state.history = true;
    state.historyRows = Array.isArray(reply.generations) ? reply.generations : [];
    state.head = Number.isInteger(reply.head) ? reply.head : null;
    if (typeof reply.current === 'number') state.generation = reply.current;
  }
  renderTimeline();
  // The recording is now known. With one — and a measured canvas, and a world —
  // the pane previews the generation the world is on without being asked; with
  // none it keeps the empty state. Both are the same decision, so it is made in
  // one place (see `previewCurrentGeneration`).
  previewCurrentGeneration();
}

/**
 * Draw the recorded history as a tree, showing only a window of it.
 *
 * The window cuts from the *beginning*, which can orphan a row from its parent.
 * Indentation is therefore rebased on the shallowest row still shown, so a
 * window never renders as a staircase that drifts further right than the page —
 * and `indentLevel` caps what is left, so a deep fork cannot either. The guides
 * are rebased with it and trimmed from the left, so the innermost connector is
 * the one kept when a deep row is drawn at the cap.
 */
function renderTimeline() {
  const recording = state.history === true;
  // The selected generation's rule is part of what the tree says, so the
  // statement about it is re-decided wherever the rows are. This runs before the
  // early returns below: a core with no recording has no selected generation, and
  // that is exactly what the statement has to become silent about.
  updateRuleGap();
  dom.timeline.hidden = !recording;
  if (!recording) {
    dom.timelineList.replaceChildren();
    dom.timelineNote.textContent = t('timeline.empty');
    updateStepControls();
    return;
  }
  if (state.historyRows.length === 0) {
    dom.timelineNote.textContent = t('timeline.noGenerations');
    dom.timelineList.replaceChildren();
    updateStepControls();
    return;
  }
  dom.timelineNote.textContent = '';

  const { flat } = flattenHistory(state.historyRows);
  const start = Math.max(0, flat.length - state.timelineWindow);
  const shown = flat.slice(start);
  const base = shown.reduce((lowest, entry) => Math.min(lowest, entry.depth), shown[0].depth);
  const nodes = [];

  if (start > 0) {
    const earlier = document.createElement('button');
    earlier.type = 'button';
    earlier.className = 'timeline-earlier';
    earlier.textContent = t('action.earlier', { count: start });
    earlier.addEventListener('click', () => {
      // The tree's own rule, applied to its second control: a press that
      // travelled panned the tree, and a pan is not a click on what it started
      // on (see `pressWasPan`).
      if (pressWasPan()) return;
      state.timelineWindow += TIMELINE_WINDOW;
      renderTimeline();
    });
    const item = document.createElement('li');
    item.append(earlier);
    nodes.push(item);
  }

  for (const entry of shown) {
    nodes.push(renderRow(entry, base));
  }
  dom.timelineList.replaceChildren(...nodes);
  updateStepControls();
}

/**
 * One node, as a list item and a row.
 *
 * The row holds two things in the flow — the generation and the marks — and one
 * thing out of it: the overlay with the node's numbers. That is what keeps a row
 * one line tall whatever it is showing, and it is why the overlay is a single
 * absolutely positioned element rather than a second row of content.
 */
function renderRow(entry, base) {
  const { row, depth, branch, forks, guides } = entry;
  const level = indentLevel(depth - base);
  const item = document.createElement('li');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'timeline-row';
  button.style.setProperty('--depth', String(level));
  button.dataset.node = String(row.id);
  button.dataset.generation = String(row.generation);
  button.dataset.current = String(row.generation === state.generation);
  button.dataset.head = String(row.id === state.head);
  button.dataset.fork = String(forks);
  button.dataset.branch = branch ?? '';
  button.dataset.open = 'false';
  button.title = t('timeline.selectTitle', { generation: row.generation });

  // The connectors for the levels this row is inside, trimmed to the innermost
  // `level` of them: the stylesheet places one cell per level in the row's own
  // indentation gutter, and the row's padding is that same number of levels.
  const guidesHost = document.createElement('span');
  guidesHost.className = 'timeline-guides';
  const trail = guides.slice(base);
  for (const kind of trail.slice(Math.max(0, trail.length - level))) {
    const guide = document.createElement('span');
    if (kind === 'line') guide.className = 'timeline-guide timeline-guide-line';
    else if (kind === 'elbow') guide.className = 'timeline-guide timeline-guide-elbow';
    else if (kind === 'end') guide.className = 'timeline-guide timeline-guide-end';
    else guide.className = 'timeline-guide timeline-guide-blank';
    // The gutter is drawn in the row's own indentation and takes no space in the
    // row's line box, so it cannot change how tall a row is.
    guide.setAttribute('aria-hidden', 'true');
    guidesHost.append(guide);
  }
  button.append(guidesHost);

  const generation = document.createElement('span');
  generation.className = 'timeline-generation';
  generation.textContent = String(row.generation);
  button.append(generation);

  const flags = document.createElement('span');
  flags.className = 'timeline-flags';
  if (branch !== null) {
    const badge = document.createElement('span');
    badge.className = 'timeline-branch';
    badge.textContent = t('timeline.branchLabel', { branch });
    flags.append(badge);
  }
  if (forks) {
    const mark = document.createElement('span');
    mark.className = 'timeline-forks';
    mark.textContent = t('timeline.fork');
    flags.append(mark);
  }
  if (row.id === state.head) {
    const mark = document.createElement('span');
    mark.className = 'timeline-head';
    mark.textContent = t('timeline.head');
    flags.append(mark);
  }
  if (row.generation === state.generation) {
    const mark = document.createElement('span');
    mark.className = 'timeline-current';
    mark.textContent = t('timeline.current');
    flags.append(mark);
  }
  button.append(flags);

  // The node's own numbers. `timeline-detail` is the class the stylesheet
  // collapses; the elements keep their own classes so a rule can reach one
  // without reaching the others.
  const overlay = document.createElement('span');
  overlay.className = 'timeline-overlay';
  const kind = document.createElement('span');
  kind.className = 'timeline-kind timeline-detail';
  kind.textContent = t(row.kind === 'keyframe' ? 'timeline.keyframe' : 'timeline.delta');
  const figures = document.createElement('span');
  figures.className = 'timeline-figures timeline-detail';
  figures.textContent =
    `${t('timeline.population')} ${row.population} · ` +
    `${t('timeline.changed')} ${row.changed}`;
  const at = document.createElement('span');
  at.className = 'timeline-at timeline-detail';
  at.textContent = t('timeline.at', {
    time: formatHistoryTime(row.at, state.locale, t('value.none')),
  });
  overlay.append(kind, figures, at);
  button.append(overlay);

  // The reveal is the page's, not `:hover`'s alone, so the keyboard and the
  // pointer open exactly the same thing and a test can drive it: `data-open` is
  // the one state the stylesheet reads.
  const open = () => {
    button.dataset.open = 'true';
  };
  const close = () => {
    button.dataset.open = 'false';
  };
  button.addEventListener('pointerenter', open);
  button.addEventListener('pointerleave', close);
  button.addEventListener('focus', open);
  button.addEventListener('blur', close);
  button.addEventListener('click', () => {
    // A drag that panned the tree is not a click on the row it started on.
    if (pressWasPan()) return;
    void selectNode(row.id);
  });
  item.append(button);
  return item;
}

/** The step controls move along the tree, so their state follows the head. */
function updateStepControls() {
  const head = state.head === null ? undefined : nodeById(state.historyRows, state.head);
  const kids =
    head === undefined ? [] : (flattenHistory(state.historyRows).children.get(head.id) ?? []);
  dom.stepBack.disabled = head === undefined || head.parent === null || head.parent === undefined;
  dom.stepForward.disabled = head === undefined || kids.length === 0;
}

/**
 * Preview a recorded node and move the working point onto it.
 *
 * `select` rather than `rollback`, and the distinction is the whole point of
 * this version: a rollback only reads a generation, while the reason a person
 * clicks one is to work on from it. Once the working point has moved, whatever
 * is edited next is recorded as a *sibling* of the nodes that already descend
 * from this one — the core appends to the working point and only rewrites it in
 * place when nothing descends from it — so a second branch appears beside the
 * first instead of replacing it.
 *
 * The preview follows in three steps, each of them once per selection: the
 * world moves to the node, the live set is read, and the nearest live cell to
 * where the world page was looking becomes the middle of the preview.
 */
async function selectNode(nodeId) {
  if (state.selecting) return;
  state.selecting = true;
  try {
    const response = await fetch(apiUrl('/api/select'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ node: nodeId }),
    });
    const reply = await readJson(response);
    if (!response.ok || reply.ok === false) {
      dom.timelineNote.textContent = t('timeline.selectFailed', {
        message: describeError(state.locale, reply.error ?? 'internal', reply.message),
      });
      return;
    }
    if (reply.state) absorb(reply.state);
    if (typeof reply.generation === 'number') state.generation = reply.generation;
    clearError();
    await afterChange();
    await showGeneration();
    await refreshHistory();
  } catch (error) {
    dom.timelineNote.textContent = t('timeline.selectFailed', { message: error.message });
  } finally {
    state.selecting = false;
  }
}

/**
 * Move one step along the current branch: to the parent, or to the newest child.
 *
 * Following the tree rather than a list is what makes these buttons mean
 * something once there is more than one branch: backwards is always the parent
 * of the working point, and forwards is the most recently recorded child of it.
 */
async function stepHistory(direction) {
  if (state.head === null) return;
  const head = nodeById(state.historyRows, state.head);
  if (head === undefined) return;
  if (direction < 0) {
    if (head.parent === null || head.parent === undefined) return;
    await selectNode(head.parent);
    return;
  }
  const { children } = flattenHistory(state.historyRows);
  const kids = children.get(head.id) ?? [];
  if (kids.length === 0) return;
  await selectNode(kids[kids.length - 1].id);
}

// -- the rule the selected generation ran ----------------------------------

/**
 * Whether an adoption is in flight, so a double press sends one command.
 *
 * The page's own latch rather than a field of the shared state: nothing outside
 * this route has an opinion about a `set_rule` sent from here.
 */
let adopting = false;

/**
 * The generation rule the statement was last written for.
 *
 * A refusal is left on screen when the tree is redrawn or the language changes,
 * because the person is still looking at the two rules it is about. Carrying it
 * to a *different* generation's rule would be a message about something else, so
 * the rule is the one fact that decides whether the message is cleared.
 */
let ruleGapShown = null;

/**
 * State the difference between the selected generation's rule and the one in
 * force, and offer the one press that adopts it.
 *
 * **The page never acts on this by itself.** `select` restores a node's cells and
 * not its rule, so a generation recorded before a rule change leaves the world
 * running the new rule over a world the old one produced — and that is worth
 * saying, in the two rule strings themselves, with a button beside it. Every
 * other moment on this route — choosing a node, the two step controls, the
 * automatic preview, dragging the tree — only *re-decides* what this says; the
 * command belongs to `adoptGenerationRule`, which only a press reaches.
 *
 * The comparison and the two values are `history.mjs`'s `ruleGap`, which reads
 * the node's own `rule` from the history reply and `state.rule` from the state
 * reply. A generation the store wrote without a rule, a rule that has not arrived
 * yet and two equal rules all leave the block hidden; there is nothing to derive
 * from a generation number and nothing is derived.
 */
function updateRuleGap() {
  if (!dom.ruleGap) return;
  const gap = ruleGap(state.historyRows, state.head, state.rule);
  if (gap === null) {
    dom.ruleGap.hidden = true;
    dom.ruleGapNote.textContent = '';
    dom.ruleGapAdopt.textContent = '';
    dom.ruleGapAdopt.removeAttribute('title');
    ruleGapShown = null;
    clearRuleGapError();
    return;
  }
  // The same generation rule: the sentence and the button are rewritten, because
  // the words around them may have changed language, and a refusal survives.
  if (gap.rule !== ruleGapShown) {
    ruleGapShown = gap.rule;
    clearRuleGapError();
  }
  dom.ruleGap.hidden = false;
  dom.ruleGapNote.textContent = t('timeline.ruleGap', {
    generation: gap.generation,
    rule: gap.rule,
    current: gap.current,
  });
  dom.ruleGapAdopt.textContent = t('action.adoptRule', { rule: gap.rule });
  dom.ruleGapAdopt.title = t('action.adoptRuleTitle', { rule: gap.rule });
}

/** The core's own reason for refusing, beside the statement it belongs to. */
function showRuleGapError(message) {
  if (!dom.ruleGapError) return;
  dom.ruleGapError.textContent = message;
  dom.ruleGapError.hidden = false;
}

function clearRuleGapError() {
  if (!dom.ruleGapError) return;
  dom.ruleGapError.textContent = '';
  dom.ruleGapError.hidden = true;
}

/**
 * Adopt the rule the selected generation was recorded under.
 *
 * One press, one command, through the same `/api/command` path the world page's
 * editor uses, so the core keeps the last word as it does everywhere else. The
 * value sent is **the generation's own rule**, read from the history reply rather
 * than from anything this page holds a copy of.
 *
 * A refusal leaves everything as it was: the core's reason is shown with
 * `describeError`, which is the translated label for the core's error code with
 * the core's own message as detail, and neither the rule in force nor the
 * statement changes — the two still disagree, and the person can try something
 * else. An accepted rule is taken from the reply, never from what was asked for,
 * which is what makes the statement disappear as soon as the two agree.
 */
async function adoptGenerationRule() {
  const gap = ruleGap(state.historyRows, state.head, state.rule);
  if (gap === null || adopting) return;
  adopting = true;
  try {
    const reply = await callCore({ cmd: 'set_rule', rule: gap.rule });
    // A reply of `null` means the service or the core is not answering, which the
    // shell has already said in the banner; a reply with `ok: false` is the core's
    // refusal, and its reason belongs beside the rule it refused.
    if (reply === null) return;
    if (reply.ok === false) {
      showRuleGapError(describeError(state.locale, reply.error ?? 'bad_rule', reply.message));
      return;
    }
    state.rule = reportedRule(reply, gap.rule);
    clearRuleGapError();
  } finally {
    adopting = false;
  }
  // The two rules agree now, so the statement has nothing left to say.
  updateRuleGap();
}

// -- the preview ----------------------------------------------------------

/** The 2D context, created once the canvas is known to exist. */
let preview2d = null;
const previewOffscreen = document.createElement('canvas');

/** The palette the preview paints with, read from the active theme. */
let palette = DEFAULT_PALETTE;

/** The point the preview is centred on, so a resize can keep it in the middle. */
let previewPoint = null;

/** The last frame drawn, so a redraw at a new size does not ask for another. */
let previewFrame = null;

function onTheme() {
  palette = readPalette(getComputedStyle(document.documentElement), palette);
  // The ground is a colour from the theme, so a theme change has to repaint the
  // pane whether or not it is holding a frame.
  refreshPreview();
}

function previewCanvasSize() {
  const rect = dom.preview.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = Math.max(1, Math.round(rect.width));
  const cssHeight = Math.max(1, Math.round(rect.height));
  const pixelWidth = Math.max(1, Math.round(cssWidth * dpr));
  const pixelHeight = Math.max(1, Math.round(cssHeight * dpr));
  if (dom.preview.width !== pixelWidth || dom.preview.height !== pixelHeight) {
    dom.preview.width = pixelWidth;
    dom.preview.height = pixelHeight;
  }
  return { cssWidth, cssHeight, dpr };
}

/** The widest preview span the encoder can serve at the current population. */
function previewSpanLimit() {
  if (state.world === null) return MIN_SPAN;
  const { cssWidth, cssHeight } = previewCanvasSize();
  return computeMaxSpan({
    cssWidth,
    cssHeight,
    population: state.population,
    world: state.world,
  });
}

/** Whether the preview has a canvas with a real size and a world to show. */
function previewReady() {
  if (state.world === null) return false;
  const rect = dom.preview.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/**
 * Whether the load-time preview has been started.
 *
 * A latch rather than a repeated test, because the conditions below are not all
 * true at the same moment: the recording arrives from one reply and the canvas
 * gets its size from the layout, in either order. The decision is therefore
 * re-offered on every one of those moments and taken exactly once.
 */
let autoPreviewStarted = false;

/**
 * Preview the generation the world is on, once the load is complete.
 *
 * The page's subject is the recording, so a person who opens it is asking about
 * *this* generation before they ask about any other one: with a recording and a
 * measured canvas the pane shows it, rather than a prompt to go and click a row.
 * This is the one automatic placement; a selection afterwards is the user's own
 * and moves the working point as well (see `selectNode`).
 *
 * **Four conditions, and each of them is a fact rather than a preference:**
 *
 * 1. the load has not already previewed (`autoPreviewStarted`);
 * 2. no generation is on the pane yet (`state.previewViewport` is null) — a
 *    selection has already placed it, and re-placing would throw away the view
 *    the user chose;
 * 3. the pane is ready: the canvas has been measured *and* the core has declared
 *    its world, which arrives on the state reply and again on the stream's
 *    `hello`, so a page polling and a page on the push transport both get it. A
 *    canvas with no size has no view to ask about, and a span of zero is not a
 *    view: the world route's canvas is in exactly that state while the panel is
 *    `wide`, and a pane that has not been laid out measures zero too;
 * 4. the session has a recording: the core records a history *and* has recorded
 *    at least one generation. With none, the pane keeps the empty state and its
 *    prompt, which is the honest answer to "there is nothing to preview yet".
 *
 * Conditions 3 and 4 can become true after the page has loaded — a resize gives
 * the canvas a size, and a tick records the first generation — so this is
 * called from every moment that can change them, and the latch is what keeps a
 * page that is ready once from asking twice.
 */
function previewCurrentGeneration() {
  if (autoPreviewStarted) return;
  if (state.previewViewport !== null) return;
  if (!previewReady()) return;
  if (state.history !== true || state.historyRows.length === 0) return;
  autoPreviewStarted = true;
  void showGeneration();
}

/**
 * Put `point` in the middle of the preview, at the default span.
 *
 * The span is the canvas width over the same pixels per cell the world route
 * uses, so a generation looks the same size in both — `viewport.mjs` owns that
 * rule and this is its only caller on this route.
 */
function placePreview(point) {
  const { cssWidth, cssHeight } = previewCanvasSize();
  const next = centreAt({
    point,
    span: defaultSpan(cssWidth),
    cssWidth,
    cssHeight,
    world: state.world,
  });
  state.previewViewport = next;
  previewPoint = point;
  state.previewMoved = false;
  return next;
}

/**
 * Read the live set of the generation the world is on, once.
 *
 * `GET /api/cells` carries the core's own `cells` export when it fits, and the
 * population and the core's `bounds` when it does not. A reply that is not a
 * payload at all leaves the preview with nothing but the world's centre, which
 * is the same answer the page gives for an empty world.
 *
 * @returns {Promise<{cells: [number, number][] | null, bounds: number[] | null,
 *   population: number | null, cap: number | null}>}
 */
async function readLiveCells() {
  const empty = { cells: null, bounds: null, population: null, cap: null };
  let response;
  try {
    response = await fetch(apiUrl('/api/cells'));
  } catch {
    return empty;
  }
  const reply = await readJson(response);
  if (!response.ok || reply.ok === false) return empty;
  const result = {
    cells: null,
    bounds: Array.isArray(reply.bounds) ? reply.bounds : null,
    population: Number.isInteger(reply.population) ? reply.population : null,
    cap: Number.isInteger(reply.cap) ? reply.cap : null,
  };
  if (typeof reply.cells !== 'string') return result;
  try {
    result.cells = decodeCells(reply.cells);
  } catch {
    // A payload this page cannot decode is the same as one that was not sent:
    // the preview falls back rather than drawing half a world.
    result.cells = null;
  }
  return result;
}

/** The last centring decision, so the note can say what it was. */
let previewSource = 'empty';

/** The population and the cap the service last reported, for the degraded note. */
let previewPopulation = null;
let previewCap = null;

/**
 * The placement in flight, as a number.
 *
 * Two placements can overlap even though each is a single decision: the automatic
 * one reads the live set when the load completes, and the user can select a node
 * while that answer is still on its way. The newer question must win — the
 * alternative is a slow automatic answer landing on top of the generation the
 * user just chose, and on the note that describes it. So every placement takes a
 * number and, when its read comes back, only the newest may place and draw.
 *
 * The frame request coalesces separately (`state.previewInFlight`), and that is a
 * different problem: that one is a single rectangle asked for repeatedly, this
 * one is two answers to two different questions.
 */
let placementSeq = 0;

/**
 * Show the generation the world is on: centre the preview and draw it.
 *
 * One read of the live set, one centring decision, one frame — per placement,
 * not per tick. Both placements come through here: the load-time one, which
 * changes only what is drawn (`previewCurrentGeneration`), and the user's, which
 * has already moved the working point by the time it arrives (`selectNode`). The
 * centring rule is therefore stated once, and the two cannot drift apart.
 */
async function showGeneration() {
  if (!previewReady()) {
    previewSource = 'empty';
    updatePreviewNote();
    return;
  }
  const placement = (placementSeq += 1);
  const live = await readLiveCells();
  // A newer placement — a node selected while this read was in flight — owns the
  // pane now. This answer describes a generation nobody is asking about any more,
  // so it is dropped rather than placed.
  if (placement !== placementSeq) return;
  const focus = focusFromLocation() ?? readFocus(safeStorage(), state.sessionId);
  const decided = previewFocus({
    cells: live.cells,
    bounds: live.bounds,
    focus,
    world: state.world,
  });
  previewSource = decided.source;
  previewPopulation = live.population;
  previewCap = live.cap;
  placePreview(decided.point);
  updatePreviewNote();
  await refreshPreviewFrame();
}

/** The frame for the preview's own rectangle, or null when it has none. */
function previewRequest() {
  if (state.previewViewport === null || state.world === null) return null;
  const { cssWidth, cssHeight } = previewCanvasSize();
  const result = computeFrameRequest({
    viewport: state.previewViewport,
    world: state.world,
    cssWidth,
    cssHeight,
    population: state.population,
  });
  state.previewViewport.span = result.span;
  return result.frame;
}

/** Draw a frame into the preview canvas. */
function renderPreview(frame) {
  if (frame === null || preview2d === null) return;
  const { cssWidth, cssHeight, dpr } = previewCanvasSize();
  drawFrame({
    context: preview2d,
    offscreen: previewOffscreen,
    frame,
    cssWidth,
    cssHeight,
    dpr,
    palette,
    gridWidth: state.gridWidth,
  });
}

/**
 * Paint what the pane shows when it has no frame to show: the theme's dead
 * colour, the same ground a frame is drawn on.
 *
 * **This is the fix for the defect a person reported as "after a refresh the
 * preview is black", and the cause was measured in a real browser** (Edge 155,
 * headless, driven over CDP against the served page), **not inferred from the
 * code**. The measurement: all 480000 pixels of the preview's 800 x 600 backing
 * store were one colour, `rgba(0, 0, 0, 0)`, while the element's computed
 * `background-color` was `rgb(255, 255, 255)` — the light theme's `--dead`.
 * Nothing had drawn at all, and the black was not the dead colour either: the
 * context is created with `alpha: false` (`bindOwnDom`), and an opaque canvas
 * with an unpainted backing store composites as **pure black**, so the
 * stylesheet's own `background` never gets the chance to show.
 *
 * Why nothing had drawn: every path into `renderPreview` needs
 * `state.previewViewport`, which was null until a generation was selected, and
 * `refreshPreviewFrame` returns early on that. So a refresh — no selection yet —
 * left the pane as the browser's default surface. **The pane now places a
 * generation itself when the load is complete** (`previewCurrentGeneration`), so
 * this ground is what it shows in the cases where there is still nothing to
 * draw: a session with no recording at all, and a pane that has not been laid out
 * or whose world is not yet known. What did not change is the part the defect was
 * about — the canvas is never left unpainted, so the pane shows the theme's
 * ground instead of a black hole. The same call `drawFrame` starts from paints
 * it, so "nothing yet" and "here is a generation" cannot drift apart.
 */
function paintPreviewGround() {
  if (preview2d === null) return;
  const { cssWidth, cssHeight, dpr } = previewCanvasSize();
  paintGround(preview2d, cssWidth, cssHeight, dpr, palette);
}

/** Ask for the preview's rectangle once and draw it.
 *
 * One request at a time: a drag emits a move event per frame and the answer to
 * each of them would be a frame the next one has already made stale, so a change
 * that arrives while one is in flight sets a flag and the latest rectangle is
 * asked for when it lands — the same coalescing the world route's polling does.
 */
async function refreshPreviewFrame() {
  if (state.previewInFlight) {
    state.previewAgain = true;
    return;
  }
  const request = previewRequest();
  if (request === null) return;
  const query = new URLSearchParams({
    x0: String(request.x0),
    y0: String(request.y0),
    w: String(request.w),
    h: String(request.h),
  });
  state.previewInFlight = true;
  try {
    let response;
    try {
      response = await fetch(apiUrl(`/api/frame?${query}`));
    } catch (error) {
      showError(t('error.serviceUnreachable', { message: error.message }));
      return;
    }
    const reply = await readJson(response);
    if (!reply.ok) {
      if (reply.error !== 'core_unavailable') {
        showError(
          t('preview.failed', {
            message: describeError(state.locale, reply.error ?? 'internal', reply.message),
          }),
        );
      }
      return;
    }
    previewFrame = reply.frame;
    absorb(reply.frame);
    try {
      renderPreview(reply.frame);
    } catch (error) {
      showError(t('preview.failed', { message: error.message }));
      return;
    }
    clearError();
  } finally {
    state.previewInFlight = false;
  }
  if (state.previewAgain) {
    state.previewAgain = false;
    await refreshPreviewFrame();
  }
}

/**
 * The frame already held, drawn again: a resize or a theme change.
 *
 * With no frame yet there is still something to put on the canvas — the ground —
 * so this never leaves the pane as whatever the browser had on it. A resize
 * *clears* the canvas (assigning `width`/`height` does that), which is exactly why
 * the ground has to be repainted here rather than only at start-up.
 */
function refreshPreview() {
  if (previewFrame === null) {
    paintPreviewGround();
    return;
  }
  renderPreview(previewFrame);
}

/** The canvas changed size: keep the point in the middle and the frame redrawn. */
function onPreviewResized() {
  refreshPreview();
  if (state.previewViewport === null || previewPoint === null) {
    // Nothing has been placed yet, which is also the moment the second readiness
    // gate can change: a pane that was hidden — or not laid out — when the page
    // loaded has a size now, and the load-time preview can finally happen.
    previewCurrentGeneration();
    return;
  }
  if (!state.previewMoved) placePreview(previewPoint);
  updatePreviewNote();
  void refreshPreviewFrame();
}

/**
 * Say what the preview is showing, and how it decided where to look.
 *
 * The three cases are the three sources `previewFocus` can return, and each has
 * its own whole sentence: a preview centred on the middle of a bounding box is a
 * different answer from one centred on a cell, and the user is told which one
 * they got rather than left to guess from the pixels. The fourth case is no
 * generation on the pane at all — no recording, or nothing measured yet — and
 * that is the one the prompt was written for: it says what to do instead.
 */
function updatePreviewNote() {
  if (previewSource === 'empty' || state.previewViewport === null) {
    dom.previewNote.textContent = t('preview.empty');
    return;
  }
  const generation = state.generation;
  if (previewSource === 'nearest') {
    const focus =
      focusFromLocation() ?? readFocus(safeStorage(), state.sessionId) ?? previewPoint ?? { x: 0, y: 0 };
    dom.previewNote.textContent = t('preview.note.cell', {
      generation,
      x: Math.round(focus.x),
      y: Math.round(focus.y),
    });
    return;
  }
  if (previewSource === 'bounds') {
    dom.previewNote.textContent = t('preview.note.bounds', {
      generation,
      population: previewPopulation ?? 0,
      cap: previewCap ?? 0,
    });
    return;
  }
  dom.previewNote.textContent = t('preview.note.world', { generation });
}

// -- the tree's own gestures ----------------------------------------------

/**
 * The drag that pans the tree.
 *
 * A tree is a list with a shape, and a person looking at a long run reaches for
 * the surface before they reach for a scrollbar. The record here is what keeps
 * that gesture from becoming a click: a press that travelled more than
 * `DRAG_THRESHOLD_PX` marks the drag, and the click that follows it is ignored
 * by whichever of the tree's two controls it lands on — a generation row, or the
 * window button that shows the earlier generations.
 *
 * **Which element takes the pointer capture is the whole of a defect that was
 * found in a real browser** (Edge 155, headless, driven over CDP against the
 * served page) **and not by any test**. The capture target receives every event
 * of the gesture, `pointerup` included, and a `click` is dispatched on the
 * nearest common *inclusive ancestor* of the press and the release — so while
 * the capture was taken on the list, a press on a row produced `pointerdown` on
 * the row's own `<span>`, then `pointerup` and `click` both on `#timeline`, and
 * the row's `click` listener never ran at all. The measured consequence:
 * `POST /api/select` was never sent, the working point never moved, and the only
 * way to preview a generation was the two step buttons. The keyboard was
 * unaffected — `Enter` on a `<button>` synthesises a click with no pointer
 * involved — which is why the defect read as "the rows do not respond".
 *
 * The capture therefore belongs to the row the press landed on. A drag that
 * leaves the row still arrives at the handlers below: they are on the list, and
 * the row's own events bubble to it. `endTreeDrag` releases from whatever took
 * the capture, so the two cannot disagree.
 *
 * **The window control was the same defect, found later and in the same
 * browser.** "Show the earlier generations" is not a row, so the row search found
 * nothing and the capture fell to the tree — and the click went to the tree with
 * it. Measured (Edge 155, headless, driven over CDP against the served page):
 * `pointerdown` on `button.timeline-earlier`, then `pointerup` and `click` on
 * `section#timeline`, with 40 rows in the list both before the press and after
 * it, while the same page's own `.click()` on that same button widened it to 80
 * and then to 120. So the rule is the general one rather than a row special
 * case: **the capture belongs to what was pressed, except that a press inside a
 * row takes the row** — which only ever moves the click *up* to an ancestor that
 * the pressed element still contains. `pressWasPan` below is the other half of
 * it: now that the control's own click arrives, a pan that started on the control
 * has to be refused exactly as a row refuses one.
 */
const treeDrag = { pointerId: null, lastX: 0, lastY: 0, moved: 0, capture: null };

/**
 * Whether the press that is ending travelled far enough to be a pan.
 *
 * One predicate rather than one comparison per control, because "a drag is not a
 * click" belongs to the tree's drag surface and not to its rows: every control
 * inside it — a generation row and the window button — obeys the same test.
 */
function pressWasPan() {
  return treeDrag.moved > DRAG_THRESHOLD_PX;
}

function beginTreeDrag(event) {
  if (event.button !== undefined && event.button !== 0) return;
  treeDrag.pointerId = event.pointerId;
  treeDrag.lastX = event.clientX;
  treeDrag.lastY = event.clientY;
  treeDrag.moved = 0;
  // The press may land on any of the row's children — the generation, a mark,
  // the connector gutter — so the row is found from the event's target rather
  // than assumed. A press that did not land in a row captures on the element it
  // did land on, so the click the browser computes from the press and the release
  // stays inside the control that was pressed; a press on the tree itself (below
  // the rows) captures on the tree, as it did before.
  const pressed = event.target ?? null;
  const row = typeof pressed?.closest === 'function' ? pressed.closest('.timeline-row') : null;
  treeDrag.capture = row ?? pressed ?? dom.timeline;
  if (typeof treeDrag.capture.setPointerCapture === 'function') {
    treeDrag.capture.setPointerCapture(event.pointerId);
  }
}

function moveTreeDrag(event) {
  if (treeDrag.pointerId !== event.pointerId) return;
  const deltaX = event.clientX - treeDrag.lastX;
  const deltaY = event.clientY - treeDrag.lastY;
  treeDrag.lastX = event.clientX;
  treeDrag.lastY = event.clientY;
  treeDrag.moved += Math.abs(deltaX) + Math.abs(deltaY);
  if (treeDrag.moved <= DRAG_THRESHOLD_PX) return;
  dom.timeline.classList.add('dragging');
  // Grab and pull: dragging the tree down shows what is above it.
  dom.timeline.scrollTop = Math.max(0, dom.timeline.scrollTop - deltaY);
  dom.timeline.scrollLeft = Math.max(0, dom.timeline.scrollLeft - deltaX);
}

function endTreeDrag(event) {
  if (treeDrag.pointerId !== event.pointerId) return;
  treeDrag.pointerId = null;
  dom.timeline.classList.remove('dragging');
  const capture = treeDrag.capture ?? dom.timeline;
  treeDrag.capture = null;
  if (typeof capture.hasPointerCapture === 'function' && capture.hasPointerCapture(event.pointerId)) {
    capture.releasePointerCapture(event.pointerId);
  }
}

/**
 * Move the keyboard's focus along the tree.
 *
 * A row is a `<button>`, so `Tab` reaches it and `Enter` selects it without any
 * of this. What the arrows add is the thing a list of forty rows needs: one
 * keystroke per row instead of forty tab stops, in the order the tree is read.
 */
function onTimelineKeydown(event) {
  const rows = dom.timelineList.querySelectorAll('.timeline-row');
  const index = rows.indexOf(event.target);
  if (index < 0) return;
  let next = null;
  if (event.key === 'ArrowDown') next = rows[index + 1] ?? null;
  else if (event.key === 'ArrowUp') next = rows[index - 1] ?? null;
  else if (event.key === 'Home') next = rows[0] ?? null;
  else if (event.key === 'End') next = rows[rows.length - 1] ?? null;
  if (next === null || next === event.target) return;
  event.preventDefault();
  next.focus();
}

// -- the preview's gestures ------------------------------------------------

/** The contacts on the preview canvas, and the gesture between them. */
const previewPointers = new Map();
const previewGesture = { mode: null, lastX: 0, lastY: 0 };

function beginPreviewGesture(event) {
  if (event.button !== undefined && event.button !== 0) return;
  dom.preview.setPointerCapture(event.pointerId);
  previewPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  previewGesture.mode = 'drag';
  previewGesture.lastX = event.clientX;
  previewGesture.lastY = event.clientY;
}

function movePreviewGesture(event) {
  if (!previewPointers.has(event.pointerId)) return;
  previewPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (previewGesture.mode !== 'drag' || state.previewViewport === null) return;
  const deltaX = event.clientX - previewGesture.lastX;
  const deltaY = event.clientY - previewGesture.lastY;
  previewGesture.lastX = event.clientX;
  previewGesture.lastY = event.clientY;
  dom.preview.classList.add('dragging');
  const { cssWidth } = previewCanvasSize();
  translateViewport(state.previewViewport, deltaX, deltaY, cssWidth);
  clampPreview();
  state.previewMoved = true;
  void refreshPreviewFrame();
}

function endPreviewGesture(event) {
  if (!previewPointers.has(event.pointerId)) return;
  previewPointers.delete(event.pointerId);
  dom.preview.classList.remove('dragging');
  if (dom.preview.hasPointerCapture?.(event.pointerId)) {
    dom.preview.releasePointerCapture(event.pointerId);
  }
  if (previewPointers.size === 0) previewGesture.mode = null;
}

function clampPreview() {
  if (state.world === null || state.previewViewport === null) return;
  const { cssWidth, cssHeight } = previewCanvasSize();
  clampViewportTo(state.previewViewport, state.world, cssWidth, cssHeight);
}

function zoomPreview(clientX, clientY, factor) {
  if (state.previewViewport === null || state.world === null) return;
  const rect = dom.preview.getBoundingClientRect();
  const { cssWidth } = previewCanvasSize();
  const next = rescaleAt({
    viewport: state.previewViewport,
    clientX,
    clientY,
    rect,
    cssWidth,
    factor,
    minSpan: MIN_SPAN,
    spanLimit: previewSpanLimit(),
  });
  state.previewViewport.span = next.span;
  state.previewViewport.x0 = next.x0;
  state.previewViewport.y0 = next.y0;
  clampPreview();
  state.previewMoved = true;
}

// -- events ---------------------------------------------------------------

// The page's own elements, bound now: this module runs after the document is
// parsed, and the controls below are wired onto them.
bindOwnDom();
const ownKeys = Object.keys(dom);

dom.stepBack.addEventListener('click', () => void stepHistory(-1));
dom.stepForward.addEventListener('click', () => void stepHistory(1));
// The one press that changes the rule on this route. It is deliberately not on
// the row, on the preview or on a step: those report where the world is, and this
// one is the person saying the world should run what the recording says it ran.
dom.ruleGapAdopt.addEventListener('click', () => void adoptGenerationRule());

dom.timeline.addEventListener('pointerdown', beginTreeDrag);
dom.timeline.addEventListener('pointermove', moveTreeDrag);
dom.timeline.addEventListener('pointerup', endTreeDrag);
dom.timeline.addEventListener('pointercancel', endTreeDrag);
dom.timelineList.addEventListener('keydown', onTimelineKeydown);

dom.preview.addEventListener('pointerdown', beginPreviewGesture);
dom.preview.addEventListener('pointermove', movePreviewGesture);
dom.preview.addEventListener('pointerup', endPreviewGesture);
dom.preview.addEventListener('pointercancel', endPreviewGesture);
dom.preview.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault();
    zoomPreview(event.clientX, event.clientY, Math.exp(event.deltaY * 0.0015));
    updatePreviewNote();
    void refreshPreviewFrame();
  },
  { passive: false },
);

// The preview has its own size, and the tree's layout changes with the window,
// so the browser's observer is the signal that arrives in time. It is created by
// `watchPreviewSize` rather than here: the shared state arrives with the shell's
// handshake, which is after this module's own body has run.
window.addEventListener('resize', () => onPreviewResized());

/** Observe the preview's size, once there is a state to record the observer in. */
function watchPreviewSize() {
  if (typeof ResizeObserver !== 'function') return;
  state.resizeObserver = new ResizeObserver(() => onPreviewResized());
  state.resizeObserver.observe(dom.preview);
}

// -- start ----------------------------------------------------------------

function start() {
  const missing = missingContainers();
  if (missing.length > 0) {
    // A silent early return here is what produced a blank tree with a green test
    // suite the first time this page was split out of the single-file page.
    showError(t('error.missingContainers', { names: missing.join(', ') }));
    return;
  }
  state.timelineWindow = TIMELINE_WINDOW;
  // The grid line width is the world route's control and the same stored
  // preference, so the preview draws the same grid the world does.
  state.gridWidth = clampGridWidth(readStored(GRID_WIDTH_STORAGE_KEY, safeStorage()));
  palette = readPalette(getComputedStyle(document.documentElement), palette);
  // The pane is painted before anything is asked for it: an unpainted canvas is a
  // black hole rather than the "nothing here yet" the note beside it describes,
  // and the recording — which is what decides whether there is a generation to
  // preview at all — has not been read yet at this point.
  refreshPreview();
  watchPreviewSize();
  updatePreviewNote();
  // Reading the recording is also what offers the load-time preview: the reply
  // is the first moment this page knows whether there is a current generation to
  // show (see `previewCurrentGeneration`).
  void refreshHistory();
  updateStepControls();
}

connectShell(fill, start);
