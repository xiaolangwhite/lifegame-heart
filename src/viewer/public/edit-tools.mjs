/**
 * lifegame viewer — the pure half of the editing tools.
 *
 * A gesture becomes a set of cells, and a snippet becomes a `fill` operation.
 * Those two decisions are arithmetic, so they live here and are asserted without
 * a canvas. The page owns the pointer, the preview and the request; it does not
 * own the shape of a line, the cells of a rectangle or the math of a rotation.
 */

/** The tools the page offers, in the order the control lists them. */
export const EDIT_TOOLS = Object.freeze([
  'paint',
  'erase',
  'line',
  'rect',
  'select',
  'stamp',
  'pan',
]);

/** The transforms a snippet can be placed with. */
export const SNIPPET_TRANSFORMS = Object.freeze([
  'none',
  'rotate90',
  'rotate180',
  'rotate270',
  'flipH',
  'flipV',
]);

/** The placement modes: overwrite makes the box the shape; merge only lights. */
export const SNIPPET_MODES = Object.freeze(['overwrite', 'merge']);

/** Normalise two corners into a non-negative box. */
export function boxOf(a, b) {
  const x = Math.min(a[0], b[0]);
  const y = Math.min(a[1], b[1]);
  return { x, y, w: Math.abs(a[0] - b[0]) + 1, h: Math.abs(a[1] - b[1]) + 1 };
}

/** Every cell on the line from `a` to `b`, endpoints included. */
export function lineCells(a, b) {
  let x0 = a[0];
  let y0 = a[1];
  const x1 = b[0];
  const y1 = b[1];
  const cells = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const stepX = x0 < x1 ? 1 : -1;
  const stepY = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  for (;;) {
    cells.push([x0, y0]);
    if (x0 === x1 && y0 === y1) break;
    const doubled = 2 * error;
    if (doubled >= dy) {
      error += dy;
      x0 += stepX;
    }
    if (doubled <= dx) {
      error += dx;
      y0 += stepY;
    }
  }
  return cells;
}

/** Every cell of the filled rectangle between two corners. */
export function rectCells(a, b) {
  const box = boxOf(a, b);
  const cells = [];
  for (let y = box.y; y < box.y + box.h; y += 1) {
    for (let x = box.x; x < box.x + box.w; x += 1) cells.push([x, y]);
  }
  return cells;
}

/** Sort and deduplicate cells by row then column. */
export function canonicalCells(cells) {
  const seen = new Set();
  const sorted = [];
  for (const [x, y] of cells) {
    const key = `${x},${y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sorted.push([x, y]);
  }
  sorted.sort((left, right) => left[1] - right[1] || left[0] - right[0]);
  return sorted;
}

/**
 * Return which cells of `next` are not already in `current`, so a stroke that
 * sweeps back over itself does not send the same cell twice.
 */
export function newCells(current, next) {
  const seen = new Set(current.map(([x, y]) => `${x},${y}`));
  return next.filter(([x, y]) => !seen.has(`${x},${y}`));
}

/** Transform a snippet's relative cells and box. */
export function transformSnippet({ cells, width, height }, transform) {
  if (!SNIPPET_TRANSFORMS.includes(transform)) {
    throw new Error(`unknown snippet transform: ${String(transform)}`);
  }
  const mapped = cells.map(([x, y]) => {
    switch (transform) {
      case 'rotate90':
        return [height - 1 - y, x];
      case 'rotate180':
        return [width - 1 - x, height - 1 - y];
      case 'rotate270':
        return [y, width - 1 - x];
      case 'flipH':
        return [width - 1 - x, y];
      case 'flipV':
        return [x, height - 1 - y];
      default:
        return [x, y];
    }
  });
  const swapped = transform === 'rotate90' || transform === 'rotate270';
  return {
    cells: canonicalCells(mapped),
    width: swapped ? height : width,
    height: swapped ? width : height,
  };
}

/**
 * Build the `fill` operation that places a snippet with its top-left corner at
 * `(x, y)`. The cells stay relative to the box; the service and the core never
 * learn what a snippet is.
 */
export function stampOperation({ snippet, x, y, transform = 'none', mode = 'overwrite' } = {}) {
  if (!SNIPPET_MODES.includes(mode)) {
    throw new Error(`unknown placement mode: ${String(mode)}`);
  }
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    throw new Error('a placement needs integer coordinates');
  }
  const placed = transformSnippet(snippet, transform);
  return {
    kind: 'fill',
    box: { x, y, w: placed.width, h: placed.height },
    cells: placed.cells,
    mode,
  };
}

/** True when a box fits inside a world. */
export function boxFits(box, world) {
  return (
    box.x >= 0 &&
    box.y >= 0 &&
    box.w > 0 &&
    box.h > 0 &&
    box.x + box.w <= world.width &&
    box.y + box.h <= world.height
  );
}
