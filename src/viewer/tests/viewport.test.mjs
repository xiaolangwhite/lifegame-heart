/**
 * The viewport arithmetic, asserted exactly.
 *
 * These are the decisions that used to live in app.js, where the only way to
 * check one was to run a browser. They are pure functions now, so the properties
 * that matter can be stated as equalities rather than as "close enough after
 * rounding": the world point under the pointer does not move when the wheel
 * turns, a drag translates by exactly the world distance it covers, and the zoom
 * limit is the encoder's rule rather than a guess.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_PIXELS_PER_CELL,
  DRAG_THRESHOLD_PX,
  MAX_FRAME_CELLS,
  MIN_SPAN,
  centreViewport,
  clamp,
  clampViewport,
  defaultSpan,
  frameRequest,
  gestureSample,
  isClick,
  maxSpan,
  panByPixels,
  pinchViewport,
  pointerCentroid,
  pointerSpread,
  scaleFor,
  screenToWorld,
  viewCentre,
  visibleHeight,
  worldCentre,
  zoomAt,
} from '../public/viewport.mjs';

// -- touch gestures --------------------------------------------------------
//
// A pinch is two properties at once: the span scales by how far the fingers
// spread, and the world point under the point between them does not move — which
// is also how a two-finger drag pans. Both are asserted as equalities, because
// "the view slides a little" is exactly the defect this file exists to catch.

/** A fixed rectangle, as `getBoundingClientRect` would report one. */
const GESTURE_RECT = { left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 };

function sample(x1, y1, x2, y2) {
  return gestureSample([
    { x: x1, y: y1 },
    { x: x2, y: y2 },
  ]);
}

test('the centroid of two fingers is the point between them', () => {
  assert.deepEqual(pointerCentroid([{ x: 10, y: 20 }, { x: 30, y: 40 }]), { x: 20, y: 30 });
  assert.deepEqual(pointerCentroid([]), null);
  assert.deepEqual(pointerCentroid([{ x: 5, y: 5 }]), { x: 5, y: 5 });
});

test('the spread of two fingers is half the distance between them', () => {
  assert.equal(pointerSpread([{ x: 0, y: 0 }, { x: 10, y: 0 }]), 5);
  // A single contact has no spread, which is what keeps a pinch from dividing
  // by zero when a finger is lifted mid-gesture.
  assert.equal(pointerSpread([{ x: 0, y: 0 }]), 0);
  assert.equal(pointerSpread([]), 0);
});

test('the world point under the pinch midpoint does not move', () => {
  const viewport = { x0: 12, y0: 7, span: 128 };
  const before = sample(300, 200, 500, 400); // midpoint (400, 300)
  const after = sample(200, 100, 600, 500); // same midpoint, twice the spread
  const next = pinchViewport({
    viewport,
    rect: GESTURE_RECT,
    cssWidth: 800,
    before,
    after,
    minSpan: MIN_SPAN,
    spanLimit: 4096,
  });
  const anchorBefore = screenToWorld({
    clientX: 400,
    clientY: 300,
    rect: GESTURE_RECT,
    cssWidth: 800,
    cssHeight: 600,
    frame: { x0: viewport.x0, y0: viewport.y0, w: viewport.span, h: viewport.span * 0.75 },
  });
  const anchorAfter = screenToWorld({
    clientX: 400,
    clientY: 300,
    rect: GESTURE_RECT,
    cssWidth: 800,
    cssHeight: 600,
    frame: { x0: next.x0, y0: next.y0, w: next.span, h: next.span * 0.75 },
  });
  assert.deepEqual(anchorAfter, anchorBefore);
  assert.equal(next.span, 64, 'twice the spread means half the span');
});

test('fingers moving together pan without changing the span', () => {
  const viewport = { x0: 100, y0: 50, span: 200 };
  const before = sample(100, 100, 200, 100); // midpoint (150, 100), spread 50
  const after = sample(180, 100, 280, 100); // midpoint (230, 100), spread 50
  const next = pinchViewport({
    viewport,
    rect: GESTURE_RECT,
    cssWidth: 800,
    before,
    after,
    minSpan: MIN_SPAN,
    spanLimit: 4096,
  });
  assert.equal(next.span, 200);
  // 80 pixels at 200 cells across 800 pixels is 20 world cells, to the left.
  assert.equal(next.x0, 80);
  assert.equal(next.y0, 50);
});

test('a pinch respects both zoom bounds and never returns a broken span', () => {
  const base = { x0: 0, y0: 0, span: 100 };
  const tighter = pinchViewport({
    viewport: base,
    rect: GESTURE_RECT,
    cssWidth: 800,
    before: sample(0, 0, 100, 0),
    after: sample(0, 0, 10000, 0),
    minSpan: MIN_SPAN,
    spanLimit: 4096,
  });
  assert.equal(tighter.span, MIN_SPAN);

  const looser = pinchViewport({
    viewport: base,
    rect: GESTURE_RECT,
    cssWidth: 800,
    before: sample(0, 0, 10000, 0),
    after: sample(0, 0, 1, 0),
    minSpan: MIN_SPAN,
    spanLimit: 4096,
  });
  assert.equal(looser.span, 4096);

  // Two fingers exactly on top of each other: no spread to divide by, so the
  // gesture is a pan and the span must not become NaN or infinite.
  const degenerate = pinchViewport({
    viewport: base,
    rect: GESTURE_RECT,
    cssWidth: 800,
    before: gestureSample([{ x: 10, y: 10 }, { x: 10, y: 10 }]),
    after: gestureSample([{ x: 20, y: 10 }, { x: 20, y: 10 }]),
    minSpan: MIN_SPAN,
    spanLimit: 4096,
  });
  assert.ok(Number.isFinite(degenerate.span), 'the span must stay a number');
  assert.equal(degenerate.span, 100);
});

const CANVAS = { cssWidth: 800, cssHeight: 600 };
const aspect = CANVAS.cssHeight / CANVAS.cssWidth;
const BIG = { width: 65536, height: 65536 };
const RECT = { left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 };

test('clamp is inclusive at both ends', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(11, 0, 10), 10);
});

test('the visible height follows the canvas aspect, not the span', () => {
  assert.equal(visibleHeight(800, 800, 600), 600);
  assert.equal(visibleHeight(1000, 800, 400), 500);
});

test('a sparse world may be viewed whole', () => {
  // The coordinate encoding is chosen while live * 64 <= area, and the whole
  // 65536-squared world satisfies that at a few thousand cells, so nothing
  // bounds the zoom-out.
  const span = maxSpan({ ...CANVAS, population: 5_000, world: BIG });
  assert.equal(span, BIG.width);
});

test('a dense world is bounded by the bitmap budget', () => {
  // At a high population the coordinate encoding is no longer guaranteed, so the
  // limit becomes the largest rectangle whose bitmap is affordable.
  const span = maxSpan({ ...CANVAS, population: 40_000_000, world: BIG });
  assert.equal(span, Math.floor(Math.sqrt(MAX_FRAME_CELLS / aspect)));
  assert.ok(span * span * aspect <= MAX_FRAME_CELLS + span, 'the limit respects the budget');
});

test('the zoom limit never falls below the minimum span', () => {
  const span = maxSpan({ ...CANVAS, population: 10 ** 12, world: { width: 4, height: 4 } });
  assert.ok(span >= MIN_SPAN);
});

test('clamping a viewport keeps it inside the world', () => {
  const viewport = { x0: -500, y0: -500, span: 1024 };
  clampViewport(viewport, BIG, CANVAS.cssWidth, CANVAS.cssHeight);
  assert.equal(viewport.x0, 0);
  assert.equal(viewport.y0, 0);

  const far = { x0: 10 ** 6, y0: 10 ** 6, span: 1024 };
  clampViewport(far, BIG, CANVAS.cssWidth, CANVAS.cssHeight);
  assert.equal(far.x0, BIG.width - 1024);
  assert.equal(far.y0, BIG.height - 1024 * aspect);
});

test('a frame request is the viewport rounded to whole cells', () => {
  const viewport = { x0: 100.7, y0: 200.2, span: 1024 };
  const { frame, zoomLimited } = frameRequest({
    viewport,
    world: BIG,
    ...CANVAS,
    population: 10,
  });
  assert.deepEqual(frame, { x0: 100, y0: 200, w: 1024, h: 768 });
  assert.equal(zoomLimited, false);
});

test('a frame request pulls the view in when the population outgrows it', () => {
  // A viewport that was legal over a sparse world stops being legal once the
  // world fills up. The request degrades instead of being refused.
  const viewport = { x0: 0, y0: 0, span: 60000 };
  const limit = maxSpan({ ...CANVAS, population: 40_000_000, world: BIG });
  const { frame, zoomLimited, span } = frameRequest({
    viewport,
    world: BIG,
    ...CANVAS,
    population: 40_000_000,
  });
  assert.equal(zoomLimited, true);
  assert.equal(span, limit);
  assert.equal(frame.w, limit);
  assert.equal(frame.h, Math.round(limit * aspect));
});

test('a frame request never asks for a zero-sized rectangle', () => {
  const { frame } = frameRequest({
    viewport: { x0: 0, y0: 0, span: defaultSpan(800) },
    world: { width: 4, height: 4 },
    ...CANVAS,
    population: 0,
  });
  assert.ok(frame.w >= 1);
  assert.ok(frame.h >= 1);
  assert.ok(frame.w <= 4);
});

// -- the default view ------------------------------------------------------
//
// The view a canvas opens with is one cell per `DEFAULT_PIXELS_PER_CELL` CSS
// pixels across, and the world's centre is in the middle of it. These are the
// two halves of the requirement, asserted as equalities: a wider canvas shows
// proportionally more of the world rather than the same world stretched, and
// the middle of the world is the middle of the viewport at any aspect.

test('the default span is the canvas width over the pixels per cell', () => {
  assert.equal(DEFAULT_PIXELS_PER_CELL, 60);
  assert.equal(defaultSpan(800), 800 / 60);
  assert.equal(defaultSpan(1920), 32);
  // A canvas twice as wide opens on twice as many world cells: the cell a person
  // sees is the same size on both screens.
  assert.equal(defaultSpan(1600) / defaultSpan(800), 2);
  // A canvas with no size has no view, rather than an infinite or a negative
  // one; the caller is expected to check before it asks for a frame.
  assert.equal(defaultSpan(0), 0);
  assert.equal(defaultSpan(-100), 0);
  assert.equal(defaultSpan(Number.NaN), 0);
  // A nonsensical number of pixels per cell falls back to the declared rule.
  assert.equal(defaultSpan(800, 0), 800 / 60);
  assert.equal(defaultSpan(800, 'wide'), 800 / 60);
});

test('the world centre is the middle of a described world, and null otherwise', () => {
  assert.deepEqual(worldCentre({ width: 64, height: 48 }), { x: 32, y: 24 });
  assert.deepEqual(worldCentre({ width: 65536, height: 65536 }), { x: 32768, y: 32768 });
  assert.equal(worldCentre(null), null);
  assert.equal(worldCentre({ width: 64 }), null);
  assert.equal(worldCentre({ width: 'wide', height: 48 }), null);
});

test('centring puts the point in the middle of the canvas, at any aspect', () => {
  const world = { width: 65536, height: 65536 };
  for (const [cssWidth, cssHeight] of [
    [800, 600],
    [600, 800],
    [800, 800],
    [1000, 400],
  ]) {
    const span = defaultSpan(cssWidth);
    const viewport = centreViewport({ point: { x: 32768, y: 32768 }, span, cssWidth, cssHeight, world });
    const middle = viewCentre(viewport, cssWidth, cssHeight);
    assert.ok(
      Math.abs(middle.x - 32768) <= 0.5 && Math.abs(middle.y - 32768) <= 0.5,
      `the world centre moved at ${cssWidth}x${cssHeight}: ${JSON.stringify(middle)}`,
    );
  }
});

test('the default view of a square canvas is the given span formula', () => {
  // The requirement states the origin as `round(size / 2 - span / 2)` for both
  // axes. That is exactly what centring means on a square canvas, where the
  // visible height *is* the span; `centreViewport` generalises it to the canvas
  // actually in front of the user, where the visible height is
  // `span * cssHeight / cssWidth`.
  const world = { width: 64, height: 64 };
  const span = defaultSpan(600);
  const viewport = centreViewport({ point: worldCentre(world), span, cssWidth: 600, cssHeight: 600, world });
  assert.equal(span, 10);
  assert.equal(viewport.x0, Math.round(64 / 2 - span / 2));
  assert.equal(viewport.y0, Math.round(64 / 2 - span / 2));
});

test('centring a point near an edge stops at the edge rather than outside it', () => {
  const world = { width: 64, height: 64 };
  const span = defaultSpan(600);
  const corner = centreViewport({ point: { x: 0, y: 0 }, span, cssWidth: 600, cssHeight: 600, world });
  assert.equal(corner.x0, 0);
  assert.equal(corner.y0, 0);
  const far = centreViewport({ point: { x: 10 ** 6, y: 10 ** 6 }, span, cssWidth: 600, cssHeight: 600, world });
  assert.equal(far.x0, 64 - Math.round(span));
  assert.equal(far.y0, 64 - Math.round(span));
});

test('a viewport\'s centre is the world point it is looking at', () => {
  const viewport = { x0: 100, y0: 200, span: 800 };
  assert.deepEqual(viewCentre(viewport, 800, 600), { x: 500, y: 500 });
  assert.deepEqual(viewCentre(viewport, 800, 400), { x: 500, y: 400 });
});

test('a pointer position maps onto the cell under it', () => {
  // 640 world cells across 800 pixels is 0.8 pixels per cell, so pixel 400 is
  // world column 320.
  const frame = { x0: 0, y0: 0, w: 640, h: 480 };
  assert.deepEqual(
    screenToWorld({ clientX: 400, clientY: 300, rect: GESTURE_RECT, ...CANVAS, frame }),
    { x: 320, y: 240 },
  );
});

test('the canvas offset is taken into account', () => {
  const frame = { x0: 0, y0: 0, w: 800, h: 600 };
  const rect = { left: 50, top: 20, width: 800, height: 600 };
  assert.deepEqual(screenToWorld({ clientX: 50, clientY: 20, rect, ...CANVAS, frame }), { x: 0, y: 0 });
  assert.deepEqual(screenToWorld({ clientX: 450, clientY: 320, rect, ...CANVAS, frame }), { x: 400, y: 300 });
});

test('the frame that was drawn decides the mapping, not the viewport', () => {
  // A frame can be a generation behind the viewport; a click must land on the
  // cell the user can see, which is the drawn frame's.
  const drawn = { x0: 1000, y0: 2000, w: 400, h: 300 };
  assert.deepEqual(
    screenToWorld({ clientX: 800, clientY: 600, rect: GESTURE_RECT, ...CANVAS, frame: drawn }),
    { x: 1000 + 400, y: 2000 + 300 },
  );
});

test('zooming keeps the world point under the pointer fixed', () => {
  // This is the property that makes a wheel gesture feel anchored rather than
  // slippery, and it is an equality, not an approximation: the arithmetic reads
  // the world point at the old scale and puts it back at the new one.
  const viewport = { x0: 1000, y0: 2000, span: 1024 };
  for (const [clientX, clientY] of [[0, 0], [400, 300], [800, 600], [123, 456]]) {
    for (const factor of [0.5, 0.9, 1.0, 1.1, 2.0]) {
      const before = {
        x: viewport.x0 + (clientX / CANVAS.cssWidth) * viewport.span,
        y: viewport.y0 + (clientY / CANVAS.cssHeight) * visibleHeight(viewport.span, CANVAS.cssWidth, CANVAS.cssHeight),
      };
      const next = zoomAt({
        viewport,
        clientX,
        clientY,
        rect: GESTURE_RECT,
        cssWidth: CANVAS.cssWidth,
        factor,
        minSpan: MIN_SPAN,
        spanLimit: 65536,
      });
      const after = {
        x: next.x0 + (clientX / CANVAS.cssWidth) * next.span,
        y: next.y0 + (clientY / CANVAS.cssHeight) * visibleHeight(next.span, CANVAS.cssWidth, CANVAS.cssHeight),
      };
      assert.ok(
        Math.abs(after.x - before.x) < 1e-9 && Math.abs(after.y - before.y) < 1e-9,
        `anchor moved at (${clientX}, ${clientY}) with factor ${factor}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`,
      );
    }
  }
});

test('zooming is bounded by the minimum and the limit', () => {
  const near = zoomAt({
    viewport: { x0: 0, y0: 0, span: 16 },
    clientX: 400,
    clientY: 300,
    rect: GESTURE_RECT,
    cssWidth: 800,
    factor: 0.01,
    minSpan: MIN_SPAN,
    spanLimit: 65536,
  });
  assert.equal(near.span, MIN_SPAN);

  const far = zoomAt({
    viewport: { x0: 0, y0: 0, span: 1024 },
    clientX: 400,
    clientY: 300,
    rect: GESTURE_RECT,
    cssWidth: 800,
    factor: 1000,
    minSpan: MIN_SPAN,
    spanLimit: 2048,
  });
  assert.equal(far.span, 2048);
});

test('a drag translates by the world distance it covers', () => {
  const viewport = { x0: 1000, y0: 2000, span: 800 };
  // 800 world cells across 800 pixels is one cell per pixel, so the arithmetic
  // is readable at a glance.
  panByPixels(viewport, 50, -25, 800);
  assert.equal(viewport.x0, 950);
  assert.equal(viewport.y0, 2025);
});

test('a drag in a zoomed-out view moves further in world cells', () => {
  const near = { x0: 0, y0: 0, span: 800 };
  const far = { x0: 0, y0: 0, span: 8000 };
  panByPixels(near, 10, 0, 800);
  panByPixels(far, 10, 0, 800);
  assert.equal(near.x0, -10);
  assert.equal(far.x0, -100);
});

test('a press is a click until it travels past the threshold', () => {
  assert.equal(isClick(0), true);
  assert.equal(isClick(DRAG_THRESHOLD_PX), true, 'the threshold itself is inclusive');
  assert.equal(isClick(DRAG_THRESHOLD_PX + 1), false);
  assert.equal(isClick(3, 3), true);
  assert.equal(isClick(4, 3), false);
});

test('the drawing scale maps a frame onto the canvas', () => {
  const { scaleX, scaleY } = scaleFor({ w: 400, h: 300 }, 800, 600);
  assert.equal(scaleX, 2);
  assert.equal(scaleY, 2);
});
