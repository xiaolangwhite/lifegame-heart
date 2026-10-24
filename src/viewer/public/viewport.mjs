/**
 * lifegame viewer — viewport arithmetic, as pure functions.
 *
 * Everything in this file is a decision the page makes about *where it is
 * looking*: how far it may zoom out, how a pointer position maps onto a world
 * cell, where a wheel gesture lands after it rescales the span, and how a drag
 * translates into world coordinates. None of it touches the DOM, the network or
 * the canvas, so `node --test` can execute it — which is the point. The same
 * arithmetic used to live in app.js, where the only way to check it was to run a
 * browser, and where a defect would therefore never be caught by anything.
 *
 * The rules encoded here are the core's, restated where the page has to agree
 * with it:
 *
 * - **A frame's rectangle is its resolution.** `frame(x0, y0, w, h)` returns w
 *   by h world cells at one cell per pixel, so the zoom range is bounded by what
 *   the core can encode, not by aesthetics.
 * - **The encoder picks its encoding by size.** `bridge.py` chooses the
 *   coordinate encoding while `8 * live <= ceil(w / 8) * h`, which is
 *   `live * 64 <= area` up to rounding, and that path never builds a dense
 *   grid. Only a rectangle that cannot take that path is capped, at
 *   `MAX_FRAME_CELLS`.
 *
 * It is also where **the default view** is declared, because that is a rule
 * about the canvas and nothing else holds a canvas: the view a page or a preview
 * opens with is one world cell per `DEFAULT_PIXELS_PER_CELL` CSS pixels across,
 * so a wider canvas shows proportionally more of the world and no fixed number
 * has to be guessed. There is deliberately no second declaration of it: a
 * subscription that has not named a rectangle gets no frame rather than a
 * service-side default (see `events.mjs`).
 *
 * Authority for the encoder rule: src/lifegame/world/bridge.py `encode_frame`.
 * The constant and the rule itself live in shared.mjs, which the service imports
 * as well, so the page and the service cannot disagree about the budget.
 */

import { MAX_FRAME_CELLS } from './shared.mjs';

export { MAX_FRAME_CELLS };

/** The narrowest view, in world cells across. */
export const MIN_SPAN = 8;

/**
 * How many CSS pixels one world cell covers in the default view.
 *
 * The whole of the default view: a canvas 800 CSS pixels wide opens at
 * `800 / 60` world cells across, and a canvas twice that wide opens at twice as
 * many, so the cell a person sees is the same size on both and no fixed span has
 * to be right for every window. A preview canvas uses the same rule, which is
 * what makes a generation look the same in both.
 */
export const DEFAULT_PIXELS_PER_CELL = 60;

/** How far a pointer may travel and still count as a click rather than a drag. */
export const DRAG_THRESHOLD_PX = 4;

/** Below this many pixels per cell the one-cell grid is not drawn. */
export const GRID_MIN_CELL_PX = 6;

export function clamp(value, low, high) {
  return Math.min(Math.max(value, low), high);
}

/** The world-space height of a viewport whose width in world cells is `span`. */
export function visibleHeight(span, cssWidth, cssHeight) {
  return (span * cssHeight) / cssWidth;
}

/**
 * The span a canvas of this width opens with: one cell per `pixelsPerCell`.
 *
 * A canvas with no width at all — one that has not been laid out, or one that a
 * panel state has hidden — yields a span of zero, and a caller that has not
 * measured its canvas must not ask for a frame at all rather than ask for this.
 * A `pixelsPerCell` that is not a positive number falls back to the declared
 * one, so a corrupted call cannot produce an infinite or negative span.
 */
export function defaultSpan(cssWidth, pixelsPerCell = DEFAULT_PIXELS_PER_CELL) {
  const perCell =
    Number.isFinite(pixelsPerCell) && pixelsPerCell > 0 ? pixelsPerCell : DEFAULT_PIXELS_PER_CELL;
  const width = Number.isFinite(cssWidth) && cssWidth > 0 ? cssWidth : 0;
  return width / perCell;
}

/** The centre of a world, or `null` when it has not been described. */
export function worldCentre(world) {
  const width = world?.width;
  const height = world?.height;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return { x: width / 2, y: height / 2 };
}

/** The world point a viewport is looking at, in its middle. */
export function viewCentre(viewport, cssWidth, cssHeight) {
  return {
    x: viewport.x0 + viewport.span / 2,
    y: viewport.y0 + visibleHeight(viewport.span, cssWidth, cssHeight) / 2,
  };
}

/**
 * A viewport that puts `point` in the middle of the canvas.
 *
 * The vertical offset uses the canvas' own aspect rather than the span, because
 * the visible height is `span * cssHeight / cssWidth`: centring on `span / 2`
 * would put the point at the middle only on a square canvas. The result is
 * clamped into the world when one is supplied, so a point near an edge gives a
 * view that stops at the edge rather than one that shows nothing.
 *
 * @param {{point: {x: number, y: number}, span: number, cssWidth: number, cssHeight: number, world?: object}} options
 * @returns {{span: number, x0: number, y0: number}}
 */
export function centreViewport(options) {
  const { point, span, cssWidth, cssHeight, world } = options;
  const viewport = {
    span,
    x0: Math.round(point.x - span / 2),
    y0: Math.round(point.y - visibleHeight(span, cssWidth, cssHeight) / 2),
  };
  if (world === undefined || world === null) return viewport;
  return clampViewport(viewport, world, cssWidth, cssHeight);
}

/**
 * The widest span that can be rendered without risking a dense frame.
 *
 * Two limits compete. The encoder's own rule gives the widest rectangle whose
 * coordinate encoding is guaranteed at the current population, which for a
 * sparse world is the whole world. The area cap gives the widest rectangle whose
 * bitmap encoding is affordable at all. Whichever is narrower wins; when neither
 * binds, the whole world fits.
 */
export function maxSpan(options) {
  const {
    cssWidth,
    cssHeight,
    population,
    world,
    maxFrameCells = MAX_FRAME_CELLS,
    minSpan = MIN_SPAN,
  } = options;
  const aspect = cssHeight / cssWidth;
  const live = Math.max(population, 1);
  const bitsLimit = Math.sqrt(maxFrameCells / aspect);
  const sparseLimit = Math.sqrt((live * 64) / aspect);
  if (sparseLimit <= bitsLimit) return world.width;
  return Math.max(minSpan, Math.min(world.width, Math.floor(bitsLimit)));
}

/**
 * Pull a viewport back inside the world. Mutates and returns the viewport.
 *
 * The visible height follows the canvas aspect, so panning is bounded
 * vertically by however much world the canvas covers, not by the span.
 */
export function clampViewport(viewport, world, cssWidth, cssHeight) {
  const width = viewport.span;
  const height = visibleHeight(viewport.span, cssWidth, cssHeight);
  viewport.x0 = clamp(viewport.x0, 0, Math.max(0, world.width - width));
  viewport.y0 = clamp(viewport.y0, 0, Math.max(0, world.height - height));
  return viewport;
}

/**
 * Turn the viewport into the rectangle to ask the core for.
 *
 * A run can make the world denser than the current view can afford: a viewport
 * that was legal over a sparse world stops being legal once the population
 * grows. This pulls the view in rather than asking for a frame the service would
 * refuse, so the page degrades instead of erroring, and reports that it did.
 *
 * @returns {{frame: {x0: number, y0: number, w: number, h: number}, span: number, zoomLimited: boolean}}
 */
export function frameRequest(options) {
  const { viewport, world, cssWidth, cssHeight, population, maxFrameCells, minSpan } = options;
  const aspect = cssHeight / cssWidth;
  const limit = maxSpan({ cssWidth, cssHeight, population, world, maxFrameCells, minSpan });

  let span = viewport.span;
  let zoomLimited = false;
  if (span > limit) {
    span = limit;
    zoomLimited = true;
  }

  const width = clamp(Math.round(span), 1, world.width);
  const height = clamp(Math.round(span * aspect), 1, world.height);
  return {
    frame: {
      x0: clamp(Math.floor(viewport.x0), 0, Math.max(0, world.width - width)),
      y0: clamp(Math.floor(viewport.y0), 0, Math.max(0, world.height - height)),
      w: width,
      h: height,
    },
    span,
    zoomLimited,
  };
}

/**
 * The world cell under a pointer position.
 *
 * `rect` is the canvas bounding rectangle, so the mapping accounts for where the
 * canvas sits on the page; `frame` is the rectangle currently drawn, so the
 * mapping accounts for the fact that the drawn frame may be one generation
 * behind the viewport.
 */
export function screenToWorld(options) {
  const { clientX, clientY, rect, cssWidth, cssHeight, frame } = options;
  const x = Math.floor(frame.x0 + ((clientX - rect.left) / cssWidth) * frame.w);
  const y = Math.floor(frame.y0 + ((clientY - rect.top) / cssHeight) * frame.h);
  return { x, y };
}

/**
 * Rescale the span around a fixed point.
 *
 * The world point under the pointer before the zoom must be the world point
 * under the pointer after it, or the view slides sideways as the user scrolls.
 * That is the whole of the arithmetic: read the world point off the old scale,
 * set the new scale, put it back.
 *
 * @returns {{span: number, x0: number, y0: number}}
 */
export function zoomAt(options) {
  const {
    viewport,
    clientX,
    clientY,
    rect,
    cssWidth,
    factor,
    minSpan = MIN_SPAN,
    spanLimit,
  } = options;
  const pixelX = clientX - rect.left;
  const pixelY = clientY - rect.top;
  const perPixel = viewport.span / cssWidth;
  const worldX = viewport.x0 + pixelX * perPixel;
  const worldY = viewport.y0 + pixelY * perPixel;

  const span = clamp(viewport.span * factor, minSpan, spanLimit);
  const nextPerPixel = span / cssWidth;
  return {
    span,
    x0: worldX - pixelX * nextPerPixel,
    y0: worldY - pixelY * nextPerPixel,
  };
}

/**
 * Translate a screen-space drag into world coordinates. Mutates the viewport.
 *
 * Dragging right moves the view left, which is what "grab the world and pull it"
 * means.
 */
export function panByPixels(viewport, deltaX, deltaY, cssWidth) {
  const perPixel = viewport.span / cssWidth;
  viewport.x0 -= deltaX * perPixel;
  viewport.y0 -= deltaY * perPixel;
  return viewport;
}

/**
 * Whether a pointer that travelled `moved` pixels is a click or a drag.
 *
 * A press that never travelled toggles a cell; anything further is a pan. The
 * distinction lives here because it is the one rule that decides whether a
 * gesture edits the world or moves the camera.
 */
export function isClick(moved, threshold = DRAG_THRESHOLD_PX) {
  return moved <= threshold;
}

/** The scale factors that map world cells onto CSS pixels for a drawn frame. */
export function scaleFor(frame, cssWidth, cssHeight) {
  return { scaleX: cssWidth / frame.w, scaleY: cssHeight / frame.h };
}

// -- touch gestures --------------------------------------------------------

/**
 * The midpoint of a set of touch points, or null when there are none.
 *
 * A pinch is anchored at the midpoint between the fingers, which is the same
 * idea as the wheel's anchor: the world point under the finger (or under the
 * point between two of them) must not move. That is why one function serves
 * both — `zoomAt` is this with a single point.
 *
 * @param {Array<{x: number, y: number}>} points
 * @returns {{x: number, y: number} | null}
 */
export function pointerCentroid(points) {
  if (!Array.isArray(points) || points.length === 0) return null;
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point.x;
    y += point.y;
  }
  return { x: x / points.length, y: y / points.length };
}

/**
 * How far the points are spread from their midpoint, on average.
 *
 * The mean distance from the centroid rather than the distance between the first
 * two points, so three fingers behave the same as two and adding a finger does
 * not make the view jump. For two points it is exactly half their separation, so
 * the *ratio* between two samples — which is all a pinch uses — is unchanged.
 */
export function pointerSpread(points) {
  const centroid = pointerCentroid(points);
  if (centroid === null || points.length < 2) return 0;
  let total = 0;
  for (const point of points) {
    total += Math.hypot(point.x - centroid.x, point.y - centroid.y);
  }
  return total / points.length;
}

/**
 * The viewport after a pinch, given where the fingers were and where they are.
 *
 * Two things happen at once and both are the user's intent: the span scales by
 * how much the fingers spread, and the view follows the midpoint so a two-finger
 * drag pans. The invariant that makes it feel right is stated as arithmetic —
 * the world point under the old midpoint lands under the new one.
 *
 * @returns {{span: number, x0: number, y0: number}}
 */
export function pinchViewport(options) {
  const {
    viewport,
    rect,
    cssWidth,
    before,
    after,
    minSpan = MIN_SPAN,
    spanLimit,
  } = options;
  const perPixelBefore = viewport.span / cssWidth;
  const anchorX = viewport.x0 + (before.centroid.x - rect.left) * perPixelBefore;
  const anchorY = viewport.y0 + (before.centroid.y - rect.top) * perPixelBefore;

  // Fingers further apart than before means the world is being pulled open, so
  // fewer world cells fit across the same pixels: the span shrinks.
  const ratio = before.spread > 0 ? after.spread / before.spread : 1;
  const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  const span = clamp(viewport.span / safeRatio, minSpan, spanLimit);
  const perPixelAfter = span / cssWidth;
  return {
    span,
    x0: anchorX - (after.centroid.x - rect.left) * perPixelAfter,
    y0: anchorY - (after.centroid.y - rect.top) * perPixelAfter,
  };
}

/**
 * The gesture sample a pinch compares against: where the fingers are and how far
 * apart. Two free functions rather than a record kept by the caller, so the
 * "before" and "after" of a frame are the same shape by construction.
 */
export function gestureSample(points) {
  const centroid = pointerCentroid(points);
  if (centroid === null) return null;
  return { centroid, spread: pointerSpread(points) };
}
