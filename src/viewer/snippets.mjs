/**
 * lifegame viewer — the snippet library: content-addressed shapes and one index.
 *
 * A snippet is an immutable value `{cells, width, height, contentHash}`; the name
 * is only an index entry. The hash is the identity, so publishing the same shape
 * twice yields one object, and a pinned reference (`name@hash`) cannot be changed
 * by a later publish. The decision is
 * docs/adr/data-and-formats/0014-snippets-are-content-addressed-objects.md and the
 * design is docs/plan/phase-04-editing-mode/design.md §9.
 *
 * Canonical form and hash
 * -----------------------
 * A cell is an `[x, y]` pair relative to the top-left of the box, with
 * `0 <= x < width` and `0 <= y < height`. The canonical encoding sorts cells by
 * row and then column (`y`, then `x`) and removes duplicates. The canonical text
 * is
 *
 *     lifegame-snippet/1\n<width>x<height>\n<x>,<y>;<x>,<y>;...
 *
 * (the third line is empty for a snippet with no live cells), and the SHA-256 of
 * its UTF-8 bytes, as lower-case hexadecimal, is the content hash. The `1` in the
 * first line versions the string: changing any byte of it would change every
 * hash, so it may only change together with the format version.
 *
 * Storage
 * -------
 * One immutable object per hash and one mutable index:
 *
 *     <directory>/<hash>.json
 *         {format, version, contentHash, width, height, cells}
 *     <directory>/index.json
 *         {format, version, snippets: {name: {hash, width, height, cellCount}}}
 *
 * An object is never rewritten once it exists. A publish of different content
 * under an existing name is refused with `name_conflict` unless the caller pins
 * the current hash as `expectedHash`; an identical republish is idempotent. A
 * remove deletes the index entry and deliberately leaves the object, because
 * another name may reference the same content (ADR 0014).
 *
 * Every write goes to a temporary file in the same directory and is renamed into
 * place, so a reader sees either the old file or the new one. Reads never create
 * or repair an index: a missing or corrupt one is reported with a named
 * `SnippetError` code instead.
 *
 * The module uses Node's built-in modules only, keeps no module-level mutable
 * state, and reads no other module.
 */

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** The widest or tallest box a snippet may occupy (design §13). */
export const MAX_SNIPPET_SIDE = 256;

/** The most live cells one snippet may hold (design §13). */
export const MAX_SNIPPET_CELLS = 8192;

/** The longest snippet name accepted, in characters. */
export const MAX_SNIPPET_NAME_LENGTH = 64;

/** The format marker of a content object. */
export const SNIPPET_FORMAT = 'lifegame-snippet';
export const SNIPPET_FORMAT_VERSION = 1;

/** The format marker of the index that maps names onto content hashes. */
export const SNIPPET_INDEX_FORMAT = 'lifegame-snippet-index';
export const SNIPPET_INDEX_VERSION = 1;

/** The one file in a snippet directory whose contents are mutable. */
export const SNIPPET_INDEX_FILE = 'index.json';

/**
 * @typedef {readonly [number, number]} Cell
 * @typedef {{cells: ReadonlyArray<Cell>, width: number, height: number, cellCount: number}} SnippetValue
 * @typedef {{hash: string, width: number, height: number, cellCount: number}} IndexEntry
 * @typedef {{name: string, hash: string, width: number, height: number, cellCount: number}} SnippetEntry
 * @typedef {{name: string | null, hash: string, cells: ReadonlyArray<Cell>,
 *   width: number, height: number, cellCount: number}} ReadSnippet
 */

/**
 * The one error type this module raises.
 *
 * `code` is the stable value a route or a test matches on; the message is a
 * diagnostic that names the file, the name or the bound that was wrong.
 */
export class SnippetError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {{cause?: unknown}} [options]
   */
  constructor(code, message, options) {
    super(message, options);
    this.name = 'SnippetError';
    this.code = code;
  }
}

/**
 * Throw a named error.
 *
 * @param {string} code
 * @param {string} message
 * @param {{cause?: unknown}} [options]
 * @returns {never}
 */
function fail(code, message, options) {
  throw new SnippetError(code, message, options);
}

/** True for a value that could be a content hash: 64 lower-case hex digits. */
export function isContentHash(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

/** Reject anything that is not a lower-case content hash. */
function validateHash(value, label) {
  if (!isContentHash(value)) {
    fail(
      'invalid_hash',
      `${label} must be a lower-case SHA-256 hex string, got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/** True for a JSON object, as opposed to an array, `null` or a scalar. */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Node writes no BOM, but a hand-edited file may; the format itself has none. */
function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * The canonical cell encoding: sorted by row then column, duplicates removed.
 *
 * This function owns the ordering, not the box: cells only have to be
 * non-negative integers here. `validateSnippet` is what checks them against a
 * declared `width` and `height`. The result is deeply frozen, so a caller cannot
 * change a value another caller is holding.
 *
 * @param {ReadonlyArray<Cell>} cells
 * @returns {ReadonlyArray<Cell>}
 */
export function canonicalCells(cells) {
  if (!Array.isArray(cells)) {
    fail('invalid_snippet', 'snippet cells must be an array of [x, y] pairs');
  }
  /** @type {Map<string, Cell>} */
  const unique = new Map();
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index];
    if (!Array.isArray(cell) || cell.length !== 2) {
      fail('invalid_snippet', `snippet cell ${index} must be an [x, y] pair`);
    }
    const rawX = cell[0];
    const rawY = cell[1];
    if (!Number.isSafeInteger(rawX) || !Number.isSafeInteger(rawY)) {
      fail('invalid_snippet', `snippet cell ${index} must be two integers`);
    }
    if (rawX < 0 || rawY < 0) {
      fail('invalid_snippet', `snippet cell ${index} (${rawX}, ${rawY}) must not be negative`);
    }
    // Normalise -0 so a frozen cell is always the same value 0.
    const x = rawX === 0 ? 0 : rawX;
    const y = rawY === 0 ? 0 : rawY;
    unique.set(`${x},${y}`, [x, y]);
  }
  const canonical = [...unique.values()].sort(
    (left, right) => left[1] - right[1] || left[0] - right[0],
  );
  for (const cell of canonical) Object.freeze(cell);
  return Object.freeze(canonical);
}

/**
 * The canonical encoding as the text form used between hashes: `x,y;x,y`.
 *
 * @param {ReadonlyArray<Cell>} cells
 * @returns {string}
 */
export function encodeCells(cells) {
  return canonicalCells(cells)
    .map(([x, y]) => `${x},${y}`)
    .join(';');
}

/**
 * Validate a snippet value and return its canonical, frozen form.
 *
 * The limits are upper bounds, not lower ones: a box with no live cells is a
 * legal (if empty) shape. A cell outside the declared box is refused rather than
 * clipped, because clipping would publish a different shape than the one the
 * caller selected.
 *
 * @param {unknown} value
 * @returns {SnippetValue}
 */
export function validateSnippet(value) {
  if (!isPlainObject(value)) {
    fail('invalid_snippet', 'a snippet must be an object with cells, width and height');
  }
  const { width, height } = /** @type {{width?: unknown, height?: unknown}} */ (value);
  if (!Number.isSafeInteger(width) || width < 1) {
    fail('invalid_snippet', `snippet width must be a positive integer, got ${JSON.stringify(width)}`);
  }
  if (!Number.isSafeInteger(height) || height < 1) {
    fail('invalid_snippet', `snippet height must be a positive integer, got ${JSON.stringify(height)}`);
  }
  if (width > MAX_SNIPPET_SIDE || height > MAX_SNIPPET_SIDE) {
    fail(
      'too_large',
      `snippet box ${width} x ${height} exceeds the ${MAX_SNIPPET_SIDE} x ${MAX_SNIPPET_SIDE} limit`,
    );
  }
  const cells = canonicalCells(/** @type {ReadonlyArray<Cell>} */ (value.cells));
  if (cells.length > MAX_SNIPPET_CELLS) {
    fail('too_large', `snippet has ${cells.length} live cells; the limit is ${MAX_SNIPPET_CELLS}`);
  }
  for (const [x, y] of cells) {
    if (x >= width || y >= height) {
      fail(
        'invalid_snippet',
        `snippet cell (${x}, ${y}) is outside its ${width} x ${height} box`,
      );
    }
  }
  return Object.freeze({ cells, width, height, cellCount: cells.length });
}

/** The hash preimage of an already-canonical value. */
function canonicalText(value) {
  const encoded = value.cells.map(([x, y]) => `${x},${y}`).join(';');
  return `lifegame-snippet/${SNIPPET_FORMAT_VERSION}\n${value.width}x${value.height}\n${encoded}`;
}

/** SHA-256 of an already-canonical value, lower-case hex. */
function hashCanonical(value) {
  return createHash('sha256').update(canonicalText(value), 'utf8').digest('hex');
}

/**
 * The exact string whose UTF-8 bytes `contentHash` hashes.
 *
 * Exported so the formula can be asserted rather than described: a test can
 * compare the digest with this preimage instead of restating it as a second
 * implementation.
 *
 * @param {ReadonlyArray<Cell>} cells
 * @param {number} width
 * @param {number} height
 * @returns {string}
 */
export function canonicalSnippetText(cells, width, height) {
  return canonicalText(validateSnippet({ cells, width, height }));
}

/**
 * The content hash of a snippet: SHA-256 of `canonicalSnippetText`, lower-case
 * hexadecimal.
 *
 * @param {ReadonlyArray<Cell>} cells
 * @param {number} width
 * @param {number} height
 * @returns {string}
 */
export function contentHash(cells, width, height) {
  return hashCanonical(validateSnippet({ cells, width, height }));
}

/**
 * Validate a snippet name and return it unchanged.
 *
 * A name is a plain identifier: letters, digits, `.`, `_` and `-`, starting with
 * a letter or digit, at most `MAX_SNIPPET_NAME_LENGTH` characters. It is never a
 * file name — the index is the only place it appears — but it is kept to this
 * shape so it can be a URL segment and a JSON key without escaping. `.` and `..`
 * are refused explicitly, and a 64-character hexadecimal name is refused because
 * read-by-hash would otherwise be ambiguous.
 *
 * @param {unknown} name
 * @returns {string}
 */
export function validateSnippetName(name) {
  if (typeof name !== 'string' || name === '') {
    fail('invalid_name', `a snippet name must be a non-empty string, got ${JSON.stringify(name)}`);
  }
  if (name.length > MAX_SNIPPET_NAME_LENGTH) {
    fail(
      'invalid_name',
      `snippet name is ${name.length} characters; the limit is ${MAX_SNIPPET_NAME_LENGTH}`,
    );
  }
  if (name === '.' || name === '..') {
    fail('invalid_name', `snippet name ${JSON.stringify(name)} is not a plain identifier`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    fail(
      'invalid_name',
      `snippet name ${JSON.stringify(name)} must be 1-${MAX_SNIPPET_NAME_LENGTH} characters of ` +
        'letters, digits, ".", "_" or "-", starting with a letter or digit',
    );
  }
  if (isContentHash(name)) {
    fail(
      'invalid_name',
      `snippet name ${JSON.stringify(name)} is 64 hexadecimal characters and would be mistaken ` +
        'for a content hash',
    );
  }
  return name;
}

/** True when `validateSnippetName` would accept the value. */
export function isValidSnippetName(name) {
  try {
    validateSnippetName(name);
    return true;
  } catch {
    return false;
  }
}

/**
 * A filesystem failure this module reports by name rather than leaking.
 *
 * @param {string} action
 * @param {string} target
 * @param {unknown} error
 * @returns {SnippetError}
 */
function storeError(action, target, error) {
  const detail = error instanceof Error ? error.message : String(error);
  return new SnippetError('store_io', `cannot ${action} ${target}: ${detail}`, { cause: error });
}

/**
 * Write one JSON document atomically: temp file in the same directory, then
 * rename. The temp name is unique per process and per call, so a failure leaves
 * no file that could be mistaken for an object.
 *
 * @param {string} directory
 * @param {string} fileName
 * @param {unknown} document
 * @returns {Promise<void>}
 */
async function writeJsonAtomic(directory, fileName, document) {
  const target = path.join(directory, fileName);
  const temporary = path.join(
    directory,
    `.${fileName}.${process.pid}.${randomUUID()}.tmp`,
  );
  const text = `${JSON.stringify(document, null, 2)}\n`;
  try {
    await writeFile(temporary, text, { encoding: 'utf8', flag: 'wx' });
    await rename(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw storeError('write', target, error);
  }
}

/**
 * Create one store over a directory.
 *
 * The directory is created on the first publish, never by the factory and never
 * by a read: a store pointed at a directory that does not exist yet is a valid
 * empty library whose reads answer `missing_index`. Two stores over the same
 * directory are two writers and are not coordinated; one service owns one
 * directory, which is what `data/snippets/` is for.
 *
 * @param {{directory: string}} options
 * @returns {Readonly<{
 *   directory: string,
 *   list: () => Promise<ReadonlyArray<SnippetEntry>>,
 *   read: (nameOrHash: string, options?: {hash?: string | null}) => Promise<ReadSnippet>,
 *   publish: (input: {name: string, cells: ReadonlyArray<Cell>, width: number,
 *     height: number, expectedHash?: string | null}) =>
 *     Promise<{name: string, hash: string, width: number, height: number,
 *       cellCount: number, createdObject: boolean, replaced: boolean}>,
 *   remove: (name: string, options?: {expectedHash?: string | null}) =>
 *     Promise<SnippetEntry>,
 * }>}
 */
export function createSnippetStore(options) {
  if (!isPlainObject(options) || typeof options.directory !== 'string' || options.directory === '') {
    throw new TypeError('createSnippetStore needs { directory: <non-empty string> }');
  }
  const directory = path.resolve(options.directory);
  const indexPath = path.join(directory, SNIPPET_INDEX_FILE);

  // Publishes and removes are read-modify-write of the index, so one store
  // serialises them. Reads do not need the queue: an index or object is only
  // ever replaced by a rename, so a reader sees one complete document.
  let tail = Promise.resolve();
  /** @template T @param {() => Promise<T>} task @returns {Promise<T>} */
  const serialize = (task) => {
    const result = tail.then(task);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const objectPath = (hash) => path.join(directory, `${hash}.json`);

  async function readIndexText() {
    try {
      return await readFile(indexPath, 'utf8');
    } catch (error) {
      if (error && /** @type {{code?: string}} */ (error).code === 'ENOENT') {
        fail('missing_index', `there is no snippet index at ${indexPath}`);
      }
      throw storeError('read', indexPath, error);
    }
  }

  /**
   * Parse and validate the index.
   *
   * Everything the publish path would refuse is a corrupt index here, including
   * a name that shape does not accept and a hash-shaped name: a reader must not
   * act on an entry it could not have written.
   *
   * @param {string} text
   * @returns {Record<string, IndexEntry>}
   */
  function parseIndex(text) {
    let document;
    try {
      document = JSON.parse(stripBom(text));
    } catch (error) {
      fail(
        'corrupt_index',
        `the snippet index at ${indexPath} is not JSON: ${error instanceof Error ? error.message : error}`,
      );
    }
    if (
      !isPlainObject(document) ||
      document.format !== SNIPPET_INDEX_FORMAT ||
      document.version !== SNIPPET_INDEX_VERSION ||
      !isPlainObject(document.snippets)
    ) {
      fail(
        'corrupt_index',
        `the snippet index at ${indexPath} is not ${SNIPPET_INDEX_FORMAT} version ` +
          `${SNIPPET_INDEX_VERSION}`,
      );
    }
    const snippets = Object.create(null);
    for (const [name, entry] of Object.entries(document.snippets)) {
      try {
        validateSnippetName(name);
      } catch (error) {
        fail(
          'corrupt_index',
          `the snippet index at ${indexPath} has an invalid name ${JSON.stringify(name)}: ` +
            `${error instanceof Error ? error.message : error}`,
        );
      }
      if (!isPlainObject(entry)) {
        fail('corrupt_index', `the snippet index at ${indexPath} has no metadata for ${JSON.stringify(name)}`);
      }
      if (!isContentHash(entry.hash)) {
        fail(
          'corrupt_index',
          `the snippet index at ${indexPath} has an invalid hash for ${JSON.stringify(name)}`,
        );
      }
      if (
        !Number.isSafeInteger(entry.width) ||
        entry.width < 1 ||
        !Number.isSafeInteger(entry.height) ||
        entry.height < 1 ||
        !Number.isSafeInteger(entry.cellCount) ||
        entry.cellCount < 0
      ) {
        fail(
          'corrupt_index',
          `the snippet index at ${indexPath} has invalid metadata for ${JSON.stringify(name)}`,
        );
      }
      snippets[name] = {
        hash: entry.hash,
        width: entry.width,
        height: entry.height,
        cellCount: entry.cellCount,
      };
    }
    return snippets;
  }

  async function readIndex() {
    return parseIndex(await readIndexText());
  }

  /** The index for a write: a missing one is a new library; a corrupt one is not. */
  async function readIndexForWrite() {
    try {
      return parseIndex(await readIndexText());
    } catch (error) {
      if (error instanceof SnippetError && error.code === 'missing_index') {
        return Object.create(null);
      }
      throw error;
    }
  }

  /** The index document with names in a stable order, so the file is diffable. */
  function indexDocument(snippets) {
    const ordered = Object.create(null);
    for (const name of Object.keys(snippets).sort()) ordered[name] = snippets[name];
    return { format: SNIPPET_INDEX_FORMAT, version: SNIPPET_INDEX_VERSION, snippets: ordered };
  }

  const objectDocument = (value, hash) => ({
    format: SNIPPET_FORMAT,
    version: SNIPPET_FORMAT_VERSION,
    contentHash: hash,
    width: value.width,
    height: value.height,
    cells: value.cells,
  });

  async function objectExists(target) {
    try {
      const info = await stat(target);
      return info.isFile();
    } catch (error) {
      if (error && /** @type {{code?: string}} */ (error).code === 'ENOENT') return false;
      throw storeError('inspect', target, error);
    }
  }

  /**
   * Read and validate one content object.
   *
   * The file name, the embedded `contentHash` and the recomputed hash must all
   * agree. The size limits are enforced here as well as on publish, so a
   * hand-edited object cannot be read back as a snippet larger than the product
   * allows; that refusal keeps its own `too_large` code.
   *
   * @param {string} hash
   * @returns {Promise<SnippetValue>}
   */
  async function readObject(hash) {
    validateHash(hash, 'hash');
    const file = objectPath(hash);
    let text;
    try {
      text = await readFile(file, 'utf8');
    } catch (error) {
      if (error && /** @type {{code?: string}} */ (error).code === 'ENOENT') {
        fail('missing_object', `there is no snippet object for hash ${hash}`);
      }
      throw storeError('read', file, error);
    }
    let document;
    try {
      document = JSON.parse(stripBom(text));
    } catch (error) {
      fail(
        'invalid_content',
        `the snippet object at ${file} is not JSON: ${error instanceof Error ? error.message : error}`,
      );
    }
    if (
      !isPlainObject(document) ||
      document.format !== SNIPPET_FORMAT ||
      document.version !== SNIPPET_FORMAT_VERSION ||
      document.contentHash !== hash
    ) {
      fail('invalid_content', `the snippet object at ${file} is not ${SNIPPET_FORMAT} version ` +
        `${SNIPPET_FORMAT_VERSION} for hash ${hash}`);
    }
    let value;
    try {
      value = validateSnippet(document);
    } catch (error) {
      if (error instanceof SnippetError && error.code === 'too_large') throw error;
      fail(
        'invalid_content',
        `the snippet object at ${file} is not a valid snippet: ` +
          `${error instanceof Error ? error.message : error}`,
      );
    }
    const computed = hashCanonical(value);
    if (computed !== hash) {
      fail('invalid_content', `the snippet object at ${file} hashes to ${computed}, not ${hash}`);
    }
    return value;
  }

  /**
   * Every index entry, sorted by name. The content is not included: a palette
   * needs the metadata, and the cells are read when a snippet is placed.
   *
   * @returns {Promise<ReadonlyArray<SnippetEntry>>}
   */
  async function list() {
    const snippets = await readIndex();
    const entries = Object.entries(snippets).map(([name, entry]) =>
      Object.freeze({ name, ...entry }),
    );
    entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    return Object.freeze(entries);
  }

  /**
   * Read a snippet by name, or by content hash.
   *
   * With `{hash}`, the first argument is a name and the index entry must hold
   * that hash (the `name@hash` pin). Without it, a 64-character lower-case hex
   * argument is a content hash and is read without consulting the index; every
   * other argument is a name.
   *
   * @param {string} nameOrHash
   * @param {{hash?: string | null}} [options]
   * @returns {Promise<ReadSnippet>}
   */
  async function read(nameOrHash, options = {}) {
    if (!isPlainObject(options)) {
      throw new TypeError('read options must be an object');
    }
    const pinned =
      options.hash === undefined || options.hash === null
        ? null
        : validateHash(options.hash, 'hash');
    /** @type {IndexEntry | null} */
    let entry = null;
    let name = null;
    let hash;
    if (pinned !== null) {
      validateSnippetName(nameOrHash);
      const snippets = await readIndex();
      entry = Object.hasOwn(snippets, nameOrHash) ? snippets[nameOrHash] : null;
      if (entry === null) {
        fail('unknown_snippet', `no snippet is named ${JSON.stringify(nameOrHash)}`);
      }
      if (entry.hash !== pinned) {
        fail(
          'hash_mismatch',
          `snippet ${JSON.stringify(nameOrHash)} holds content ${entry.hash}, not the pinned ${pinned}`,
        );
      }
      name = nameOrHash;
      hash = pinned;
    } else if (isContentHash(nameOrHash)) {
      hash = nameOrHash;
    } else {
      validateSnippetName(nameOrHash);
      const snippets = await readIndex();
      entry = Object.hasOwn(snippets, nameOrHash) ? snippets[nameOrHash] : null;
      if (entry === null) {
        fail('unknown_snippet', `no snippet is named ${JSON.stringify(nameOrHash)}`);
      }
      name = nameOrHash;
      hash = entry.hash;
    }
    const value = await readObject(hash);
    if (entry !== null) {
      if (
        entry.width !== value.width ||
        entry.height !== value.height ||
        entry.cellCount !== value.cellCount
      ) {
        fail(
          'corrupt_index',
          `the snippet index at ${indexPath} describes ${JSON.stringify(name)} as ` +
            `${entry.width} x ${entry.height} with ${entry.cellCount} cells, but its object is ` +
            `${value.width} x ${value.height} with ${value.cellCount} cells`,
        );
      }
    }
    return Object.freeze({
      name,
      hash,
      cells: value.cells,
      width: value.width,
      height: value.height,
      cellCount: value.cellCount,
    });
  }

  /**
   * Publish a snippet under a name.
   *
   * Identical content under the same name is idempotent. Different content under
   * an existing name needs `expectedHash` to equal the hash the name holds now;
   * without a pin it is `name_conflict`, and with a stale pin it is
   * `hash_mismatch`. A pin is a compare-and-swap, so pinning a name that does not
   * exist is `unknown_snippet` rather than a silent create. None of those
   * refusals changes the index. The content object is written before the index,
   * so a failure between the two leaves an orphan object (harmless) rather than
   * an index entry with no object.
   *
   * @param {{name: string, cells: ReadonlyArray<Cell>, width: number, height: number,
   *   expectedHash?: string | null}} input
   * @returns {Promise<{name: string, hash: string, width: number, height: number,
   *   cellCount: number, createdObject: boolean, replaced: boolean}>}
   */
  async function publish(input) {
    if (!isPlainObject(input)) {
      throw new TypeError('publish needs { name, cells, width, height }');
    }
    const { name, cells, width, height, expectedHash } = input;
    validateSnippetName(name);
    const pinned =
      expectedHash === undefined || expectedHash === null
        ? null
        : validateHash(expectedHash, 'expectedHash');
    const value = validateSnippet({ cells, width, height });
    const hash = hashCanonical(value);
    return serialize(async () => {
      try {
        await mkdir(directory, { recursive: true });
      } catch (error) {
        throw storeError('create', directory, error);
      }
      const snippets = await readIndexForWrite();
      const current = Object.hasOwn(snippets, name) ? snippets[name] : null;
      if (pinned !== null && current === null) {
        fail(
          'unknown_snippet',
          `no snippet is named ${JSON.stringify(name)}, so it cannot hold the pinned ${pinned}`,
        );
      }
      if (current !== null) {
        if (pinned !== null && current.hash !== pinned) {
          fail(
            'hash_mismatch',
            `snippet ${JSON.stringify(name)} holds content ${current.hash}, not the pinned ${pinned}`,
          );
        }
        if (current.hash !== hash && pinned === null) {
          fail(
            'name_conflict',
            `snippet ${JSON.stringify(name)} already holds content ${current.hash}; ` +
              'pass expectedHash to replace it',
          );
        }
      }
      const target = objectPath(hash);
      let createdObject = false;
      if (!(await objectExists(target))) {
        await writeJsonAtomic(directory, `${hash}.json`, objectDocument(value, hash));
        createdObject = true;
      }
      const replaced = current !== null && current.hash !== hash;
      if (current === null || replaced) {
        snippets[name] = {
          hash,
          width: value.width,
          height: value.height,
          cellCount: value.cellCount,
        };
        await writeJsonAtomic(directory, SNIPPET_INDEX_FILE, indexDocument(snippets));
      }
      return Object.freeze({
        name,
        hash,
        width: value.width,
        height: value.height,
        cellCount: value.cellCount,
        createdObject,
        replaced,
      });
    });
  }

  /**
   * Remove one name from the index. The content object stays: it is immutable
   * and another name may reference the same hash (ADR 0014). A pinned
   * `expectedHash` makes the delete conditional, so a client that saw a
   * different content cannot delete somebody else's publish.
   *
   * @param {string} name
   * @param {{expectedHash?: string | null}} [options]
   * @returns {Promise<SnippetEntry>}
   */
  async function remove(name, options = {}) {
    if (!isPlainObject(options)) {
      throw new TypeError('remove options must be an object');
    }
    validateSnippetName(name);
    const pinned =
      options.expectedHash === undefined || options.expectedHash === null
        ? null
        : validateHash(options.expectedHash, 'expectedHash');
    return serialize(async () => {
      const snippets = await readIndex();
      const entry = Object.hasOwn(snippets, name) ? snippets[name] : null;
      if (entry === null) {
        fail('unknown_snippet', `no snippet is named ${JSON.stringify(name)}`);
      }
      if (pinned !== null && entry.hash !== pinned) {
        fail(
          'hash_mismatch',
          `snippet ${JSON.stringify(name)} holds content ${entry.hash}, not the pinned ${pinned}`,
        );
      }
      delete snippets[name];
      await writeJsonAtomic(directory, SNIPPET_INDEX_FILE, indexDocument(snippets));
      return Object.freeze({ name, ...entry });
    });
  }

  return Object.freeze({ directory, list, read, publish, remove });
}
