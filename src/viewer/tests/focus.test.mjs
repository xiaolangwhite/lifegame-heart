/**
 * The remembered view point: one per session, and shareable by URL.
 *
 * Two pages of one session agree about "where was I" through this module, and a
 * link that names `?focus=x,y` shares that point with another session. The cases
 * below pin the two properties the feature exists for: a point does not leak
 * between sessions by accident, and the sharing is explicit rather than a second
 * hidden store.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FOCUS_PARAM,
  FOCUS_STORAGE_KEY,
  focusFromLocation,
  focusStorageKey,
  readFocus,
  readSharedFocus,
  writeFocus,
} from '../public/focus.mjs';

/** An in-memory storage with the methods the theme layer's helpers use. */
function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    values,
  };
}

test('the default session keeps the original key and a named session has its own', () => {
  assert.equal(focusStorageKey('main'), FOCUS_STORAGE_KEY);
  assert.equal(focusStorageKey(undefined), FOCUS_STORAGE_KEY);
  assert.equal(focusStorageKey('s1'), `${FOCUS_STORAGE_KEY}.s1`);
});

test('a point round-trips within one session and is not visible in another', () => {
  const store = storage();
  assert.equal(writeFocus(store, { x: 12.4, y: -3.6 }, 's1'), true);
  assert.deepEqual(readFocus(store, 's1'), { x: 12, y: -4 });
  assert.equal(readFocus(store, 's2'), null);
  assert.equal(readFocus(store, 'main'), null);
});

test('an unreadable entry is no memory rather than the origin', () => {
  const store = storage();
  store.setItem(`${FOCUS_STORAGE_KEY}.s1`, 'not a point');
  assert.equal(readFocus(store, 's1'), null);
});

test('a URL shares a point, and a malformed one is ignored', () => {
  assert.deepEqual(readSharedFocus('?session=s1&focus=10,20'), { x: 10, y: 20 });
  assert.deepEqual(readSharedFocus(`?${FOCUS_PARAM}=-4.5,3`), { x: -4.5, y: 3 });
  assert.equal(readSharedFocus('?focus=nope'), null);
  assert.equal(readSharedFocus('?session=s1'), null);
  assert.equal(readSharedFocus(''), null);
});

test('reading the shared point needs no browser location', () => {
  assert.equal(focusFromLocation(), null);
});

test('a shared point is stored for the session that loads the link', () => {
  const store = storage();
  const shared = readSharedFocus('?focus=7,8');
  assert.deepEqual(shared, { x: 7, y: 8 });
  writeFocus(store, shared, 's1');
  assert.deepEqual(readFocus(store, 's1'), { x: 7, y: 8 });
});
