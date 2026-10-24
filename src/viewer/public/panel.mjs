/**
 * lifegame viewer — the right-hand panel's three states, as pure functions.
 *
 * The panel is where the history and the archive manager live. It has three
 * states rather than two because "get it out of the way" and "let me read it
 * properly" are different requests:
 *
 * - `normal` — a column beside the canvas, wide enough for a generation row.
 * - `collapsed` — off the edge, with the canvas taking the space it gave up.
 *   This is why collapsing changes the layout instead of covering the canvas: a
 *   panel drawn over the world hides the thing the user is working on.
 * - `wide` — the panel takes the stage and the canvas steps aside, which is what
 *   "show me the history" means when the history is the subject.
 *
 * The resolution rule is the theme's, restated for a third setting: a stored
 * value that names a state wins, anything else means the default. Keeping it
 * here rather than in app.js is what lets `node --test` check it, because the
 * browser cannot be driven from a test and the storage in it can throw.
 */

export const PANEL_STORAGE_KEY = 'lifegame.viewer.panel';

/** The three states, in the order the cycle visits them. */
export const PANEL_MODES = Object.freeze(['normal', 'collapsed', 'wide']);

/** The state used when nothing else decides. */
export const DEFAULT_PANEL_MODE = 'normal';

/**
 * The panel state to use, given what was stored.
 *
 * A value that is not one of the three is not repaired into the nearest one: an
 * unreadable setting means "the user has no preference I can honour", which is
 * the same as no setting at all.
 */
export function resolvePanelMode(stored) {
  return typeof stored === 'string' && PANEL_MODES.includes(stored)
    ? stored
    : DEFAULT_PANEL_MODE;
}

/**
 * The state after the collapse control is pressed.
 *
 * Collapsing from `wide` goes to `collapsed` rather than to `normal`: the button
 * means "hide it", and a press that left the panel on screen would look broken.
 */
export function toggleCollapsed(mode) {
  return mode === 'collapsed' ? 'normal' : 'collapsed';
}

/**
 * The state after the full-width control is pressed.
 *
 * From `collapsed` this opens the panel wide rather than restoring the column,
 * because the press asked for the big view and getting a narrow one instead
 * would be a third meaning for one button.
 */
export function toggleWide(mode) {
  return mode === 'wide' ? 'normal' : 'wide';
}

/** The state after the cycle control is pressed: normal → collapsed → wide. */
export function cyclePanelMode(mode) {
  const index = PANEL_MODES.indexOf(resolvePanelMode(mode));
  return PANEL_MODES[(index + 1) % PANEL_MODES.length];
}

/** Whether the canvas is visible in this state. */
export function canvasVisible(mode) {
  return resolvePanelMode(mode) !== 'wide';
}

/** Whether the panel is visible in this state. */
export function panelVisible(mode) {
  return resolvePanelMode(mode) !== 'collapsed';
}
