/**
 * The pure editing tools: lines, rectangles, transforms and the stamp operation.
 *
 * These are the arithmetic a person would otherwise have to check by eye on a
 * canvas, so they are asserted exactly here.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

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
  transformSnippet,
} from '../public/edit-tools.mjs';

test('a box normalises its corners and includes both ends', () => {
  assert.deepEqual(boxOf([5, 7], [2, 3]), { x: 2, y: 3, w: 4, h: 5 });
  assert.deepEqual(rectCells([2, 3], [4, 4]), [
    [2, 3],
    [3, 3],
    [4, 3],
    [2, 4],
    [3, 4],
    [4, 4],
  ]);
});

test('a line includes both ends and stays connected on a steep slope', () => {
  assert.deepEqual(lineCells([0, 0], [3, 0]), [
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
  ]);
  const steep = lineCells([2, 0], [2, 4]);
  assert.deepEqual(steep, [
    [2, 0],
    [2, 1],
    [2, 2],
    [2, 3],
    [2, 4],
  ]);
  const diagonal = lineCells([0, 0], [3, 3]);
  assert.deepEqual(diagonal, [
    [0, 0],
    [1, 1],
    [2, 2],
    [3, 3],
  ]);
  // Consecutive cells differ by at most one in each axis: no gaps for a stroke.
  for (let index = 1; index < diagonal.length; index += 1) {
    assert.ok(Math.abs(diagonal[index][0] - diagonal[index - 1][0]) <= 1);
    assert.ok(Math.abs(diagonal[index][1] - diagonal[index - 1][1]) <= 1);
  }
});

test('a stroke only reports cells it has not already sent', () => {
  assert.deepEqual(
    newCells([[1, 1], [2, 2]], [[2, 2], [3, 3]]),
    [[3, 3]],
  );
});

test('every transform maps the box and the cells exactly', () => {
  const lShape = { cells: [[0, 0], [1, 0], [0, 1]], width: 2, height: 2 };
  assert.deepEqual(transformSnippet(lShape, 'none'), lShape);
  assert.deepEqual(transformSnippet(lShape, 'rotate90'), {
    cells: [[0, 0], [1, 0], [1, 1]],
    width: 2,
    height: 2,
  });
  assert.deepEqual(transformSnippet(lShape, 'rotate180'), {
    cells: [[1, 0], [0, 1], [1, 1]],
    width: 2,
    height: 2,
  });
  assert.deepEqual(transformSnippet(lShape, 'rotate270'), {
    cells: [[0, 0], [0, 1], [1, 1]],
    width: 2,
    height: 2,
  });
  assert.deepEqual(transformSnippet(lShape, 'flipH'), {
    cells: [[0, 0], [1, 0], [1, 1]],
    width: 2,
    height: 2,
  });
  assert.deepEqual(transformSnippet(lShape, 'flipV'), {
    cells: [[0, 0], [0, 1], [1, 1]],
    width: 2,
    height: 2,
  });

  // A rotation swaps the sides of a non-square box.
  const bar = { cells: [[0, 0], [1, 0], [2, 0]], width: 3, height: 1 };
  const rotated = transformSnippet(bar, 'rotate90');
  assert.equal(rotated.width, 1);
  assert.equal(rotated.height, 3);
  assert.deepEqual(rotated.cells, [
    [0, 0],
    [0, 1],
    [0, 2],
  ]);
});

test('a stamp operation carries a fill with relative cells', () => {
  const operation = stampOperation({
    snippet: { cells: [[0, 0], [1, 0]], width: 2, height: 1 },
    x: 5,
    y: 7,
    transform: 'flipV',
    mode: 'merge',
  });
  assert.deepEqual(operation, {
    kind: 'fill',
    box: { x: 5, y: 7, w: 2, h: 1 },
    cells: [[0, 0], [1, 0]],
    mode: 'merge',
  });
});

test('the tool and mode vocabularies are closed and a box is bounded by its world', () => {
  assert.deepEqual(EDIT_TOOLS, ['paint', 'erase', 'line', 'rect', 'select', 'stamp', 'pan']);
  assert.deepEqual(SNIPPET_MODES, ['overwrite', 'merge']);
  assert.equal(SNIPPET_TRANSFORMS.length, 6);
  assert.throws(() => transformSnippet({ cells: [], width: 1, height: 1 }, 'spin'));
  assert.throws(() => stampOperation({ snippet: { cells: [], width: 1, height: 1 }, x: 0, y: 0, mode: 'melt' }));
  assert.equal(boxFits({ x: 0, y: 0, w: 4, h: 4 }, { width: 4, height: 4 }), true);
  assert.equal(boxFits({ x: 4, y: 0, w: 1, h: 1 }, { width: 4, height: 4 }), false);
});
