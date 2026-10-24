/**
 * lifegame viewer — the point in the world a person was last looking at.
 *
 * The world route and the history route are two pages of one session, and the
 * history preview has to answer a question about the world route: *where was I?*
 * A generation is a whole world, and dropping the user into an arbitrary corner
 * of it after they click a node is the difference between "here is that state"
 * and "here is a state, somewhere". So the world page writes the centre of its
 * view here — in world coordinates, not screen ones, so the two pages can
 * disagree about their canvas size and still mean the same place — and the
 * history page reads it to decide what to centre its preview on.
 *
 * **The point belongs to a session, and it can be shared.** A service can run
 * more than one session, and a point that mattered in one world is not
 * information about another, so the entry is keyed by the session id (the default
 * session keeps the original key, so an older page still reads it). A `?focus=x,y`
 * URL parameter is the sharing mechanism: it names a point in world coordinates,
 * the page that loads it stores it for its own session, and the history preview
 * of that session then opens there. That is what makes two sessions able to share
 * a view without sharing a storage entry.
 *
 * Three decisions, all of them about what happens when there is nothing to read:
 *
 * - **It is stored in the browser, not in the core.** The core knows the world,
 *   not where someone was looking at it, and a scroll position is not part of a
 *   generation.
 * - **It is a pair of world coordinates, rounded.** The stored value is
 *   `"x,y"`, so it survives a reload, a route change and a version of this page
 *   that no longer has the same canvas; the precision of a pixel is not
 *   information anyone can use.
 * - **An unreadable value means "no memory", not "the origin".** A missing or
 *   malformed entry returns `null`, and the caller falls back to the world's own
 *   centre; `(0, 0)` is a corner of the world and pretending a corrupt value
 *   named it would put the preview in the wrong place for a reason nobody could
 *   explain.
 */

import { readStored, writeStored } from './theme.mjs';

/** The key the default session uses; older pages read exactly this. */
export const FOCUS_STORAGE_KEY = 'lifegame.viewer.focus';

/** The query parameter that shares a view point by link. */
export const FOCUS_PARAM = 'focus';

/** The key one session's remembered point lives under. */
export function focusStorageKey(sessionId) {
  if (sessionId === null || sessionId === undefined || sessionId === 'main') {
    return FOCUS_STORAGE_KEY;
  }
  return `${FOCUS_STORAGE_KEY}.${sessionId}`;
}

/** The `x,y` form a stored value or a query parameter must have, as a point. */
function parsePoint(raw) {
  if (typeof raw !== 'string') return null;
  const match = /^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/.exec(raw.trim());
  if (match === null) return null;
  const x = Number(match[1]);
  const y = Number(match[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

/** The point a URL names, or `null`. This is the sharing mechanism. */
export function readSharedFocus(search) {
  if (typeof search !== 'string' || search === '') return null;
  try {
    return parsePoint(new URLSearchParams(search).get(FOCUS_PARAM));
  } catch {
    return null;
  }
}

/**
 * The point this page's URL shares, without assuming a `location` exists.
 *
 * A test harness may have no browser at all, and a page that read `location`
 * directly would throw there; the guard keeps the module usable from a plain
 * value.
 */
export function focusFromLocation() {
  try {
    if (typeof location === 'undefined') return null;
    return readSharedFocus(location.search);
  } catch {
    return null;
  }
}

/**
 * The last remembered view centre for one session, or `null`.
 *
 * @param {{getItem: (key: string) => string | null} | null} storage
 * @param {string} [sessionId]
 * @returns {{x: number, y: number} | null}
 */
export function readFocus(storage, sessionId = 'main') {
  return parsePoint(readStored(focusStorageKey(sessionId), storage));
}

/**
 * Remember where the view was centred, for one session. `false` means it could
 * not be stored, which is a smaller problem than a page that stops working
 * without storage.
 */
export function writeFocus(storage, point, sessionId = 'main') {
  if (point === null || point === undefined) return false;
  const x = Math.round(Number(point.x));
  const y = Math.round(Number(point.y));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return writeStored(focusStorageKey(sessionId), `${x},${y}`, storage);
}
