/**
 * lifegame viewer — theme resolution, colour parsing and grid-line geometry.
 *
 * Everything here is free of the DOM and of `localStorage`, which are both
 * passed in or read by the caller. That is deliberate: the browser cannot be
 * driven from `node --test`, so every decision the page makes has to be
 * expressible as a function of plain values to be testable at all. What stays
 * in app.js is only the reading of the values this module computes with.
 *
 * The three decisions worth stating out loud:
 *
 * - **Theme.** A stored `'dark'` or `'light'` is an explicit choice and wins.
 *   Anything else — absent, unreadable, or a value from an older build — means
 *   "follow the system", which the caller resolves through `matchMedia`. The
 *   resolution is a pure function of those two inputs, so the precedence is
 *   testable without a browser.
 * - **Storage.** `localStorage` throws in more situations than it looks: a
 *   privacy mode, a disabled cookie jar, a `file://` origin, a full quota.
 *   Reading and writing never throw here; a failed write returns false and the
 *   page simply forgets the choice, which is better than a dead button.
 * - **Grid lines.** A line is crisp when its width is a whole number of
 *   *device* pixels and its centre sits on the device-pixel grid: at
 *   `n + 0.5` device pixels for an odd width, at `n` for an even one. Widths
 *   are therefore expressed in CSS pixels but snapped in device pixels, which
 *   is what `deviceLineWidth` and `snapLineCenter` do.
 */

export const THEME_STORAGE_KEY = 'lifegame.viewer.theme';
export const GRID_WIDTH_STORAGE_KEY = 'lifegame.viewer.gridWidth';

export const THEMES = Object.freeze(['dark', 'light']);
export const GRID_WIDTHS = Object.freeze([1, 2, 3, 4]);
export const DEFAULT_GRID_WIDTH = 2;
export const MIN_GRID_WIDTH = GRID_WIDTHS[0];
export const MAX_GRID_WIDTH = GRID_WIDTHS[GRID_WIDTHS.length - 1];

/** The custom properties the canvas reads. The rest of the palette is CSS-only. */
export const CANVAS_PALETTE_KEYS = Object.freeze(['--alive', '--dead', '--grid']);

/**
 * Whether a stored value is an explicit choice rather than "follow the system".
 *
 * Exported so a caller can ask the question without restating the rule: the
 * system-preference listener needs it, and restating it there is how the two
 * copies drift apart.
 */
export function isExplicitTheme(stored) {
  return THEMES.includes(stored);
}

/**
 * The theme that is in effect, given what was stored and what the system wants.
 *
 * @param {unknown} stored the value read from storage, or anything else
 * @param {boolean} systemPrefersDark `matchMedia('(prefers-color-scheme: dark)')`
 * @returns {'dark' | 'light'}
 */
export function resolveTheme(stored, systemPrefersDark) {
  if (isExplicitTheme(stored)) return stored;
  return systemPrefersDark ? 'dark' : 'light';
}

/** The other theme. Used by the toggle button. */
export function nextTheme(theme) {
  return theme === 'dark' ? 'light' : 'dark';
}

/**
 * A grid width inside the offered range, rounded to whole pixels.
 *
 * A numeric string is accepted because a `<select>` hands back strings; anything
 * that is not a finite number — empty, junk, `null` — falls back to the default
 * rather than to a clamp, so a corrupted value does not silently become 1.
 */
export function clampGridWidth(value) {
  const number = numberOrNull(value);
  if (number === null) return DEFAULT_GRID_WIDTH;
  return Math.min(Math.max(Math.round(number), MIN_GRID_WIDTH), MAX_GRID_WIDTH);
}

function numberOrNull(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text === '') return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

/**
 * Parse a CSS colour into channels, or `null` for anything unrecognised.
 *
 * `getComputedStyle` returns whatever the stylesheet wrote, so the parser has to
 * cope with the notations a palette realistically uses — `#rgb`, `#rrggbb`,
 * with or without an alpha pair, and `rgb()`/`rgba()` in either the comma or the
 * space separated form. Returning `null` rather than a guessed colour is the
 * point: the caller keeps its previous value instead of painting black.
 *
 * @returns {{r: number, g: number, b: number, a: number} | null}
 */
export function parseColor(text) {
  if (typeof text !== 'string') return null;
  const value = text.trim().toLowerCase();
  if (value === '') return null;

  if (value.startsWith('#')) return parseHexColor(value.slice(1));

  const functional = /^rgba?\(([^)]*)\)$/.exec(value);
  if (functional === null) return null;
  return parseFunctionalColor(functional[1]);
}

function parseHexColor(hex) {
  if (!/^[0-9a-f]+$/.test(hex)) return null;
  const expand = (index) => Number.parseInt(hex[index] + hex[index], 16);
  if (hex.length === 3 || hex.length === 4) {
    return {
      r: expand(0),
      g: expand(1),
      b: expand(2),
      a: hex.length === 4 ? expand(3) / 255 : 1,
    };
  }
  if (hex.length === 6 || hex.length === 8) {
    const pair = (index) => Number.parseInt(hex.slice(index, index + 2), 16);
    return {
      r: pair(0),
      g: pair(2),
      b: pair(4),
      a: hex.length === 8 ? pair(6) / 255 : 1,
    };
  }
  return null;
}

function parseFunctionalColor(body) {
  const parts = body.split(/[,\s/]+/).filter((part) => part !== '');
  if (parts.length < 3 || parts.length > 4) return null;
  const channels = parts.slice(0, 3).map((part) => {
    const number = Number(part);
    return Number.isFinite(number) && number >= 0 && number <= 255 ? Math.round(number) : null;
  });
  if (channels.includes(null)) return null;
  let alpha = 1;
  if (parts.length === 4) {
    alpha = Number(parts[3]);
    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) return null;
  }
  return { r: channels[0], g: channels[1], b: channels[2], a: alpha };
}

/** A colour as a CSS string, for `strokeStyle` and `fillStyle`. */
export function toCssColor(color) {
  if (color === null) return null;
  if (color.a >= 1) return `rgb(${color.r}, ${color.g}, ${color.b})`;
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a})`;
}

/**
 * The configured width in CSS pixels, snapped to a whole number of device
 * pixels so the stroke has no partially covered edge to blur.
 */
export function deviceLineWidth(cssWidth, dpr) {
  const scale = validDpr(dpr);
  const clamped = clampGridWidth(cssWidth);
  return Math.max(1, Math.round(clamped * scale)) / scale;
}

/**
 * Where a line's centre belongs so that it covers whole device pixels.
 *
 * The returned coordinate is in CSS pixels, because the canvas context is
 * scaled by the device pixel ratio before anything is drawn.
 */
export function snapLineCenter(cssPosition, dpr, cssLineWidth) {
  const scale = validDpr(dpr);
  const deviceWidth = Math.max(1, Math.round(deviceLineWidth(cssLineWidth, scale) * scale));
  const devicePosition = Math.round(cssPosition * scale);
  const centred = deviceWidth % 2 === 1 ? devicePosition + 0.5 : devicePosition;
  return centred / scale;
}

function validDpr(dpr) {
  return typeof dpr === 'number' && Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
}

/** Read a stored string, tolerating a storage that throws or does not exist. */
export function readStored(key, storage) {
  try {
    if (!storage || typeof storage.getItem !== 'function') return null;
    const value = storage.getItem(key);
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

/** Write a stored string; false means the choice could not be remembered. */
export function writeStored(key, value, storage) {
  try {
    if (!storage || typeof storage.setItem !== 'function') return false;
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** Remove a stored key, so the setting returns to following the system. */
export function clearStored(key, storage) {
  try {
    if (!storage || typeof storage.removeItem !== 'function') return false;
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
