/**
 * The snippet library: canonical hashes, the content-addressed directory and the
 * index.
 *
 * The filesystem is real. Each case gets a fresh directory under the repository's
 * `TEMP` — `TEMP` is redirected by `scripts/env.ps1`, so a test cannot write to
 * `C:` and the assertion below says so rather than trusting the caller — and the
 * directory is removed afterwards. Nothing here mocks `node:fs`: a store is only
 * correct if the bytes it writes can be read back by the code that ships.
 *
 * The hash cases pin the canonical text, because a hash is a promise about
 * ordering and duplicates rather than an opaque value: reordering the input or
 * repeating a cell must not create a second object.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  MAX_SNIPPET_CELLS,
  MAX_SNIPPET_NAME_LENGTH,
  MAX_SNIPPET_SIDE,
  SNIPPET_FORMAT,
  SNIPPET_FORMAT_VERSION,
  SNIPPET_INDEX_FILE,
  SNIPPET_INDEX_FORMAT,
  SNIPPET_INDEX_VERSION,
  SnippetError,
  canonicalCells,
  canonicalSnippetText,
  contentHash,
  createSnippetStore,
  encodeCells,
  isContentHash,
  isValidSnippetName,
  validateSnippet,
  validateSnippetName,
} from '../snippets.mjs';

const repositoryRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const repositoryTemp = path.join(repositoryRoot, 'TEMP');

/** True when `child` is `parent` or below it. */
function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Refuse to run with a `TEMP` outside the repository.
 *
 * The repository rule is absolute — no temporary file may be written to `C:` —
 * and this test creates files, so it fails before the first one rather than
 * silently breaking the rule when the environment preamble was skipped.
 */
function assertRepositoryTemp() {
  const actual = path.resolve(tmpdir());
  assert.ok(
    isInside(repositoryTemp, actual),
    `TEMP must be inside ${repositoryTemp} (source scripts/env.ps1 first); got ${actual}`,
  );
}

let temporaryCounter = 0;

/** Create one case directory under the repository's TEMP, removed afterwards. */
async function temporaryDirectory(t) {
  assertRepositoryTemp();
  temporaryCounter += 1;
  const directory = await mkdtemp(
    path.join(tmpdir(), `lifegame-snippets-${process.pid}-${temporaryCounter}-`),
  );
  t.after(async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        await rm(directory, { recursive: true, force: true });
        return;
      } catch (error) {
        if (error.code !== 'EBUSY' && error.code !== 'EPERM') throw error;
        await new Promise((resolve) => {
          setTimeout(resolve, 25);
        });
      }
    }
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

/** A store over a fresh temporary directory. */
async function temporaryStore(t) {
  return createSnippetStore({ directory: await temporaryDirectory(t) });
}

const block = () => ({ cells: [[0, 0], [1, 0], [0, 1], [1, 1]], width: 2, height: 2 });
const blinker = () => ({ cells: [[0, 1], [1, 1], [2, 1]], width: 3, height: 3 });

/** The content objects currently on disk, sorted. */
async function objectFiles(directory) {
  return (await readdir(directory))
    .filter((name) => name.endsWith('.json') && name !== SNIPPET_INDEX_FILE)
    .sort();
}

/** Assert that a promise refuses with one named code. */
async function rejectsWith(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(
      error instanceof SnippetError,
      `expected a SnippetError with code ${code}, got ${error?.constructor?.name}: ${error?.message}`,
    );
    assert.equal(error.code, code);
    return true;
  });
}

/** Assert that a synchronous call refuses with one named code. */
function throwsWith(call, code) {
  assert.throws(call, (error) => {
    assert.ok(
      error instanceof SnippetError,
      `expected a SnippetError with code ${code}, got ${error?.constructor?.name}: ${error?.message}`,
    );
    assert.equal(error.code, code);
    return true;
  });
}

test('a snippet round-trips through publish, list and read', async (t) => {
  const store = await temporaryStore(t);
  const value = blinker();
  const published = await store.publish({ name: 'blinker', ...value });

  assert.equal(published.name, 'blinker');
  assert.equal(published.hash, contentHash(value.cells, value.width, value.height));
  assert.equal(published.width, 3);
  assert.equal(published.height, 3);
  assert.equal(published.cellCount, 3);
  assert.equal(published.createdObject, true);
  assert.equal(published.replaced, false);

  const entries = await store.list();
  assert.deepEqual(entries, [
    { name: 'blinker', hash: published.hash, width: 3, height: 3, cellCount: 3 },
  ]);
  assert.ok(Object.isFrozen(entries));
  assert.ok(Object.isFrozen(entries[0]));

  const byName = await store.read('blinker');
  assert.equal(byName.name, 'blinker');
  assert.equal(byName.hash, published.hash);
  assert.deepEqual(byName.cells, [[0, 1], [1, 1], [2, 1]]);
  assert.equal(byName.width, 3);
  assert.equal(byName.height, 3);
  assert.equal(byName.cellCount, 3);
  assert.ok(Object.isFrozen(byName));
  assert.ok(Object.isFrozen(byName.cells));
  assert.ok(Object.isFrozen(byName.cells[0]));

  const byHash = await store.read(published.hash);
  assert.equal(byHash.name, null);
  assert.equal(byHash.hash, published.hash);
  assert.deepEqual(byHash.cells, byName.cells);

  const pinned = await store.read('blinker', { hash: published.hash });
  assert.deepEqual(pinned.cells, byName.cells);

  // The directory holds exactly the object and the index, and no temporary file.
  const contents = (await readdir(store.directory)).sort();
  assert.deepEqual(contents, [SNIPPET_INDEX_FILE, `${published.hash}.json`].sort());

  const object = JSON.parse(
    await readFile(path.join(store.directory, `${published.hash}.json`), 'utf8'),
  );
  assert.deepEqual(object, {
    format: SNIPPET_FORMAT,
    version: SNIPPET_FORMAT_VERSION,
    contentHash: published.hash,
    width: 3,
    height: 3,
    cells: [[0, 1], [1, 1], [2, 1]],
  });

  const index = JSON.parse(await readFile(path.join(store.directory, SNIPPET_INDEX_FILE), 'utf8'));
  assert.deepEqual(index, {
    format: SNIPPET_INDEX_FORMAT,
    version: SNIPPET_INDEX_VERSION,
    snippets: {
      blinker: { hash: published.hash, width: 3, height: 3, cellCount: 3 },
    },
  });

  await rejectsWith(store.read('no-such-snippet'), 'unknown_snippet');
  await rejectsWith(store.read('f'.repeat(64)), 'missing_object');
  await rejectsWith(store.read('blinker', { hash: '0'.repeat(64) }), 'hash_mismatch');
  await rejectsWith(store.read('blinker', { hash: 'not-a-hash' }), 'invalid_hash');
});

test('the content hash is canonical across input order and duplicate cells', async (t) => {
  const ordered = [[0, 0], [1, 0], [0, 1], [1, 1]];
  const shuffled = [[1, 1], [0, 0], [0, 1], [1, 1], [0, 0], [1, 0]];
  const preimage = 'lifegame-snippet/1\n2x2\n0,0;1,0;0,1;1,1';

  assert.equal(canonicalSnippetText(shuffled, 2, 2), preimage);
  assert.equal(
    contentHash(shuffled, 2, 2),
    createHash('sha256').update(preimage, 'utf8').digest('hex'),
  );
  assert.equal(contentHash(shuffled, 2, 2), contentHash(ordered, 2, 2));
  assert.deepEqual(canonicalCells(shuffled), ordered);
  assert.equal(encodeCells(shuffled), '0,0;1,0;0,1;1,1');
  assert.ok(isContentHash(contentHash(ordered, 2, 2)));
  assert.equal(isContentHash('A'.repeat(64)), false);
  assert.equal(isContentHash('a'.repeat(63)), false);

  const store = await temporaryStore(t);
  const first = await store.publish({ name: 'first', cells: shuffled, width: 2, height: 2 });
  const second = await store.publish({ name: 'second', cells: ordered, width: 2, height: 2 });
  assert.equal(first.hash, second.hash);
  assert.equal(second.createdObject, false);
  assert.deepEqual((await store.read('first')).cells, ordered);
  assert.deepEqual((await store.read('second')).cells, ordered);
});

test('identical content is one object shared by every name', async (t) => {
  const store = await temporaryStore(t);
  const value = block();
  const left = await store.publish({ name: 'left', ...value });
  const right = await store.publish({ name: 'right', ...value });

  assert.equal(left.hash, right.hash);
  assert.equal(left.createdObject, true);
  assert.equal(right.createdObject, false);
  assert.deepEqual(await store.list(), [
    { name: 'left', hash: left.hash, width: 2, height: 2, cellCount: 4 },
    { name: 'right', hash: left.hash, width: 2, height: 2, cellCount: 4 },
  ]);
  assert.deepEqual(await objectFiles(store.directory), [`${left.hash}.json`]);

  // Removing one name leaves the shared object for the other.
  await store.remove('left');
  assert.deepEqual((await store.read('right')).cells, value.cells);
  assert.deepEqual((await store.read(left.hash)).cells, value.cells);
  assert.deepEqual(await objectFiles(store.directory), [`${left.hash}.json`]);
});

test('snippet names are plain identifiers', async (t) => {
  const good = ['block', 'Block-2', 'glider_v1', '0-start', 'g'.repeat(MAX_SNIPPET_NAME_LENGTH)];
  for (const name of good) {
    assert.equal(validateSnippetName(name), name);
    assert.equal(isValidSnippetName(name), true, name);
  }

  const bad = [
    '',
    '.',
    '..',
    'a/b',
    'a\\b',
    'a b',
    '-leading',
    '.hidden',
    'naïve',
    'a\0b',
    'a'.repeat(MAX_SNIPPET_NAME_LENGTH + 1),
    // A name that read-by-hash would mistake for a content hash.
    'a'.repeat(64),
  ];
  for (const name of bad) {
    assert.equal(isValidSnippetName(name), false, JSON.stringify(name));
    throwsWith(() => validateSnippetName(name), 'invalid_name');
  }
  throwsWith(() => validateSnippetName(7), 'invalid_name');
  throwsWith(() => validateSnippetName(null), 'invalid_name');

  const store = await temporaryStore(t);
  await rejectsWith(store.publish({ name: 'a/b', ...block() }), 'invalid_name');
  await rejectsWith(store.publish({ name: 'a'.repeat(64), ...block() }), 'invalid_name');
  await rejectsWith(store.list(), 'missing_index');
});

test('different content under one name needs a matching pinned hash', async (t) => {
  const store = await temporaryStore(t);
  const first = await store.publish({ name: 'shape', ...block() });

  // Publishing the same content again is idempotent, not a conflict.
  const idempotent = await store.publish({ name: 'shape', ...block() });
  assert.equal(idempotent.hash, first.hash);
  assert.equal(idempotent.replaced, false);
  assert.equal(idempotent.createdObject, false);

  // A silent overwrite is refused and changes nothing.
  await rejectsWith(store.publish({ name: 'shape', ...blinker() }), 'name_conflict');
  assert.deepEqual((await store.list()).map((entry) => entry.hash), [first.hash]);

  // A stale pin is refused and changes nothing.
  await rejectsWith(
    store.publish({ name: 'shape', ...blinker(), expectedHash: '0'.repeat(64) }),
    'hash_mismatch',
  );
  assert.deepEqual((await store.list()).map((entry) => entry.hash), [first.hash]);

  // A pin is a compare-and-swap: a name that does not exist cannot hold it.
  await rejectsWith(
    store.publish({ name: 'new-shape', ...block(), expectedHash: first.hash }),
    'unknown_snippet',
  );
  assert.deepEqual((await store.list()).map((entry) => entry.name), ['shape']);
  await rejectsWith(
    store.publish({ name: 'shape', ...blinker(), expectedHash: 'not-a-hash' }),
    'invalid_hash',
  );

  // The pin that matches the current content lets the name move.
  const blinkerHash = contentHash(blinker().cells, blinker().width, blinker().height);
  const replaced = await store.publish({
    name: 'shape',
    ...blinker(),
    expectedHash: first.hash,
  });
  assert.equal(replaced.hash, blinkerHash);
  assert.equal(replaced.replaced, true);
  assert.equal(replaced.createdObject, true);
  assert.deepEqual((await store.read('shape')).cells, blinker().cells);

  // The old object is immutable and stays; only the index moved.
  assert.deepEqual(
    await objectFiles(store.directory),
    [`${first.hash}.json`, `${blinkerHash}.json`].sort(),
  );
  await rejectsWith(
    store.publish({ name: 'shape', ...block(), expectedHash: first.hash }),
    'hash_mismatch',
  );
  assert.equal((await store.read('shape')).hash, blinkerHash);
});

test('remove deletes one index entry and leaves its content object', async (t) => {
  const store = await temporaryStore(t);
  const published = await store.publish({ name: 'shared', ...block() });
  await store.publish({ name: 'other', ...block() });

  await rejectsWith(store.remove('shared', { expectedHash: '0'.repeat(64) }), 'hash_mismatch');
  assert.deepEqual(
    (await store.list()).map((entry) => entry.name),
    ['other', 'shared'],
  );

  const removed = await store.remove('shared', { expectedHash: published.hash });
  assert.deepEqual(removed, {
    name: 'shared',
    hash: published.hash,
    width: 2,
    height: 2,
    cellCount: 4,
  });
  assert.deepEqual((await store.list()).map((entry) => entry.name), ['other']);
  await rejectsWith(store.read('shared'), 'unknown_snippet');
  assert.deepEqual((await store.read('other')).cells, block().cells);
  assert.deepEqual((await store.read(published.hash)).cells, block().cells);
  assert.deepEqual(await objectFiles(store.directory), [`${published.hash}.json`]);

  await store.remove('other');
  assert.deepEqual(await store.list(), []);
  await rejectsWith(store.remove('other'), 'unknown_snippet');
  assert.deepEqual(await objectFiles(store.directory), [`${published.hash}.json`]);
});

test('the side and cell limits are enforced on publish and in the hash', async (t) => {
  const store = await temporaryStore(t);
  throwsWith(() => contentHash([[0, 0]], MAX_SNIPPET_SIDE + 1, 1), 'too_large');
  await rejectsWith(
    store.publish({ name: 'too-wide', cells: [[0, 0]], width: MAX_SNIPPET_SIDE + 1, height: 1 }),
    'too_large',
  );
  await rejectsWith(
    store.publish({ name: 'too-tall', cells: [[0, 0]], width: 1, height: MAX_SNIPPET_SIDE + 1 }),
    'too_large',
  );

  // A full 256 x 33 block is more than the live-cell limit.
  const dense = [];
  for (let y = 0; y < 33; y += 1) {
    for (let x = 0; x < MAX_SNIPPET_SIDE; x += 1) dense.push([x, y]);
  }
  const tooMany = dense.slice(0, MAX_SNIPPET_CELLS + 1);
  assert.equal(tooMany.length, MAX_SNIPPET_CELLS + 1);
  await rejectsWith(
    store.publish({ name: 'too-dense', cells: tooMany, width: MAX_SNIPPET_SIDE, height: 33 }),
    'too_large',
  );

  // Exactly 8192 cells is the boundary the limit allows.
  const full = dense.slice(0, MAX_SNIPPET_CELLS);
  const accepted = await store.publish({
    name: 'full',
    cells: full,
    width: MAX_SNIPPET_SIDE,
    height: 32,
  });
  assert.equal(accepted.cellCount, MAX_SNIPPET_CELLS);

  // Duplicates are removed before the count is taken.
  const duplicated = await store.publish({
    name: 'full-duplicates',
    cells: [...full, [0, 0]],
    width: MAX_SNIPPET_SIDE,
    height: 32,
  });
  assert.equal(duplicated.cellCount, MAX_SNIPPET_CELLS);
  assert.equal(duplicated.hash, accepted.hash);
  assert.equal(duplicated.createdObject, false);

  throwsWith(() => validateSnippet({ cells: [[2, 0]], width: 2, height: 2 }), 'invalid_snippet');
  throwsWith(() => validateSnippet({ cells: [[0, 2]], width: 2, height: 2 }), 'invalid_snippet');
  throwsWith(() => validateSnippet({ cells: [[-1, 0]], width: 2, height: 2 }), 'invalid_snippet');
  throwsWith(() => validateSnippet({ cells: [[0, 0]], width: 0, height: 2 }), 'invalid_snippet');
  throwsWith(() => validateSnippet({ cells: [[0, 0]], width: 2, height: 1.5 }), 'invalid_snippet');
  throwsWith(() => validateSnippet({ cells: [[0, 0, 0]], width: 2, height: 2 }), 'invalid_snippet');
  throwsWith(() => validateSnippet({ cells: 'nope', width: 2, height: 2 }), 'invalid_snippet');
  throwsWith(() => validateSnippet(null), 'invalid_snippet');
});

test('validateSnippet canonicalises, freezes and allows an empty shape', () => {
  const value = validateSnippet({
    cells: [[1, 0], [0, 0], [1, 0], [0, 0]],
    width: 2,
    height: 1,
    contentHash: 'ignored',
  });
  assert.deepEqual(value.cells, [[0, 0], [1, 0]]);
  assert.equal(value.cellCount, 2);
  assert.deepEqual(Object.keys(value).sort(), ['cellCount', 'cells', 'height', 'width']);
  assert.ok(Object.isFrozen(value));
  assert.ok(Object.isFrozen(value.cells));
  assert.ok(Object.isFrozen(value.cells[0]));

  // A box with no live cells is a legal upper-bound case.
  const empty = validateSnippet({ cells: [], width: 2, height: 2 });
  assert.deepEqual(empty.cells, []);
  assert.equal(empty.cellCount, 0);
  assert.equal(
    canonicalSnippetText([], 2, 2),
    'lifegame-snippet/1\n2x2\n',
  );

  assert.throws(() => createSnippetStore(), TypeError);
  assert.throws(() => createSnippetStore({}), TypeError);
  assert.throws(() => createSnippetStore({ directory: '' }), TypeError);
});

test('a missing index is a named error and no read recreates it', async (t) => {
  const parent = await temporaryDirectory(t);
  const directory = path.join(parent, 'not-published-yet');
  const store = createSnippetStore({ directory });

  await rejectsWith(store.list(), 'missing_index');
  await rejectsWith(store.read('block'), 'missing_index');
  await rejectsWith(store.remove('block'), 'missing_index');
  await assert.rejects(
    readdir(directory),
    (error) => error.code === 'ENOENT',
  );

  // A write may create the directory and its first index; that is publish, not
  // a read silently repairing what it found.
  const published = await store.publish({ name: 'block', ...block() });
  assert.equal((await store.list()).length, 1);
  assert.equal((await store.read('block')).hash, published.hash);
  assert.equal(store.directory, path.resolve(directory));
});

test('a corrupt index is reported and never silently recreated', async (t) => {
  const store = await temporaryStore(t);
  const published = await store.publish({ name: 'block', ...block() });
  const indexPath = path.join(store.directory, SNIPPET_INDEX_FILE);
  const corrupt = '{ this is not JSON\n';
  await writeFile(indexPath, corrupt, 'utf8');

  await rejectsWith(store.list(), 'corrupt_index');
  await rejectsWith(store.read('block'), 'corrupt_index');
  await rejectsWith(store.remove('block'), 'corrupt_index');
  await rejectsWith(store.publish({ name: 'other', ...blinker() }), 'corrupt_index');
  assert.equal(await readFile(indexPath, 'utf8'), corrupt);

  // A read by hash does not consult the index, so the object is still readable.
  assert.deepEqual((await store.read(published.hash)).cells, block().cells);

  // A structurally wrong index is corrupt too, not an empty library.
  const wrong = JSON.stringify({
    format: SNIPPET_INDEX_FORMAT,
    version: SNIPPET_INDEX_VERSION,
    snippets: {
      'bad/name': { hash: published.hash, width: 2, height: 2, cellCount: 4 },
    },
  });
  await writeFile(indexPath, wrong, 'utf8');
  await rejectsWith(store.list(), 'corrupt_index');
  assert.equal(await readFile(indexPath, 'utf8'), wrong);
});

test('a content object is checked against its hash and the limits', async (t) => {
  const store = await temporaryStore(t);
  const published = await store.publish({ name: 'block', ...block() });
  const file = path.join(store.directory, `${published.hash}.json`);
  const object = JSON.parse(await readFile(file, 'utf8'));

  // Tampered cells: the file name no longer matches its content.
  await writeFile(file, JSON.stringify({ ...object, cells: [[0, 0]] }), 'utf8');
  await rejectsWith(store.read('block'), 'invalid_content');
  await rejectsWith(store.read(published.hash), 'invalid_content');

  // Not JSON at all.
  await writeFile(file, 'not json', 'utf8');
  await rejectsWith(store.read(published.hash), 'invalid_content');

  // Indexed but the object is gone.
  await unlink(file);
  await rejectsWith(store.read('block'), 'missing_object');
  await rejectsWith(store.read(published.hash), 'missing_object');

  // A pinned content object above the limits is refused with `too_large`, even
  // though no publish could have written it.
  const width = MAX_SNIPPET_SIDE + 1;
  const preimage = `lifegame-snippet/1\n${width}x1\n0,0`;
  const oversizedHash = createHash('sha256').update(preimage, 'utf8').digest('hex');
  const oversized = {
    format: SNIPPET_FORMAT,
    version: SNIPPET_FORMAT_VERSION,
    contentHash: oversizedHash,
    width,
    height: 1,
    cells: [[0, 0]],
  };
  await writeFile(
    path.join(store.directory, `${oversizedHash}.json`),
    `${JSON.stringify(oversized, null, 2)}\n`,
    'utf8',
  );
  await rejectsWith(store.read(oversizedHash), 'too_large');
});
