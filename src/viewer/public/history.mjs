/**
 * lifegame viewer — the recorded history as a tree, as pure functions.
 *
 * The core hands back nodes that name their parent, and that is the whole shape:
 * a node whose parent is missing from the list starts a branch, and every other
 * node hangs below its parent. What is *not* obvious is how deep a node is drawn,
 * and that is what this module decides.
 *
 * **Indentation is fork depth, not tree depth.** A linear run of twenty
 * generations is one column, because nothing branched: indenting by absolute
 * depth would walk the twentieth row off the right edge of the panel while
 * saying nothing a generation number does not already say. A level is added
 * **only** where the tree actually parts — a node with more than one child — so
 * two siblings of a fork are drawn at the same level, one step in from their
 * parent, and every node in a chain stays beside the one before it.
 *
 * **The indentation is capped.** Six levels is already wider than any panel
 * offers; past that a row stops moving right rather than escaping the view. The
 * cap is a property of the drawing, so it lives here beside the depth it caps
 * rather than in the stylesheet, and `node --test` can check it.
 *
 * **A level carries a connector, not only an offset.** Indentation alone says
 * "something is nested here"; it does not say *which* parent, nor which of two
 * siblings continues below. Each level therefore also carries a guide kind —
 * `line` for a branch that has a later sibling, `elbow` where a branch starts
 * and something follows it, `end` where a branch starts and nothing does, and
 * `blank` for a chain below the last branch — which is what the stylesheet draws
 * as a connector. That is deliberately arithmetic rather than markup: two
 * branches of one fork are told apart by a glyph and a letter, and a test can
 * assert both.
 *
 * **The preview centres on the nearest live cell to where the world page was.**
 * `nearestCell` and `previewFocus` are here because they are rules about the
 * recorded world rather than about a canvas: the page measures, this module
 * decides.
 *
 * **A node carries the rule that produced it, and the two can disagree.**
 * `ruleGap` compares the selected generation's own rule with the rule in force
 * and answers what there is to say, so the history page states a difference
 * rather than acting on it: the rule changes only when a person presses the
 * button beside the statement.
 *
 * The window is the third rule. A long run records a generation per tick, so the
 * newest `timelineWindow` rows are shown with a control that widens the window;
 * cutting from the beginning can leave a row whose parent is not shown, and such
 * a row is treated as a root. `renderTimeline` rebases the shallowest row still
 * shown on zero, which is what keeps a window from rendering as a staircase.
 */

import { worldCentre } from './viewport.mjs';

/**
 * The most levels a row may be indented by.
 *
 * The level width is the stylesheet's (14 px in style.css); six of them is 84 px,
 * which leaves the generation, the branch mark and the node's numbers inside a
 * panel `min(360px, 42vw)` wide. A deeper tree flattens rather than overflowing,
 * because a row that cannot be read is worse than a row that is not indented.
 */
export const MAX_INDENT_LEVELS = 6;

/**
 * The indentation level for a fork depth.
 *
 * Negative input is clamped to zero: a window that starts below a fork can make
 * the rebased depth negative, and a negative `--depth` would be a negative CSS
 * offset. A value that is not a number at all means "no information", which is
 * no indentation; anything beyond the cap — including an infinite depth, which
 * a corrupt store could produce — is drawn at the cap.
 */
export function indentLevel(forkDepth) {
  const depth = typeof forkDepth === 'number' ? forkDepth : Number(forkDepth);
  if (Number.isNaN(depth)) return 0;
  return Math.min(Math.max(Math.round(depth), 0), MAX_INDENT_LEVELS);
}

/** `a`, `b`, `c` … for the children of a fork, so two branches are named. */
function branchLetter(index) {
  return String.fromCharCode(97 + index);
}

/**
 * The guide kinds a level can carry, as the stylesheet's class suffixes.
 *
 * `line` continues a branch past this row, `elbow` starts a branch that has a
 * sibling after it, `end` starts the last branch of a fork, and `blank` is a
 * chain below the last branch: nothing is drawn, and the row is still indented.
 */
export const GUIDE_KINDS = Object.freeze(['line', 'elbow', 'end', 'blank']);

/**
 * Flatten the recorded nodes into the order a person reads a tree.
 *
 * Depth-first with the children in id order puts the oldest work first and the
 * newest last, which keeps the reading order the flat list had while making a
 * fork visible as two rows at the same level. A node with more than one child is
 * a fork: each of its children gets a letter, so two branches are told apart by
 * name and not only by indentation, and each level gets a guide kind, so the
 * rows between two of them show the line that joins them.
 *
 * @param {{id: number, parent: number|null|undefined, generation: number}[]} rows
 * @returns {{flat: {row: object, depth: number, branch: string|null, forks: boolean,
 *            guides: string[]}[],
 *            children: Map<number, object[]>}}
 */
export function flattenHistory(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const known = new Set(list.map((row) => row.id));
  const children = new Map();
  const roots = [];
  for (const row of list) {
    if (row.parent === null || row.parent === undefined || !known.has(row.parent)) {
      roots.push(row);
      continue;
    }
    const siblings = children.get(row.parent);
    if (siblings === undefined) children.set(row.parent, [row]);
    else siblings.push(row);
  }
  const flat = [];
  /**
   * `levels` holds one entry per level this node is inside, the last of which is
   * the node's own; `entered` says whether this node is the fork child that
   * created that last level, which is the difference between an elbow and a
   * line continuing through a chain.
   */
  const walk = (row, depth, branch, levels, entered) => {
    const kids = children.get(row.id) ?? [];
    const guides = levels.map((level, index) => {
      const own = index === depth - 1;
      if (own && entered) return level.following ? 'elbow' : 'end';
      return level.following ? 'line' : 'blank';
    });
    flat.push({ row, depth, branch, forks: kids.length > 1, guides });
    // The children of a fork are one level deeper; the child of a chain is not.
    const deeper = kids.length > 1;
    kids.forEach((child, index) => {
      if (deeper) {
        const level = { following: index < kids.length - 1 };
        walk(child, depth + 1, branchLetter(index), [...levels, level], true);
      } else {
        walk(child, depth, branch, levels, false);
      }
    });
  };
  // Several roots happen when the window cut a branch's root, or when the store
  // really holds more than one session. Each starts at the same level.
  const rootBranch = (index) => (roots.length > 1 ? branchLetter(index) : null);
  roots.forEach((root, index) => walk(root, 0, rootBranch(index), [], false));
  return { flat, children };
}

/** The node with the given id, or undefined. A tiny helper both pages share. */
export function nodeById(rows, id) {
  return (Array.isArray(rows) ? rows : []).find((row) => row.id === id);
}

/**
 * The rule the selected generation was recorded under, when it is not the rule
 * now in force.
 *
 * Every node carries the rule that produced it, because a session's rule can
 * change part-way through and a generation is attributable to the rule that
 * made it. A person can then select a node from before that change — and
 * `select` restores the node's **cells, not its rule**, so the world goes on
 * running the new rule over a world the old one produced, while continuing from
 * that node is exactly what they are about to do. This is the decision that
 * says whether there is anything to tell them.
 *
 * **The selected generation is the working point.** The tree marks the node a
 * click selects and the node the next record appends to (`data-head`, the id
 * the history reply names in `head`), and that is the one asked about here.
 *
 * **Both strings come from the data that carries them, and nothing is derived.**
 * The node's own `rule` is the history reply's field; the rule in force is
 * `state.rule`, which the state reply and the stream's `hello` carry. A node the
 * store wrote without a rule, a rule that has not arrived, an id no row answers
 * and two equal rules all produce `null`, which is the page saying nothing.
 *
 * @param {{id: number, rule?: string, generation?: number}[]} rows the recorded nodes
 * @param {number|null|undefined} headId the node the world is on
 * @param {string} currentRule the rule in force, as the state reply reports it
 * @returns {{generation: number|undefined, rule: string, current: string} | null}
 */
export function ruleGap(rows, headId, currentRule) {
  if (headId === null || headId === undefined) return null;
  const node = nodeById(rows, headId);
  if (node === undefined) return null;
  // A field that is not a string is not a rule: the store wrote what the core
  // told it, and inventing a value for one it left out would be a guess. Both
  // strings are the core's canonical notation, so they are compared as written.
  const rule = typeof node.rule === 'string' ? node.rule : '';
  const current = typeof currentRule === 'string' ? currentRule : '';
  if (rule === '' || current === '' || rule === current) return null;
  return { generation: node.generation, rule, current };
}

/**
 * A recorded node's timestamp, as a person reads it.
 *
 * The store writes ISO-8601 (`2026-10-10T08:00:00+00:00`), so a date is the
 * common case and is rendered in the reader's locale. Anything else — an older
 * store that wrote an opaque token, a value the format changed — is shown as it
 * arrived rather than replaced by a placeholder: the value came from the core,
 * and inventing "—" over it would hide a real fact.
 */
export function formatHistoryTime(at, locale, noneLabel) {
  if (at === null || at === undefined || at === '') return noneLabel;
  const text = String(at);
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text;
  return parsed.toLocaleString(locale);
}

/**
 * The live cell nearest to `point`, or `null` when there are none.
 *
 * Squared distance rather than `Math.hypot`: the comparison is the same and the
 * scan is one pass over the live set, which a large world makes worth caring
 * about. A tie keeps the earlier cell, so the answer is a function of the input
 * order and a test can state it exactly.
 *
 * Malformed entries are skipped rather than trusted: this reads a payload that
 * came over the network, and a pair that is not two finite numbers cannot name a
 * cell.
 *
 * @param {Iterable<[number, number]>} cells absolute world coordinates
 * @param {{x: number, y: number}} point
 * @returns {[number, number] | null}
 */
export function nearestCell(cells, point) {
  if (cells === null || cells === undefined || point === null || point === undefined) return null;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const cell of cells) {
    if (!Array.isArray(cell) || cell.length < 2) continue;
    const x = Number(cell[0]);
    const y = Number(cell[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const dx = x - point.x;
    const dy = y - point.y;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = [x, y];
    }
  }
  return best;
}

/**
 * The point a preview should be centred on, and where that point came from.
 *
 * Three sources, in the order the user's own context gives them:
 *
 * 1. **the live set**, when the service could send it: the cell nearest to the
 *    point the world page was last looking at, which is the answer that keeps
 *    the preview where the person's work is;
 * 2. **the bounds** the core reports, when the live set was too large to send.
 *    This is a stated degradation rather than a silent one: the caller is told
 *    by `source`, and the page says so in words;
 * 3. **the world's centre**, when there is nothing alive at all — an empty world
 *    has no nearest cell to find, and the middle of the world is the only honest
 *    answer left.
 *
 * @param {{cells?: Iterable<[number, number]> | null, bounds?: number[] | null,
 *          focus?: {x: number, y: number} | null, world?: object | null}} options
 * @returns {{point: {x: number, y: number}, source: 'nearest' | 'bounds' | 'world'}}
 */
export function previewFocus(options) {
  const { cells = null, bounds = null, focus = null, world = null } = options ?? {};
  const centre = worldCentre(world) ?? { x: 0, y: 0 };
  const wanted = focus ?? centre;
  const nearest = nearestCell(cells, wanted);
  if (nearest !== null) return { point: { x: nearest[0], y: nearest[1] }, source: 'nearest' };
  if (Array.isArray(bounds) && bounds.length === 4 && bounds.every((value) => Number.isFinite(value))) {
    return {
      point: { x: (bounds[0] + bounds[2]) / 2, y: (bounds[1] + bounds[3]) / 2 },
      source: 'bounds',
    };
  }
  return { point: centre, source: 'world' };
}
