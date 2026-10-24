/**
 * The panel's three states, asserted as a state machine.
 *
 * The panel changes the page's layout, so a wrong state is not a wrong pixel but
 * a control the user cannot reach: `collapsed` with no way back hides the
 * history, and `wide` with the canvas still drawn puts the two on top of each
 * other. Both are cheap to get wrong and impossible to catch without a browser,
 * which is why the state machine is a module rather than three `if` statements
 * in `app.js`.
 *
 * The resolution rule is the theme's, restated: a stored value that names a
 * state wins, anything else means the default. A value from an older build, or a
 * value a user typed into devtools, is not repaired into the nearest state —
 * it means "no preference I can honour", which is the same as no preference.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_PANEL_MODE,
  PANEL_MODES,
  PANEL_STORAGE_KEY,
  canvasVisible,
  cyclePanelMode,
  panelVisible,
  resolvePanelMode,
  toggleCollapsed,
  toggleWide,
} from '../public/panel.mjs';

test('the panel has exactly three states and a storage key of its own', () => {
  assert.deepEqual([...PANEL_MODES], ['normal', 'collapsed', 'wide']);
  assert.equal(DEFAULT_PANEL_MODE, 'normal');
  assert.equal(PANEL_STORAGE_KEY, 'lifegame.viewer.panel');
});

test('a stored state wins and anything else falls back', () => {
  assert.equal(resolvePanelMode('collapsed'), 'collapsed');
  assert.equal(resolvePanelMode('wide'), 'wide');
  assert.equal(resolvePanelMode('normal'), 'normal');
  for (const stored of [null, undefined, '', 'WIDE', 'expanded', 42, {}, []]) {
    assert.equal(resolvePanelMode(stored), DEFAULT_PANEL_MODE, `for ${JSON.stringify(stored)}`);
  }
});

test('collapsing hides the panel and pressing again brings it back', () => {
  assert.equal(toggleCollapsed('normal'), 'collapsed');
  assert.equal(toggleCollapsed('collapsed'), 'normal');
  // From full width the button still means "hide it": a press that left the
  // panel on screen would look like it did nothing.
  assert.equal(toggleCollapsed('wide'), 'collapsed');
});

test('the full-width control opens from hidden and returns from full width', () => {
  assert.equal(toggleWide('normal'), 'wide');
  assert.equal(toggleWide('wide'), 'normal');
  assert.equal(toggleWide('collapsed'), 'wide');
});

test('the cycle visits every state exactly once', () => {
  const seen = [];
  let mode = 'normal';
  for (let step = 0; step < PANEL_MODES.length; step += 1) {
    seen.push(mode);
    mode = cyclePanelMode(mode);
  }
  assert.deepEqual(seen, [...PANEL_MODES]);
  assert.equal(mode, 'normal', 'the cycle returns to where it started');
});

test('the canvas and the panel are never both hidden and never both full', () => {
  assert.equal(canvasVisible('normal'), true);
  assert.equal(canvasVisible('collapsed'), true);
  assert.equal(canvasVisible('wide'), false);
  assert.equal(panelVisible('normal'), true);
  assert.equal(panelVisible('collapsed'), false);
  assert.equal(panelVisible('wide'), true);
});

test('an unreadable stored value is treated as no preference, not repaired', () => {
  // Repairing would silently move a user who had a valid setting in an older
  // build into a state they never chose.
  assert.equal(resolvePanelMode('expanded'), DEFAULT_PANEL_MODE);
  assert.equal(canvasVisible('expanded'), true);
});
