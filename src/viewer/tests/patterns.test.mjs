/**
 * The pattern library: the RLE parser, the shipped data, and placement.
 *
 * The data is the interesting part. A pattern whose RLE is mistyped is still
 * *parseable* and still *placeable*, and it would still be drawn — as the wrong
 * shape. So the counts below are asserted against the published sizes of the
 * classic patterns, and the names are asserted as a set rather than as a length:
 * a pattern quietly dropped from the file would otherwise change the library
 * without failing anything.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_PATTERN_CELLS,
  PATTERN_FORMAT,
  PATTERN_FORMAT_VERSION,
  PATTERN_KINDS,
  findPattern,
  loadPatterns,
  parseRle,
  placedCells,
  readPatternLibrary,
} from '../patterns.mjs';

test('the parser reads a run of live and dead cells and terminates on "!"', () => {
  const block = parseRle('2o$2o!');
  assert.equal(block.width, 2);
  assert.equal(block.height, 2);
  assert.deepEqual(block.cells, [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ]);
});

test('a leading dead run is dropped and the shape is normalised to its box', () => {
  const shape = parseRle('b2o$b2o!');
  assert.deepEqual(shape.cells, [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ]);
  assert.equal(shape.width, 2);
});

test('"$" moves down, its count moves down that many rows, and "$" resets the column', () => {
  const shape = parseRle('o2$o!');
  assert.deepEqual(shape.cells, [
    [0, 0],
    [0, 2],
  ]);
  assert.equal(shape.height, 3);
});

test('a pattern with a fault is refused rather than truncated', () => {
  assert.throws(() => parseRle('2o'), /does not end with "!"/);
  assert.throws(() => parseRle('o!o'), /content after "!"/);
  assert.throws(() => parseRle('2x!'), /not a digit/);
  assert.throws(() => parseRle('0o!'), /invalid run length/);
  assert.throws(() => parseRle('2!'), /before its "!" terminator/);
  assert.throws(() => parseRle('!'), /describes no live cells/);
  assert.throws(() => parseRle(''), /non-empty string/);
  assert.throws(() => parseRle('99999o!'), /more than 4096 live cells/);
});

test('the shipped library has the fifteen classic patterns and every kind', () => {
  const patterns = readPatternLibrary();
  assert.deepEqual(
    patterns.map((pattern) => pattern.name),
    [
      'block',
      'beehive',
      'loaf',
      'boat',
      'tub',
      'blinker',
      'toad',
      'beacon',
      'pulsar',
      'pentadecathlon',
      'glider',
      'lwss',
      'mwss',
      'hwss',
      'gosper-glider-gun',
    ],
  );
  for (const kind of PATTERN_KINDS) {
    assert.ok(
      patterns.some((pattern) => pattern.kind === kind),
      `no pattern of kind ${kind}`,
    );
  }
});

test('every shipped pattern has the published population', () => {
  const counts = {
    block: 4,
    beehive: 6,
    loaf: 7,
    boat: 5,
    tub: 4,
    blinker: 3,
    toad: 6,
    beacon: 8,
    pulsar: 48,
    pentadecathlon: 12,
    glider: 5,
    lwss: 9,
    mwss: 11,
    hwss: 13,
    'gosper-glider-gun': 36,
  };
  const patterns = readPatternLibrary();
  for (const pattern of patterns) {
    assert.equal(pattern.cells.length, counts[pattern.name], pattern.name);
    assert.ok(pattern.width > 0 && pattern.height > 0, pattern.name);
    assert.ok(
      pattern.cells.length >= pattern.width,
      `${pattern.name} cannot be denser than its width`,
    );
  }
});

test('the document is validated against its declared format', () => {
  const good = {
    format: PATTERN_FORMAT,
    version: PATTERN_FORMAT_VERSION,
    patterns: [{ name: 'block', kind: 'still-life', rle: '2o$2o!' }],
  };
  assert.equal(loadPatterns(good).length, 1);
  assert.throws(() => loadPatterns({ ...good, format: 'other' }), /had format|expected/);
  assert.throws(() => loadPatterns({ ...good, version: 2 }), /expected 1/);
  assert.throws(() => loadPatterns({ ...good, patterns: [] }), /non-empty/);
  assert.throws(
    () => loadPatterns({ ...good, patterns: [{ name: 'Block!', kind: 'still-life', rle: '2o$2o!' }] }),
    /kebab-case/,
  );
  assert.throws(
    () => loadPatterns({ ...good, patterns: [{ name: 'block', kind: 'wizardry', rle: '2o$2o!' }] }),
    /expected one of/,
  );
  assert.throws(
    () => loadPatterns({ ...good, patterns: [good.patterns[0], good.patterns[0]] }),
    /repeats the name/,
  );
  assert.throws(
    () => loadPatterns({ ...good, patterns: [{ name: 'block', kind: 'still-life', rle: '2o' }] }),
    /does not end/,
  );
});

test('a pattern is found by name, and an unknown name is undefined', () => {
  const patterns = readPatternLibrary();
  assert.equal(findPattern(patterns, 'glider').cells.length, 5);
  assert.equal(findPattern(patterns, 'no-such-pattern'), undefined);
});

test('placement anchors the bounding box and refuses to leave the world', () => {
  const block = findPattern(readPatternLibrary(), 'block');
  assert.deepEqual(placedCells(block, 10, 20, 64, 64), [
    [10, 20],
    [11, 20],
    [10, 21],
    [11, 21],
  ]);
  assert.throws(() => placedCells(block, 63, 20, 64, 64), /does not fit/);
  assert.throws(() => placedCells(block, -1, 0, 64, 64), /non-negative/);
  assert.throws(() => placedCells(block, 0, 0, 0, 0), /does not fit/);
});

test('the parser cap is a bound on the array, not on a pattern in the file', () => {
  assert.ok(MAX_PATTERN_CELLS >= 48, 'the largest shipped pattern must fit');
  assert.throws(() => parseRle('4097o!'), /more than 4096 live cells/);
});
