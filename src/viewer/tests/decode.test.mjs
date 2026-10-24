/**
 * The decoder the browser actually runs, checked against the real core.
 *
 * The bridge's own tests decode frames with a decoder written independently, on
 * purpose: a shared decoder would let one mistake cancel itself out. This file
 * covers the other half — the implementation in public/decode.mjs, which is
 * what turns a reply into pixels — so a mistake there fails a test instead of
 * showing up as a wrong picture.
 *
 * The hand-built payloads pin the two rules the core states in
 * src/lifegame/world/bridge.py: high bit first within a byte, and row stride
 * ceil(width / 8) with the padding bits of the last byte ignored.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { CoreBridge, defaultPythonPath } from '../bridge.mjs';
import { base64ToBytes, decodeBits, decodeCells, forEachLiveBit } from '../public/decode.mjs';

const pythonPath = defaultPythonPath();

function makeBridge() {
  return new CoreBridge({ pythonPath, worldWidth: 64, worldHeight: 64 });
}

const sortCells = (cells) => cells.map(([x, y]) => `${x},${y}`).sort();

test('a live cell is the high bit of its byte, not the low one', () => {
  // 0b10000001 in a one-byte-wide row is x = 0 and x = 7.
  const { bitmap, live } = decodeBits(Buffer.from([0b10000001]).toString('base64'), 8, 1);
  assert.equal(live, 2);
  assert.equal(bitmap[0], 1);
  assert.equal(bitmap[7], 1);

  // 0b00000001 is x = 7 alone: a low-bit reading would have reported x = 0.
  const low = decodeBits(Buffer.from([0b00000001]).toString('base64'), 8, 1);
  assert.equal(low.bitmap[7], 1);
  assert.equal(low.bitmap[0], 0);
});

test('bits beyond the last column of a row are padding and are ignored', () => {
  // Width 21 needs three bytes per row; 0xff in the third byte covers x = 16
  // to 23, of which only 16 to 20 exist.
  const payload = Buffer.from([0x00, 0x00, 0xff]).toString('base64');
  const seen = [];
  const live = forEachLiveBit(payload, 21, 1, (x, y) => seen.push([x, y]));
  assert.equal(live, 5);
  assert.deepEqual(sortCells(seen), ['16,0', '17,0', '18,0', '19,0', '20,0']);

  const { bitmap } = decodeBits(payload, 21, 1);
  assert.equal(bitmap.length, 21);
});

test('the row stride is the rounded-up width, not the width', () => {
  // Two rows of width 9: stride 2, so byte 2 is the first byte of row 1.
  const payload = Buffer.from([0b10000000, 0x00, 0b01000000, 0x00]).toString('base64');
  const seen = [];
  forEachLiveBit(payload, 9, 2, (x, y) => seen.push([x, y]));
  assert.deepEqual(sortCells(seen), ['0,0', '1,1']);
});

test('a truncated payload is reported, never half-drawn', () => {
  assert.throws(
    () => decodeCells(Buffer.from([1, 2, 3, 4]).toString('base64')),
    /not a whole number of pairs/,
  );
  assert.throws(
    () => forEachLiveBit(Buffer.from([0x00, 0x00]).toString('base64'), 21, 1, () => {}),
    /are needed for 21x1/,
  );
});

test('base64ToBytes round-trips arbitrary bytes', () => {
  const original = Uint8Array.from([0, 1, 127, 128, 255, 66]);
  const back = base64ToBytes(Buffer.from(original).toString('base64'));
  assert.deepEqual(Array.from(back), Array.from(original));
});

test('the sparse path decodes a real frame to exactly what was set', async (t) => {
  const bridge = makeBridge();
  t.after(() => bridge.stop());

  const pattern = [
    [3, 4],
    [5, 6],
    [7, 8],
    [63, 63],
  ];
  await bridge.request('set', { cells: pattern, alive: true });
  const reply = await bridge.request('frame', { x0: 0, y0: 0, w: 64, h: 64 });
  assert.equal(reply.frame.format, 'cells', 'four cells in a 64x64 rectangle must use cells');

  const decoded = decodeCells(reply.frame.data);
  assert.deepEqual(sortCells(decoded), sortCells(pattern));
});

test('the dense path decodes a real frame to exactly what was set', async (t) => {
  const bridge = makeBridge();
  t.after(() => bridge.stop());

  const block = [];
  for (let y = 0; y < 24; y += 1) {
    for (let x = 0; x < 24; x += 1) block.push([x, y]);
  }
  await bridge.request('set', { cells: block, alive: true });
  const reply = await bridge.request('frame', { x0: 0, y0: 0, w: 64, h: 64 });
  assert.equal(reply.frame.format, 'bits', '576 cells in a 64x64 rectangle must use bits');

  const { bitmap, live } = decodeBits(reply.frame.data, reply.frame.w, reply.frame.h);
  assert.equal(live, block.length);
  const decoded = [];
  for (let y = 0; y < reply.frame.h; y += 1) {
    for (let x = 0; x < reply.frame.w; x += 1) {
      if (bitmap[y * reply.frame.w + x]) decoded.push([x, y]);
    }
  }
  assert.deepEqual(sortCells(decoded), sortCells(block));
});

test('the two decoders agree about the same world from different origins', async (t) => {
  const bridge = makeBridge();
  t.after(() => bridge.stop());

  const glider = [
    [1, 0],
    [2, 1],
    [0, 2],
    [1, 2],
    [2, 2],
  ];
  await bridge.request('set', { cells: glider, alive: true });
  await bridge.request('step', { count: 4 });

  // The same five cells are sparse in a 64x64 rectangle and dense in the 4x4
  // one that exactly contains them, so the core picks a different encoding for
  // each — which is what makes this a cross-check rather than a repetition.
  const sparse = await bridge.request('frame', { x0: 0, y0: 0, w: 64, h: 64 });
  const dense = await bridge.request('frame', { x0: 1, y0: 1, w: 4, h: 4 });
  assert.equal(sparse.frame.format, 'cells');
  assert.equal(dense.frame.format, 'bits');

  const fromCells = decodeCells(sparse.frame.data);

  const { bitmap } = decodeBits(dense.frame.data, dense.frame.w, dense.frame.h);
  const fromBits = [];
  for (let y = 0; y < dense.frame.h; y += 1) {
    for (let x = 0; x < dense.frame.w; x += 1) {
      if (bitmap[y * dense.frame.w + x]) fromBits.push([x + dense.frame.x0, y + dense.frame.y0]);
    }
  }

  assert.equal(fromCells.length, 5);
  assert.deepEqual(sortCells(fromCells), sortCells(fromBits));
});
