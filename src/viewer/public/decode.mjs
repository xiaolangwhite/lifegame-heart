/**
 * lifegame viewer — the client half of the core's two frame encodings.
 *
 * These functions are deliberately free of DOM and canvas dependencies so that
 * the browser's own decoding path can be exercised by `node --test` against
 * payloads produced by the real core. A decoding mistake shows up as wrong
 * pixels, which is exactly the kind of defect that is invisible in a manual
 * check and expensive to find in a browser.
 *
 * The encodings are defined by the core, in src/lifegame/world/bridge.py
 * (`encode_frame`):
 *
 * - `cells`: base64 of little-endian int32 pairs, x then y, absolute world
 *   coordinates.
 * - `bits`: base64 of row-major packed bits, one bit per cell, high bit first,
 *   row stride `ceil(width / 8)` bytes.
 */

/** Decode base64 into bytes without the per-character allocation of Array.from. */
export function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * Decode a `cells` payload into `[x, y]` pairs of absolute world coordinates.
 *
 * Throws when the payload is not a whole number of pairs: a truncated frame is
 * a defect that must be reported, never silently half-drawn.
 */
export function decodeCells(base64) {
  const bytes = base64ToBytes(base64);
  if (bytes.byteLength % 8 !== 0) {
    throw new Error(`cells payload is ${bytes.byteLength} bytes, which is not a whole number of pairs`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const cells = [];
  for (let offset = 0; offset < bytes.byteLength; offset += 8) {
    cells.push([view.getInt32(offset, true), view.getInt32(offset + 4, true)]);
  }
  return cells;
}

/**
 * Call `visit(x, y)` for every live cell of a `bits` payload, in row order.
 *
 * Zero bytes are skipped whole, so an empty or sparse bitmap costs one test per
 * eight cells rather than one per cell. Returns the number of live cells.
 *
 * Throws when the payload is shorter than the rectangle needs.
 */
export function forEachLiveBit(base64, width, height, visit) {
  const bytes = base64ToBytes(base64);
  const stride = Math.ceil(width / 8);
  const needed = stride * height;
  if (bytes.byteLength < needed) {
    throw new Error(
      `bits payload is ${bytes.byteLength} bytes but ${needed} are needed for ${width}x${height}`,
    );
  }
  let live = 0;
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * stride;
    for (let byteIndex = 0; byteIndex < stride; byteIndex += 1) {
      const byte = bytes[rowStart + byteIndex];
      if (byte === 0) continue;
      const firstX = byteIndex * 8;
      for (let bit = 0; bit < 8; bit += 1) {
        const x = firstX + bit;
        if (x >= width) break;
        if ((byte >> (7 - bit)) & 1) {
          live += 1;
          visit(x, y);
        }
      }
    }
  }
  return live;
}

/** Wrap a `bits` payload as a bitmap for a rectangle, for callers that want one. */
export function decodeBits(base64, width, height) {
  const bitmap = new Uint8Array(width * height);
  const live = forEachLiveBit(base64, width, height, (x, y) => {
    bitmap[y * width + x] = 1;
  });
  return { bitmap, live };
}
