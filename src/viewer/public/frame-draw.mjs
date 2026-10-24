/**
 * lifegame viewer — drawing a frame onto a canvas, for every canvas there is.
 *
 * There are two canvases in this interface: the world's, which edits as well as
 * draws, and the history preview's, which only draws. They must show the same
 * world the same way — the same bitmap path, the same cell plot, the same
 * one-cell grid at the same width — so the drawing lives here once and both
 * pages call it. A second copy would be the copy that drifts, and the drift
 * would be invisible until someone compared two screenshots.
 *
 * Two things make this module reusable rather than a pair of page functions in
 * disguise:
 *
 * - **The context and the palette are arguments.** The palette is read out of
 *   the active theme through `getComputedStyle`, which only a page can do, and
 *   the context belongs to whichever canvas is being painted. Nothing here reads
 *   a module-level binding, so `node --test` can draw into the recording context
 *   in `tests/dom-stub.mjs` and assert the pixels.
 * - **The grid is part of the frame.** A frame is a rectangle of world cells at
 *   one cell per pixel, so the grid is a property of the frame and the canvas
 *   size, not of the page that asked for it. The line width is the one control
 *   the world page owns, and it is passed in.
 *
 * The two encodings are the core's (`bits` and `cells`); decoding is in
 * `decode.mjs`, and the frame's own geometry is in `viewport.mjs`.
 */

import { decodeCells, forEachLiveBit } from './decode.mjs';
import {
  GRID_MIN_CELL_PX,
  scaleFor,
} from './viewport.mjs';
import { deviceLineWidth, parseColor, snapLineCenter, toCssColor } from './theme.mjs';

/**
 * The colours the canvas paints with, as the dark palette declares them.
 *
 * A stylesheet that cannot be read leaves the page painting what these say
 * rather than painting nothing: the canvas cannot inherit CSS, so a missing
 * custom property has to have a fallback, and the fallback is the palette the
 * layout sets before the first paint.
 */
export const DEFAULT_PALETTE = Object.freeze({
  aliveRgb: Object.freeze([127, 212, 255]),
  deadCss: '#0b0d10',
  gridCss: 'rgba(255, 255, 255, 0.14)',
});

/**
 * Read the canvas colours out of the active theme.
 *
 * A value this module cannot parse keeps the previous colour rather than
 * replacing it with something arbitrary, which is why each channel is tested
 * before it is used.
 *
 * @param {{getPropertyValue: (name: string) => string}} styles `getComputedStyle(document.documentElement)`
 * @param {typeof DEFAULT_PALETTE} [base] the palette to start from
 */
export function readPalette(styles, base = DEFAULT_PALETTE) {
  const palette = {
    aliveRgb: [...base.aliveRgb],
    deadCss: base.deadCss,
    gridCss: base.gridCss,
  };
  const alive = parseColor(styles.getPropertyValue('--alive'));
  const dead = parseColor(styles.getPropertyValue('--dead'));
  const grid = parseColor(styles.getPropertyValue('--grid'));
  if (alive !== null) palette.aliveRgb = [alive.r, alive.g, alive.b];
  if (dead !== null) palette.deadCss = toCssColor(dead);
  if (grid !== null) palette.gridCss = toCssColor(grid);
  return palette;
}

/**
 * Paint the `bits` encoding straight into an ImageData.
 *
 * The payload is walked once: zero bytes are skipped whole, and only live cells
 * touch the pixel buffer. Everything that decides *which* cells are live lives
 * in decode.mjs, where `node --test` can reach it.
 */
export function paintBits(base64, width, height, image, aliveRgb) {
  const data = image.data;
  data.fill(0);
  const [red, green, blue] = aliveRgb;
  forEachLiveBit(base64, width, height, (x, y) => {
    const offset = (y * width + x) * 4;
    data[offset] = red;
    data[offset + 1] = green;
    data[offset + 2] = blue;
    data[offset + 3] = 255;
  });
}

/**
 * Paint the ground a frame is drawn on: the palette's dead colour, over the whole
 * canvas, in the frame's own coordinate system.
 *
 * It is a function of its own rather than three lines inside `drawFrame` because
 * a canvas can have no frame to draw and still has to show *something*. The
 * history preview is that canvas: it draws nothing until a generation is
 * selected, and until then an unpainted surface is what the user sees. What an
 * unpainted surface looks like was measured in a real browser (Edge 155, driven
 * over CDP) rather than reasoned about: the context is created with
 * `alpha: false`, so every one of the 800 x 600 backing-store pixels composites
 * as **pure black**, and the `background: var(--dead)` the stylesheet declares
 * for the canvas is never visible at all. The empty preview was therefore a
 * black hole in a white page.
 *
 * `drawFrame` starting from this same call is what makes "nothing to show yet"
 * and "here is a generation" the same colour by construction, instead of two
 * colours that have to be kept in step by hand.
 *
 * @param {CanvasRenderingContext2D} context
 * @param {number} cssWidth
 * @param {number} cssHeight
 * @param {number} dpr
 * @param {typeof DEFAULT_PALETTE} palette
 */
export function paintGround(context, cssWidth, cssHeight, dpr, palette) {
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.fillStyle = palette.deadCss;
  context.fillRect(0, 0, cssWidth, cssHeight);
}

/**
 * Draw the one-cell grid over the frame.
 *
 * Two details make a thicker line land on whole device pixels instead of
 * smearing across two of them:
 *
 * - the width is chosen as a whole number of *device* pixels and converted back
 *   to the CSS pixels the context is scaled in, so at a fractional device pixel
 *   ratio the user's "2 px" becomes the nearest width that can actually be
 *   drawn;
 * - each line's centre is snapped to the device-pixel grid, offset by half a
 *   device pixel when the width is odd and by nothing when it is even.
 *
 * The colour comes from the active theme, because a fixed light grey is
 * invisible on a light background.
 */
export function drawGrid(options) {
  const { context, frame, scaleX, scaleY, cssWidth, cssHeight, dpr, gridCss, gridWidth } = options;
  if (scaleX < GRID_MIN_CELL_PX) return;
  const lineWidth = deviceLineWidth(gridWidth, dpr);
  context.strokeStyle = gridCss;
  context.lineWidth = lineWidth;
  context.beginPath();
  const firstX = Math.ceil(frame.x0);
  const lastX = frame.x0 + frame.w;
  for (let x = firstX; x <= lastX; x += 1) {
    const screenX = snapLineCenter((x - frame.x0) * scaleX, dpr, lineWidth);
    context.moveTo(screenX, 0);
    context.lineTo(screenX, cssHeight);
  }
  const firstY = Math.ceil(frame.y0);
  const lastY = frame.y0 + frame.h;
  for (let y = firstY; y <= lastY; y += 1) {
    const screenY = snapLineCenter((y - frame.y0) * scaleY, dpr, lineWidth);
    context.moveTo(0, screenY);
    context.lineTo(cssWidth, screenY);
  }
  context.stroke();
}

/**
 * Draw a frame onto a canvas context.
 *
 * `offscreen` is a canvas the caller keeps for the bitmap path: the `bits`
 * encoding is composed as an ImageData at the frame's own resolution and then
 * scaled onto the canvas, which is what keeps a mid-zoom view from taking a
 * draw call per live cell.
 *
 * @param {{
 *   context: CanvasRenderingContext2D,
 *   offscreen: HTMLCanvasElement,
 *   frame: {format: string, x0: number, y0: number, w: number, h: number, data: string},
 *   cssWidth: number,
 *   cssHeight: number,
 *   dpr: number,
 *   palette: typeof DEFAULT_PALETTE,
 *   gridWidth: number,
 * }} options
 */
export function drawFrame(options) {
  const { context, offscreen, frame, cssWidth, cssHeight, dpr, palette, gridWidth } = options;
  context.imageSmoothingEnabled = false;
  paintGround(context, cssWidth, cssHeight, dpr, palette);

  const { scaleX, scaleY } = scaleFor(frame, cssWidth, cssHeight);

  if (frame.format === 'bits') {
    if (offscreen.width !== frame.w || offscreen.height !== frame.h) {
      offscreen.width = frame.w;
      offscreen.height = frame.h;
    }
    const image = offscreen.getContext('2d').createImageData(frame.w, frame.h);
    paintBits(frame.data, frame.w, frame.h, image, palette.aliveRgb);
    offscreen.getContext('2d').putImageData(image, 0, 0);
    context.drawImage(offscreen, 0, 0, frame.w, frame.h, 0, 0, cssWidth, cssHeight);
  } else if (frame.format === 'cells') {
    const cells = decodeCells(frame.data);
    const size = Math.max(1, Math.min(scaleX, scaleY));
    context.fillStyle = `rgb(${palette.aliveRgb.join(',')})`;
    for (const [x, y] of cells) {
      context.fillRect((x - frame.x0) * scaleX, (y - frame.y0) * scaleY, size, size);
    }
  } else {
    throw new Error(`unknown frame format ${JSON.stringify(frame.format)}`);
  }

  drawGrid({
    context,
    frame,
    scaleX,
    scaleY,
    cssWidth,
    cssHeight,
    dpr,
    gridCss: palette.gridCss,
    gridWidth,
  });
}
