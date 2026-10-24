/**
 * The recorded history as a tree, as arithmetic.
 *
 * Two of these cases are user requirements rather than implementation details:
 *
 * - **A linear run is one column.** Indenting by absolute depth would walk the
 *   twentieth generation off the right edge of the page while saying nothing the
 *   generation number does not already say, so a level is added only where the
 *   tree actually parts.
 * - **Two branches sit at the same level, one step in from their parent.** That
 *   is what makes a fork visible as a fork rather than as a staircase.
 *
 * The rest pins the parts a page cannot get right by accident: the reading order,
 * the branch letters, a window that cuts a branch's root, the cap on a deep tree,
 * and a timestamp the store wrote as ISO-8601.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_INDENT_LEVELS,
  flattenHistory,
  formatHistoryTime,
  indentLevel,
  nearestCell,
  nodeById,
  previewFocus,
  ruleGap,
} from '../public/history.mjs';

/** A linear run of `count` generations, each the child of the one before it. */
function linear(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    parent: index === 0 ? null : index,
    generation: index,
    kind: index === 0 ? 'keyframe' : 'delta',
    population: 5,
    changed: 4,
    at: `2026-10-10T08:00:${String(index % 60).padStart(2, '0')}+00:00`,
  }));
}

/** Node 3 has two children, so it is the fork. */
const FORKED = [
  { id: 1, parent: null, generation: 0, kind: 'keyframe', population: 5, changed: 5, at: 't0' },
  { id: 2, parent: 1, generation: 1, kind: 'delta', population: 5, changed: 4, at: 't1' },
  { id: 3, parent: 2, generation: 2, kind: 'keyframe', population: 5, changed: 1, at: 't2' },
  { id: 4, parent: 3, generation: 3, kind: 'delta', population: 5, changed: 4, at: 't3' },
  { id: 5, parent: 3, generation: 2, kind: 'keyframe', population: 6, changed: 1, at: 't4' },
  { id: 6, parent: 5, generation: 3, kind: 'delta', population: 6, changed: 4, at: 't5' },
];

/** The drawn level of each node, keyed by id. */
function levelsOf(rows) {
  const { flat } = flattenHistory(rows);
  const base = flat.reduce((lowest, entry) => Math.min(lowest, entry.depth), flat[0]?.depth ?? 0);
  return new Map(flat.map((entry) => [entry.row.id, indentLevel(entry.depth - base)]));
}

test('a linear run of twenty generations is drawn in one column', () => {
  const levels = levelsOf(linear(20));
  assert.equal(levels.size, 20);
  assert.deepEqual([...new Set(levels.values())], [0], 'no node of a chain is indented');
});

test('indentation changes at the fork, and only there', () => {
  const levels = levelsOf(FORKED);
  // Above the fork: one column, including the fork itself.
  assert.equal(levels.get(1), 0);
  assert.equal(levels.get(2), 0);
  assert.equal(levels.get(3), 0, 'the node the branches part from is not itself indented');
  // The two branches: both one step in, and the same step as each other.
  assert.equal(levels.get(4), 1);
  assert.equal(levels.get(5), 1);
  assert.ok(levels.get(4) > levels.get(3) && levels.get(5) > levels.get(3));
  assert.equal(levels.get(4), levels.get(5));
  // And a chain below a branch adds nothing.
  assert.equal(levels.get(6), levels.get(5));
});

test('a chain of forks is capped, so no row can leave the page', () => {
  // Twelve forks in a row, following the first child each time: without the cap
  // the last row would be indented by twelve levels, which is wider than any
  // panel this page is drawn in.
  const rows = [];
  let id = 0;
  let parent = null;
  for (let level = 0; level < 12; level += 1) {
    id += 1;
    const node = { id, parent, generation: level, kind: 'delta' };
    rows.push(node);
    id += 1;
    // The sibling is what turns `parent` — and so every later node too — into a
    // fork, which is the only thing that adds a level.
    rows.push({ id, parent, generation: level, kind: 'delta' });
    parent = node.id;
  }
  const { flat } = flattenHistory(rows);
  const deepest = Math.max(...flat.map((entry) => entry.depth));
  assert.ok(deepest > MAX_INDENT_LEVELS, `expected a tree deeper than the cap, saw ${deepest}`);
  const levels = new Set(flat.map((entry) => indentLevel(entry.depth)));
  assert.ok(
    [...levels].every((level) => level <= MAX_INDENT_LEVELS),
    `a drawn level escaped the cap: ${[...levels].join(', ')}`,
  );
  assert.ok(levels.has(MAX_INDENT_LEVELS), 'the cap is actually reached');
});

test('indentLevel is defensive about what it is handed', () => {
  assert.equal(indentLevel(0), 0);
  assert.equal(indentLevel(3), 3);
  assert.equal(indentLevel(MAX_INDENT_LEVELS), MAX_INDENT_LEVELS);
  assert.equal(indentLevel(MAX_INDENT_LEVELS + 20), MAX_INDENT_LEVELS);
  assert.equal(indentLevel(-4), 0, 'a window can make a rebased depth negative');
  assert.equal(indentLevel(Number.NaN), 0);
  assert.equal(indentLevel(Number.POSITIVE_INFINITY), MAX_INDENT_LEVELS);
  assert.equal(indentLevel(2.6), 3, 'a depth is a whole number of levels');
});

test('the tree is flattened depth first, oldest first', () => {
  const { flat } = flattenHistory(FORKED);
  assert.deepEqual(
    flat.map((entry) => entry.row.id),
    [1, 2, 3, 4, 5, 6],
    'a node is followed by its children before its siblings',
  );
  const { children } = flattenHistory(FORKED);
  assert.deepEqual(children.get(3).map((row) => row.id), [4, 5]);
  assert.equal(children.get(1).map((row) => row.id)[0], 2);
});

test('only the children of a fork are given a branch letter', () => {
  const { flat } = flattenHistory(FORKED);
  const branch = new Map(flat.map((entry) => [entry.row.id, entry.branch]));
  assert.equal(branch.get(4), 'a');
  assert.equal(branch.get(5), 'b');
  assert.equal(branch.get(2), null, 'an only child is not a branch');
  assert.equal(branch.get(3), null);
  const forks = new Map(flat.map((entry) => [entry.row.id, entry.forks]));
  assert.equal(forks.get(3), true);
  assert.equal(forks.get(2), false);
  assert.equal(forks.get(6), false);
});

test('a window that cuts a branch root renders the orphan as a root', () => {
  // The window slices from the beginning, so the row that survives may name a
  // parent that is not in the list. It is a root for drawing purposes, and so is
  // a second session's first node.
  const rows = [
    { id: 5, parent: 3, generation: 4, kind: 'delta' },
    { id: 6, parent: 5, generation: 5, kind: 'delta' },
    { id: 7, parent: null, generation: 0, kind: 'keyframe' },
  ];
  const { flat } = flattenHistory(rows);
  assert.deepEqual(
    flat.map((entry) => [entry.row.id, entry.depth]),
    [
      [5, 0],
      [6, 0],
      [7, 0],
    ],
    'orphans and roots start at the same level; a chain below one adds nothing',
  );
  const branches = new Map(flat.map((entry) => [entry.row.id, entry.branch]));
  assert.equal(branches.get(5), 'a', 'two roots are told apart by a letter');
  assert.equal(branches.get(7), 'b');
});

test('an empty or malformed list flattens to nothing rather than throwing', () => {
  for (const input of [[], null, undefined, 'nonsense']) {
    const { flat, children } = flattenHistory(input);
    assert.deepEqual(flat, []);
    assert.equal(children.size, 0);
  }
});

test('nodeById finds a node, and says so when it is not there', () => {
  assert.equal(nodeById(FORKED, 5).generation, 2);
  assert.equal(nodeById(FORKED, 99), undefined);
  assert.equal(nodeById(null, 1), undefined);
});

test('a recorded timestamp is shown as ISO-8601 wrote it, readably', () => {
  const iso = '2026-10-10T08:00:00+00:00';
  const rendered = formatHistoryTime(iso, 'en-US', '—');
  assert.notEqual(rendered, iso, 'an ISO stamp is rendered, not echoed');
  assert.match(rendered, /2026/);
  // A value the format did not write is shown as it arrived: it came from the
  // core, and replacing it with a placeholder would hide a real fact.
  assert.equal(formatHistoryTime('t4', 'en-US', '—'), 't4');
  assert.equal(formatHistoryTime('', 'en-US', '—'), '—');
  assert.equal(formatHistoryTime(null, 'en-US', '—'), '—');
  assert.equal(formatHistoryTime(undefined, 'en-US', '—'), '—');
});

// -- the connectors --------------------------------------------------------
//
// Indentation says something is nested; a connector says *which* parent and
// whether the branch continues below. Both are the module's arithmetic, so both
// are asserted here rather than through a stylesheet nothing executes.

/** The guide kinds of each node, keyed by id. */
function guidesOf(rows) {
  const { flat } = flattenHistory(rows);
  return new Map(flat.map((entry) => [entry.row.id, entry.guides]));
}

test('two branches of a fork are drawn with an elbow and an end', () => {
  const guides = guidesOf(FORKED);
  assert.deepEqual(guides.get(1), [], 'a root has no level to connect to');
  assert.deepEqual(guides.get(2), [], 'a chain above a fork is still the root column');
  assert.deepEqual(guides.get(3), [], 'the node the branches part from is not itself indented');
  assert.deepEqual(guides.get(4), ['elbow'], 'the first of two branches starts with an elbow');
  assert.deepEqual(guides.get(5), ['end'], 'the last one ends there');
  // A chain below the last branch is indented and draws nothing: there is no
  // sibling below it for a line to continue to.
  assert.deepEqual(guides.get(6), ['blank']);
});

test('a branch that has a sibling after it keeps its line', () => {
  // The fork is node 1. Node 2 is its first branch and has one child of its own,
  // so 4 shares 2's column; because a second branch follows, the vertical line
  // has to run through 4 as well: `line`, not a second elbow.
  const rows = [
    { id: 1, parent: null, generation: 0 },
    { id: 2, parent: 1, generation: 1 },
    { id: 3, parent: 1, generation: 1 },
    { id: 4, parent: 2, generation: 2 },
  ];
  const guides = guidesOf(rows);
  assert.deepEqual(guides.get(2), ['elbow'], 'the first branch of the fork');
  assert.deepEqual(guides.get(3), ['end'], 'and the last one');
  assert.deepEqual(guides.get(4), ['line'], 'a chain inside a branch keeps the branch\'s line');
});

test('a nested fork draws one connector cell per level', () => {
  const rows = [
    { id: 1, parent: null, generation: 0 },
    { id: 2, parent: 1, generation: 1 },
    { id: 3, parent: 1, generation: 1 },
    { id: 4, parent: 3, generation: 2 },
    { id: 5, parent: 3, generation: 2 },
    // A third branch of the outer fork, so the line beside the nested one
    // continues below it rather than stopping at its last row.
    { id: 6, parent: 1, generation: 1 },
  ];
  const guides = guidesOf(rows);
  const { flat } = flattenHistory(rows);
  for (const entry of flat) {
    assert.equal(
      entry.guides.length,
      entry.depth,
      `node ${entry.row.id} must carry one connector per level it is inside`,
    );
  }
  assert.deepEqual(guides.get(3), ['elbow'], 'the branch the nested fork hangs from');
  assert.deepEqual(guides.get(4), ['line', 'elbow'], 'a second level keeps the first level\'s line');
  assert.deepEqual(guides.get(5), ['line', 'end']);
  assert.deepEqual(guides.get(6), ['end'], 'and the outer fork ends after the nested one');
});

test('every guide kind is one of the four the stylesheet draws', () => {
  const kinds = new Set();
  for (const rows of [FORKED, linear(20)]) {
    for (const guides of guidesOf(rows).values()) for (const kind of guides) kinds.add(kind);
  }
  for (const kind of kinds) {
    assert.ok(
      ['line', 'elbow', 'end', 'blank'].includes(kind),
      `${kind} is not a guide kind the stylesheet has a rule for`,
    );
  }
  assert.ok(kinds.has('elbow') && kinds.has('end'), `expected a fork, saw ${[...kinds].join(', ')}`);
});

// -- the preview's centre --------------------------------------------------

const LIVE = [
  [10, 10],
  [1000, 1000],
  [-5, 40],
];

test('the nearest live cell is the one with the smallest squared distance', () => {
  assert.deepEqual(nearestCell(LIVE, { x: 900, y: 900 }), [1000, 1000]);
  assert.deepEqual(nearestCell(LIVE, { x: -10, y: 40 }), [-5, 40]);
  assert.deepEqual(nearestCell(LIVE, { x: 12, y: 12 }), [10, 10]);
  // A tie keeps the earlier cell, so the answer is a function of the input.
  assert.deepEqual(nearestCell([[0, 5], [10, 5]], { x: 5, y: 5 }), [0, 5]);
});

test('no live cells, or none to read, has no nearest cell', () => {
  assert.equal(nearestCell([], { x: 1, y: 1 }), null);
  assert.equal(nearestCell(null, { x: 1, y: 1 }), null);
  assert.equal(nearestCell(LIVE, null), null);
  assert.equal(nearestCell(LIVE, { x: Number.NaN, y: 0 }), null);
  assert.deepEqual(
    nearestCell([[1], ['x', 2], [3, 4]], { x: 0, y: 0 }),
    [3, 4],
    'malformed pairs are skipped',
  );
});

test('the preview looks at the nearest cell to where the world page was', () => {
  const decided = previewFocus({
    cells: LIVE,
    bounds: [0, 0, 2000, 2000],
    focus: { x: 990, y: 990 },
    world: { width: 65536, height: 65536 },
  });
  assert.equal(decided.source, 'nearest');
  assert.deepEqual(decided.point, { x: 1000, y: 1000 });
});

test('without a live set the preview falls back to the bounds, and says so', () => {
  const decided = previewFocus({
    cells: null,
    bounds: [10, 20, 30, 60],
    focus: { x: 0, y: 0 },
    world: { width: 65536, height: 65536 },
  });
  assert.equal(decided.source, 'bounds');
  assert.deepEqual(decided.point, { x: 20, y: 40 });
});

test('an empty world falls back to the middle of the world', () => {
  const decided = previewFocus({
    cells: [],
    bounds: null,
    focus: { x: 10, y: 10 },
    world: { width: 64, height: 48 },
  });
  assert.equal(decided.source, 'world');
  assert.deepEqual(decided.point, { x: 32, y: 24 });
  // No remembered focus and no world either: the origin is the only point left,
  // and the caller is told which source it came from.
  assert.equal(previewFocus({ cells: [], bounds: null, focus: null, world: null }).source, 'world');
  assert.deepEqual(previewFocus({}).point, { x: 0, y: 0 });
});

test('a remembered focus that is missing does not move the fallback', () => {
  // The world route has not been visited: the preview centres on the world, not
  // on (0, 0) of a world it never saw.
  const decided = previewFocus({
    cells: [],
    bounds: null,
    focus: null,
    world: { width: 100, height: 100 },
  });
  assert.deepEqual(decided.point, { x: 50, y: 50 });
});

// -- the rule the selected generation ran ----------------------------------

/** Two generations, the second of them produced by a different rule. */
const RULED = [
  { id: 1, parent: null, generation: 0, rule: 'B3/S23' },
  { id: 2, parent: 1, generation: 1, rule: 'B36/S23' },
];

test('the selected generation is compared with the rule in force', () => {
  // The two strings are the data's own: the node's `rule` from the history reply
  // and the rule in force from the state reply. Nothing else is consulted.
  assert.deepEqual(ruleGap(RULED, 1, 'B36/S23'), {
    generation: 0,
    rule: 'B3/S23',
    current: 'B36/S23',
  });
  assert.equal(ruleGap(RULED, 2, 'B36/S23'), null, 'the rule that made it is the one running');
  assert.equal(ruleGap(RULED, 1, 'B3/S23'), null, 'and so is the other one, from the other side');
  // The comparison is by the selected node, not by the generation number: two
  // branches can share a number and be produced by two different rules.
  assert.deepEqual(ruleGap(RULED, 2, 'B3/S23'), {
    generation: 1,
    rule: 'B36/S23',
    current: 'B3/S23',
  });
});

test('nothing to compare leaves nothing to say', () => {
  assert.equal(ruleGap(RULED, null, 'B3/S23'), null, 'no generation is selected');
  assert.equal(ruleGap(RULED, undefined, 'B3/S23'), null);
  assert.equal(ruleGap(RULED, 9, 'B3/S23'), null, 'no row answers to that id');
  assert.equal(ruleGap([], 1, 'B3/S23'), null);
  assert.equal(ruleGap(null, 1, 'B3/S23'), null);
  assert.equal(ruleGap(RULED, 1, ''), null, 'the rule in force has not arrived yet');
  assert.equal(ruleGap(RULED, 1, null), null);
  assert.equal(ruleGap(RULED, 1, undefined), null);
});

test('a node without a rule is not guessed at', () => {
  // A store that wrote no rule for a generation, or wrote something that is not
  // a rule, leaves the page silent: the field is where the answer comes from, and
  // a generation number or a parent cannot stand in for it.
  assert.equal(ruleGap([{ id: 1, parent: null, generation: 0 }], 1, 'B36/S23'), null);
  assert.equal(ruleGap([{ id: 1, parent: null, generation: 0, rule: null }], 1, 'B36/S23'), null);
  assert.equal(ruleGap([{ id: 1, parent: null, generation: 0, rule: 7 }], 1, 'B36/S23'), null);
  assert.equal(ruleGap([{ id: 1, parent: null, generation: 0, rule: '' }], 1, 'B36/S23'), null);
});
