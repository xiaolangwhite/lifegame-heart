/**
 * The theme, the palette and the grid-line geometry, as pure functions.
 *
 * The browser cannot be driven from `node --test`, so the parts of the page that
 * make decisions are kept here, where they can be. The tests below cover the
 * precedence rule, the storage that lies about working, the colour notations a
 * stylesheet may hand back, and the device-pixel arithmetic that decides whether
 * a grid line is crisp or smeared across two rows of pixels.
 *
 * What is deliberately *not* here: anything that touches `document`, `window` or
 * `localStorage`. The storage is a parameter, which is what makes the failure
 * modes testable — a storage that throws, one that is missing, one that returns
 * a number instead of a string.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_GRID_WIDTH,
  GRID_WIDTHS,
  GRID_WIDTH_STORAGE_KEY,
  MAX_GRID_WIDTH,
  MIN_GRID_WIDTH,
  THEMES,
  THEME_STORAGE_KEY,
  clampGridWidth,
  clearStored,
  deviceLineWidth,
  isExplicitTheme,
  nextTheme,
  parseColor,
  readStored,
  resolveTheme,
  snapLineCenter,
  toCssColor,
  writeStored,
} from '../public/theme.mjs';

/** A storage that behaves like a working `localStorage`. */
function workingStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    entries: () => Object.fromEntries(map),
  };
}

test('the storage keys are namespaced and distinct', () => {
  assert.equal(THEME_STORAGE_KEY, 'lifegame.viewer.theme');
  assert.equal(GRID_WIDTH_STORAGE_KEY, 'lifegame.viewer.gridWidth');
  assert.notEqual(THEME_STORAGE_KEY, GRID_WIDTH_STORAGE_KEY);
  assert.deepEqual(THEMES, ['dark', 'light']);
  assert.deepEqual(GRID_WIDTHS, [1, 2, 3, 4]);
  assert.equal(DEFAULT_GRID_WIDTH, 2);
});

test('with nothing stored the theme follows the system', () => {
  assert.equal(resolveTheme(null, true), 'dark');
  assert.equal(resolveTheme(null, false), 'light');
  assert.equal(resolveTheme(undefined, true), 'dark');
  assert.equal(resolveTheme('', false), 'light');
});

test('an explicit choice beats the system, in both directions', () => {
  assert.equal(resolveTheme('light', true), 'light');
  assert.equal(resolveTheme('dark', false), 'dark');
  assert.equal(isExplicitTheme('light'), true);
  assert.equal(isExplicitTheme('dark'), true);
});

test('a value from an older build means "follow the system", not a crash', () => {
  for (const junk of ['system', 'DARK', 'blue', '1', '{}', 'null']) {
    assert.equal(isExplicitTheme(junk), false);
    assert.equal(resolveTheme(junk, true), 'dark');
    assert.equal(resolveTheme(junk, false), 'light');
  }
});

test('the toggle flips between the two themes and nothing else', () => {
  assert.equal(nextTheme('dark'), 'light');
  assert.equal(nextTheme('light'), 'dark');
  assert.equal(nextTheme(nextTheme('dark')), 'dark');
});

test('a grid width is clamped into the offered range and rounded', () => {
  assert.equal(clampGridWidth(1), 1);
  assert.equal(clampGridWidth(4), 4);
  assert.equal(clampGridWidth(0), MIN_GRID_WIDTH);
  assert.equal(clampGridWidth(-3), MIN_GRID_WIDTH);
  assert.equal(clampGridWidth(9), MAX_GRID_WIDTH);
  assert.equal(clampGridWidth(2.4), 2);
  assert.equal(clampGridWidth(2.6), 3);
});

test('a numeric string is accepted, because a select hands back strings', () => {
  assert.equal(clampGridWidth('3'), 3);
  assert.equal(clampGridWidth(' 4 '), 4);
  assert.equal(clampGridWidth('99'), MAX_GRID_WIDTH);
});

test('a grid width that is not a number falls back to the default, not to the minimum', () => {
  for (const junk of [null, undefined, '', '  ', 'wide', {}, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(clampGridWidth(junk), DEFAULT_GRID_WIDTH, `for ${JSON.stringify(junk)}`);
  }
});

test('hex colours parse in all four lengths', () => {
  assert.deepEqual(parseColor('#fff'), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(parseColor('#7fd4ff'), { r: 127, g: 212, b: 255, a: 1 });
  assert.deepEqual(parseColor('#0000'), { r: 0, g: 0, b: 0, a: 0 });
  const alpha = parseColor('#7fd4ff80');
  assert.equal(alpha.r, 127);
  assert.equal(alpha.b, 255);
  assert.ok(Math.abs(alpha.a - 128 / 255) < 1e-9);
});

test('hex colours are case-insensitive and tolerate surrounding space', () => {
  assert.deepEqual(parseColor('  #7FD4FF  '), { r: 127, g: 212, b: 255, a: 1 });
});

test('rgb and rgba parse in both the comma and the space separated form', () => {
  assert.deepEqual(parseColor('rgb(1, 2, 3)'), { r: 1, g: 2, b: 3, a: 1 });
  assert.deepEqual(parseColor('rgba(1, 2, 3, 0.5)'), { r: 1, g: 2, b: 3, a: 0.5 });
  assert.deepEqual(parseColor('rgb(1 2 3)'), { r: 1, g: 2, b: 3, a: 1 });
  assert.deepEqual(parseColor('rgb(1 2 3 / 0.25)'), { r: 1, g: 2, b: 3, a: 0.25 });
});

test('a colour the parser does not understand is null, never a guess', () => {
  for (const junk of [
    'light-dark(#fff, #000)',
    'var(--alive)',
    'oklch(0.7 0.1 200)',
    '#gggggg',
    '#ff',
    '#fffff',
    'rgb(1, 2)',
    'rgb(1, 2, 3, 4, 5)',
    'rgb(300, 0, 0)',
    'rgba(0, 0, 0, 2)',
    'rgb(a, b, c)',
    'transparent',
    '',
    null,
    42,
  ]) {
    assert.equal(parseColor(junk), null, `for ${JSON.stringify(junk)}`);
  }
});

test('a parsed colour renders back to CSS, with alpha only when it matters', () => {
  assert.equal(toCssColor(parseColor('#7fd4ff')), 'rgb(127, 212, 255)');
  assert.equal(toCssColor(parseColor('rgba(0, 0, 0, 0.16)')), 'rgba(0, 0, 0, 0.16)');
  assert.equal(toCssColor(null), null);
});

test('a line width is a whole number of device pixels', () => {
  for (const dpr of [1, 1.25, 1.5, 2, 3]) {
    for (const width of GRID_WIDTHS) {
      const css = deviceLineWidth(width, dpr);
      const device = css * dpr;
      assert.ok(Math.abs(device - Math.round(device)) < 1e-9, `${width} px at dpr ${dpr} -> ${device}`);
      assert.ok(device >= 1);
    }
  }
});

test('a line width never falls below one device pixel', () => {
  assert.equal(deviceLineWidth(0, 1), 1);
  assert.equal(deviceLineWidth(1, 8), 0.125 * 8);
  assert.ok(deviceLineWidth(1, 8) * 8 >= 1);
});

test('a line width survives a missing or absurd device pixel ratio', () => {
  assert.equal(deviceLineWidth(2, 0), 2);
  assert.equal(deviceLineWidth(2, -1), 2);
  assert.equal(deviceLineWidth(2, Number.NaN), 2);
  assert.equal(deviceLineWidth(2, undefined), 2);
});

test('an odd line covers half a device pixel either side of its centre', () => {
  // Width 3 at dpr 1: the centre belongs on n + 0.5.
  assert.equal(snapLineCenter(10.4, 1, 3), 10.5);
  assert.equal(snapLineCenter(10.6, 1, 3), 11.5);
});

test('an even line is centred on a whole device pixel', () => {
  // Width 2 at dpr 1: the centre belongs on an integer, so both covered
  // device pixels are fully inside the stroke.
  assert.equal(snapLineCenter(10.4, 1, 2), 10);
  assert.equal(snapLineCenter(10.6, 1, 2), 11);
});

test('snapping happens in device pixels, not CSS pixels', () => {
  // At dpr 2 a 1 CSS px line is 2 device px wide — even — so the centre lands
  // on a whole device pixel, which is a half CSS pixel.
  assert.equal(snapLineCenter(10, 2, 1), 10);
  assert.equal(snapLineCenter(10.3, 2, 1), 10.5);
});

test('readStored returns a string and tolerates every broken storage', () => {
  const store = workingStorage({ [THEME_STORAGE_KEY]: 'light' });
  assert.equal(readStored(THEME_STORAGE_KEY, store), 'light');
  assert.equal(readStored('absent', store), null);
  assert.equal(readStored(THEME_STORAGE_KEY, null), null);
  assert.equal(readStored(THEME_STORAGE_KEY, undefined), null);
  assert.equal(readStored(THEME_STORAGE_KEY, {}), null);
  assert.equal(
    readStored(THEME_STORAGE_KEY, {
      getItem() {
        throw new Error('storage is disabled');
      },
    }),
    null,
  );
});

test('writeStored reports whether the choice could be remembered', () => {
  const store = workingStorage();
  assert.equal(writeStored(THEME_STORAGE_KEY, 'dark', store), true);
  assert.equal(store.entries()[THEME_STORAGE_KEY], 'dark');
  assert.equal(writeStored(THEME_STORAGE_KEY, 'dark', null), false);
  assert.equal(
    writeStored(THEME_STORAGE_KEY, 'dark', {
      setItem() {
        throw new Error('quota exceeded');
      },
    }),
    false,
  );
});

test('a choice round-trips through storage and can be taken back', () => {
  const store = workingStorage();
  assert.equal(resolveTheme(readStored(THEME_STORAGE_KEY, store), true), 'dark');

  writeStored(THEME_STORAGE_KEY, 'light', store);
  assert.equal(resolveTheme(readStored(THEME_STORAGE_KEY, store), true), 'light');

  clearStored(THEME_STORAGE_KEY, store);
  assert.equal(readStored(THEME_STORAGE_KEY, store), null);
  assert.equal(resolveTheme(readStored(THEME_STORAGE_KEY, store), true), 'dark');

  assert.equal(clearStored(THEME_STORAGE_KEY, null), false);
  assert.equal(
    clearStored(THEME_STORAGE_KEY, {
      removeItem() {
        throw new Error('storage is disabled');
      },
    }),
    false,
  );
});

test('a grid width round-trips through storage as a string', () => {
  const store = workingStorage();
  writeStored(GRID_WIDTH_STORAGE_KEY, String(4), store);
  assert.equal(clampGridWidth(readStored(GRID_WIDTH_STORAGE_KEY, store)), 4);
});
