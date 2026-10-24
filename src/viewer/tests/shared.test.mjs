/**
 * The values the browser and the service must agree on.
 *
 * `public/shared.mjs` is imported by both sides, so these tests are about the
 * rule and about what happens when the core declares nothing: a bound that was
 * not declared must read as `null`, never as a plausible number, because a page
 * that offers a rate the core refuses is a page that lies.
 *
 * **There is no default view here any more.** The view a page opens with is a
 * function of its own canvas, so its one declaration is in `viewport.mjs` and
 * its tests are in `viewport.test.mjs`. A fixed span here would be the second
 * declaration, and the page and the service could disagree about it.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_CELLS_FOR_NEAREST,
  MAX_FRAME_CELLS,
  NO_LIMITS,
  clampTicksPerSecond,
  frameAdmission,
  readLimits,
} from '../public/shared.mjs';

test('the frame budget is the documented one', () => {
  assert.equal(MAX_FRAME_CELLS, 16 * 1024 * 1024);
});

test('the live-set cap is the documented one', () => {
  // One `export` payload per selection, eight bytes per cell before base64: the
  // cap is what keeps a click on a node from asking the core for a payload
  // proportional to the population of a design-target world. The value is
  // declared here because the service applies it and the page reports it.
  assert.equal(MAX_CELLS_FOR_NEAREST, 16384);
  assert.equal(MAX_CELLS_FOR_NEAREST * 8, 131072, 'the raw payload the cap allows');
});

test('a sparse rectangle is admissible at any size', () => {
  // The coordinate encoding never builds a dense grid, so the cap does not
  // apply: this is what makes viewing the whole world possible.
  assert.equal(frameAdmission({ area: 65536 * 65536, population: 1000 }), null);
});

test('a dense rectangle over the budget is refused', () => {
  const refusal = frameAdmission({ area: MAX_FRAME_CELLS + 1, population: 10_000_000 });
  assert.notEqual(refusal, null);
  assert.equal(refusal.error, 'bad_request');
  assert.match(refusal.message, /exceeds/);
});

test('the admission rule has three regimes and the boundary is exact', () => {
  // Over the budget, the coordinate encoding is what saves the request:
  // `live * 64 <= area` guarantees it, and one cell more does not.
  const overBudget = MAX_FRAME_CELLS + 1;
  const guaranteed = Math.floor(overBudget / 64);
  assert.equal(
    frameAdmission({ area: overBudget, population: guaranteed }),
    null,
    'at the boundary the coordinate encoding is still guaranteed',
  );
  const refusal = frameAdmission({ area: overBudget, population: guaranteed + 1 });
  assert.notEqual(refusal, null, 'one cell past the boundary must be refused');
  assert.equal(refusal.error, 'bad_request');

  // At or under the budget, the area cap alone admits it, however dense.
  assert.equal(
    frameAdmission({ area: MAX_FRAME_CELLS, population: MAX_FRAME_CELLS }),
    null,
    'the budget itself is admissible whatever the population',
  );
  assert.equal(
    frameAdmission({ area: overBudget, population: 10_000_000, maxFrameCells: overBudget }),
    null,
    'raising the cap admits the same request',
  );
});

test('a core that declares nothing yields nulls, not defaults', () => {
  assert.deepEqual({ ...readLimits(null) }, { ...NO_LIMITS });
  assert.deepEqual({ ...readLimits({}) }, { ...NO_LIMITS });
  assert.deepEqual({ ...readLimits({ limits: null }) }, { ...NO_LIMITS });
  assert.equal(readLimits(null).ticksPerSecond, null);
});

test('declared limits are read as declared', () => {
  const limits = readLimits({
    limits: {
      ticksPerSecond: { min: 1, max: 60 },
      stepsPerRequest: 100000,
      maxCoordinate: 65535,
      representations: ['sparse', 'tiled'],
    },
  });
  assert.deepEqual(limits.ticksPerSecond, { min: 1, max: 60 });
  assert.equal(limits.stepsPerRequest, 100000);
  assert.equal(limits.maxCoordinate, 65535);
  assert.deepEqual(limits.representations, ['sparse', 'tiled']);
});

test('a nonsensical tick range is treated as undeclared', () => {
  assert.equal(readLimits({ limits: { ticksPerSecond: { min: 60, max: 1 } } }).ticksPerSecond, null);
  assert.equal(readLimits({ limits: { ticksPerSecond: { min: 0, max: 60 } } }).ticksPerSecond, null);
  assert.equal(readLimits({ limits: { ticksPerSecond: { min: 1 } } }).ticksPerSecond, null);
  assert.equal(readLimits({ limits: { ticksPerSecond: 'fast' } }).ticksPerSecond, null);
});

test('a nonsense representation list is filtered rather than trusted', () => {
  const limits = readLimits({ limits: { representations: ['sparse', '', 7, 'tiled'] } });
  assert.deepEqual(limits.representations, ['sparse', 'tiled']);
  assert.deepEqual(readLimits({ limits: { representations: 'sparse' } }).representations, []);
});

test('a tick rate is clamped to the declared range, and null without one', () => {
  const limits = readLimits({ limits: { ticksPerSecond: { min: 2, max: 30 } } });
  assert.equal(clampTicksPerSecond(10, limits), 10);
  assert.equal(clampTicksPerSecond(99, limits), 30);
  assert.equal(clampTicksPerSecond(0, limits), 2);
  assert.equal(clampTicksPerSecond('nonsense', limits), 2);
  assert.equal(clampTicksPerSecond(10, NO_LIMITS), null, 'no declared range means no answer');
});
