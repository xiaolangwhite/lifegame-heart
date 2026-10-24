/**
 * The representation choice, asserted at the two measured anchors and between
 * them.
 *
 * The anchors are the point. A rule that chooses tiled for anything above 4,000
 * cells would switch the spread-out shape — the measurement says it loses there
 * — and a rule that chooses sparse for everything would never use the storage
 * the project built for the packed shape. The cases below pin both ends.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TILED_MIN_DENSITY,
  TILED_MIN_POPULATION,
  boundsOf,
  chooseRepresentation,
  densityOf,
  hasMeasuredOpinion,
  needsSwitch,
} from '../representation.mjs';

/** A packed lattice: `width` cells across, blocks side by side. */
function packed(count, width) {
  const cells = [];
  for (let index = 0; index < count; index += 1) {
    cells.push([index % width, Math.floor(index / width)]);
  }
  return cells;
}

/** The same number of cells spread one per row and column, so the box is huge. */
function spread(count) {
  const cells = [];
  for (let index = 0; index < count; index += 1) {
    cells.push([index * 2, index * 2]);
  }
  return cells;
}

test('an empty live set keeps the running representation', () => {
  assert.equal(chooseRepresentation([], ['sparse', 'tiled'], 'tiled'), 'tiled');
  assert.equal(chooseRepresentation([], ['sparse', 'tiled'], 'sparse'), 'sparse');
  assert.equal(boundsOf([]), null);
  assert.equal(densityOf([]), 0);
});

test('the measured packed shape chooses tiled above the population crossover', () => {
  const cells = packed(TILED_MIN_POPULATION, 64);
  assert.ok(densityOf(cells) >= TILED_MIN_DENSITY);
  assert.equal(chooseRepresentation(cells, ['sparse', 'tiled']), 'tiled');
});

test('the measured spread shape stays sparse at the same population', () => {
  const cells = spread(TILED_MIN_POPULATION);
  assert.ok(densityOf(cells) < TILED_MIN_DENSITY);
  assert.equal(chooseRepresentation(cells, ['sparse', 'tiled']), 'sparse');
});

test('below the measured crossover the sparse world wins whatever the density', () => {
  const cells = packed(TILED_MIN_POPULATION - 1, 64);
  assert.equal(chooseRepresentation(cells, ['sparse', 'tiled']), 'sparse');
});

test('the density boundary is inclusive and sits between the two measured shapes', () => {
  const side = 283;
  const area = side * side;
  const atBoundary = Math.ceil(TILED_MIN_DENSITY * area);
  const fillBox = (count) => {
    const cells = [];
    for (let y = 0; y < side && cells.length < count; y += 1) {
      for (let x = 0; x < side && cells.length < count; x += 1) cells.push([x, y]);
    }
    // The far corner is what makes the bounding box the whole square.
    cells[cells.length - 1] = [side - 1, side - 1];
    return cells;
  };
  assert.ok(atBoundary >= TILED_MIN_POPULATION);
  assert.ok(densityOf(fillBox(atBoundary)) >= TILED_MIN_DENSITY);
  assert.equal(chooseRepresentation(fillBox(atBoundary), ['sparse', 'tiled']), 'tiled');
  assert.ok(densityOf(fillBox(atBoundary - 1)) < TILED_MIN_DENSITY);
  assert.equal(chooseRepresentation(fillBox(atBoundary - 1), ['sparse', 'tiled']), 'sparse');
});

test('a core that offers no tiled storage is never asked for it', () => {
  const cells = packed(10000, 110);
  assert.equal(chooseRepresentation(cells, ['sparse']), 'sparse');
  assert.equal(chooseRepresentation(cells, ['sparse', 'tiled']), 'tiled');
});

test('bounds and density are computed from the cells, not from a claimed size', () => {
  assert.deepEqual(boundsOf([[5, 7], [9, 7], [5, 10]]), {
    minX: 5,
    minY: 7,
    width: 5,
    height: 4,
  });
  assert.equal(densityOf([[5, 7], [9, 7], [5, 10]]), 3 / 20);
  assert.equal(boundsOf([[1, 1]]).width, 1);
});

test('a switch is reported only when the choice differs from the running one', () => {
  assert.equal(needsSwitch('tiled', 'sparse'), true);
  assert.equal(needsSwitch('sparse', 'sparse'), false);
});

test('the measurement speaks only at or above the population crossover', () => {
  assert.equal(hasMeasuredOpinion(0), false);
  assert.equal(hasMeasuredOpinion(TILED_MIN_POPULATION - 1), false);
  assert.equal(hasMeasuredOpinion(TILED_MIN_POPULATION), true);
  assert.equal(hasMeasuredOpinion(Number.NaN), false);
});
