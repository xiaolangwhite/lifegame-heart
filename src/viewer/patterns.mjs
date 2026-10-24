/**
 * lifegame viewer — the pattern library: one data file, one parser.
 *
 * A pattern is **data**, in `patterns.json`, not code. The file uses the
 * Run Length Encoded form the Life community already writes (the format
 * `conwaylife.com` and every Life tool share), so a pattern in this repository
 * can be read, checked or replaced with any other Life tool, and a contributor
 * does not have to learn a format invented here.
 *
 * The parser is the only place the encoding is understood. It is deliberately
 * strict: a document with an unknown character, a missing terminator or a run
 * that would allocate more than `MAX_PATTERN_CELLS` is refused rather than
 * truncated, because a silently shortened pattern places a different shape than
 * the one a person chose.
 *
 * Everything here is pure: the module reads the file once when asked and returns
 * frozen values. The server owns the file read; the page never sees RLE text.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Where the library ships. */
export const defaultPatternsPath = path.join(here, 'patterns.json');

/** The only document format this module reads. */
export const PATTERN_FORMAT = 'lifegame-patterns';
export const PATTERN_FORMAT_VERSION = 1;

/** The kinds of pattern the milestone asks for, in the order a person browses them. */
export const PATTERN_KINDS = Object.freeze(['still-life', 'oscillator', 'ship', 'gun']);

/**
 * The most cells one pattern may hold.
 *
 * Every classic pattern is far below this: the largest in the shipped file is the
 * pulsar at 48. The bound exists so a malformed run such as `99999o` is refused
 * instead of allocating the array.
 */
export const MAX_PATTERN_CELLS = 4096;

/** The widest or tallest a pattern may be, for the same reason. */
export const MAX_PATTERN_SIDE = 512;

function fail(where, message) {
  throw new Error(`${where}: ${message}`);
}

/**
 * Parse one RLE body into a normalised pattern.
 *
 * The body is the part after the `x = ..., y = ...` header, which this library
 * omits because every caller computes the size from the cells instead of
 * trusting a second declaration. `b` is a dead run, `o` a live one, `$` a new
 * row and `!` the terminator. Runs are the count written before a token.
 *
 * The result is normalised so the top-left of the bounding box is `(0, 0)`, and
 * `width`/`height` are the bounding box. A leading `b` therefore changes nothing
 * a caller can see: a pattern is a shape, not a position.
 */
export function parseRle(text, where = 'rle') {
  if (typeof text !== 'string' || text === '') {
    fail(where, 'must be a non-empty string');
  }
  const cells = [];
  let x = 0;
  let y = 0;
  let count = '';
  let finished = false;
  let index = 0;
  for (const char of text) {
    index += 1;
    if (finished) {
      if (char !== '\n' && char !== '\r' && char !== ' ' && char !== '\t') {
        fail(where, `has content after "!" at character ${index}`);
      }
      continue;
    }
    if (char >= '0' && char <= '9') {
      count += char;
      if (count.length > 9) fail(where, 'has a run length with more than nine digits');
      continue;
    }
    const run = count === '' ? 1 : Number(count);
    if (!Number.isSafeInteger(run) || run <= 0) {
      fail(where, `has an invalid run length ${JSON.stringify(count)}`);
    }
    if (char === '!') {
      if (count !== '') fail(where, 'has a run length before its "!" terminator');
      finished = true;
      continue;
    }
    count = '';
    if (char === 'b') {
      x += run;
    } else if (char === 'o') {
      if (cells.length + run > MAX_PATTERN_CELLS) {
        fail(where, `describes more than ${MAX_PATTERN_CELLS} live cells`);
      }
      for (let offset = 0; offset < run; offset += 1) cells.push([x + offset, y]);
      x += run;
    } else if (char === '$') {
      y += run;
      x = 0;
    } else {
      fail(where, `contains ${JSON.stringify(char)}, which is not a digit, "b", "o", "$" or "!"`);
    }
    if (cells.length > MAX_PATTERN_CELLS) {
      fail(where, `describes more than ${MAX_PATTERN_CELLS} live cells`);
    }
    if (x > MAX_PATTERN_SIDE || y > MAX_PATTERN_SIDE) {
      fail(where, `is larger than ${MAX_PATTERN_SIDE} cells on a side`);
    }
  }
  if (!finished) fail(where, 'does not end with "!"');
  if (cells.length === 0) fail(where, 'describes no live cells');

  const xs = cells.map((cell) => cell[0]);
  const ys = cells.map((cell) => cell[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const width = Math.max(...xs) - minX + 1;
  const height = Math.max(...ys) - minY + 1;
  return {
    cells: cells.map((cell) => [cell[0] - minX, cell[1] - minY]),
    width,
    height,
  };
}

/** True for the kebab-case names this library accepts. */
function isPatternName(name) {
  return typeof name === 'string' && /^[a-z][a-z0-9-]*$/.test(name);
}

/**
 * Validate a parsed JSON document and return the patterns as frozen values.
 *
 * The document is refused, not repaired, when it disagrees with the format: a
 * missing version, an unknown kind, a duplicate name or a pattern this parser
 * cannot read would otherwise become a control that places something other than
 * what its label says.
 */
export function loadPatterns(document, where = 'patterns') {
  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    fail(where, 'must be a JSON object');
  }
  if (document.format !== PATTERN_FORMAT) {
    fail(where, `has format ${JSON.stringify(document.format)}, expected ${JSON.stringify(PATTERN_FORMAT)}`);
  }
  if (document.version !== PATTERN_FORMAT_VERSION) {
    fail(where, `has version ${JSON.stringify(document.version)}, expected ${PATTERN_FORMAT_VERSION}`);
  }
  if (!Array.isArray(document.patterns) || document.patterns.length === 0) {
    fail(where, 'must carry a non-empty "patterns" array');
  }
  const seen = new Set();
  const patterns = document.patterns.map((entry, index) => {
    const at = `${where}.patterns[${index}]`;
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      fail(at, 'must be an object');
    }
    if (!isPatternName(entry.name)) {
      fail(at, 'has a name that is not lower-case kebab-case');
    }
    if (seen.has(entry.name)) fail(at, `repeats the name ${JSON.stringify(entry.name)}`);
    seen.add(entry.name);
    if (!PATTERN_KINDS.includes(entry.kind)) {
      fail(at, `has kind ${JSON.stringify(entry.kind)}, expected one of ${PATTERN_KINDS.join(', ')}`);
    }
    const parsed = parseRle(entry.rle, at);
    return Object.freeze({
      name: entry.name,
      kind: entry.kind,
      cells: Object.freeze(parsed.cells.map((cell) => Object.freeze(cell))),
      width: parsed.width,
      height: parsed.height,
    });
  });
  return Object.freeze(patterns);
}

/** Read and validate the library at `file`, or throw naming the file. */
export function readPatternLibrary(file = defaultPatternsPath) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    throw new Error(`cannot read the pattern library at ${file}: ${error.message}`);
  }
  let document;
  try {
    document = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new Error(`the pattern library at ${file} is not JSON: ${error.message}`);
  }
  return loadPatterns(document, file);
}

/** The pattern with this name, or `undefined`. */
export function findPattern(patterns, name) {
  return patterns.find((pattern) => pattern.name === name);
}

/**
 * The absolute cells of `pattern` with its bounding box anchored at `(x, y)`.
 *
 * A placement that would leave the world is refused here, before anything is
 * sent: the core would refuse it too, and a second check in the client turns a
 * round trip into a local message beside the control the person just used.
 */
export function placedCells(pattern, x, y, width, height) {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) {
    throw new Error(`placement origin (${x}, ${y}) must be two non-negative integers`);
  }
  if (x + pattern.width > width || y + pattern.height > height) {
    throw new Error(
      `pattern ${JSON.stringify(pattern.name)} ${pattern.width} x ${pattern.height} ` +
        `does not fit at (${x}, ${y}) in a ${width} x ${height} world`,
    );
  }
  return pattern.cells.map((cell) => [cell[0] + x, cell[1] + y]);
}
