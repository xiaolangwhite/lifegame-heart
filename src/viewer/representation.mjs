/**
 * lifegame viewer — choosing the storage from the shape of the population.
 *
 * The measurement in `docs/plan/PERFORMANCE_ACCEPTANCE.md` §5.2 found two
 * regimes, and the difference is **spatial**, not a matter of population alone:
 *
 * - a packed population of 4,000 cells in four active tiles steps in 0.33 ms on
 *   the tiled world and 1.37 ms on the sparse one, so tiled wins above roughly
 *   4,000 cells;
 * - the same 4,000 cells spread one block per tile (256 active tiles) costs the
 *   tiled world 2.00 ms against the sparse world's 1.40 ms, because every
 *   isolated tile pays for eight neighbours that hold nothing.
 *
 * The service already has the live set and a switch that keeps the world, so the
 * decision belongs here rather than in a caller's head. This module is the
 * decision alone: pure, no I/O, no knowledge of the core's process.
 *
 * The two measured shapes bound the answer but do not fill the space between
 * them. The density boundary below is **chosen between the measured anchors**
 * (packed ≈ 0.24, spread ≈ 0.004) and is not itself measured; that gap is
 * recorded in the module's `risks.md` rather than claimed away.
 */

/** The population below which the sparse world wins whatever the shape: measured. */
export const TILED_MIN_POPULATION = 4000;

/**
 * The live-cell density at which the tiled world is chosen.
 *
 * Density is live cells divided by the area of their bounding box. The measured
 * packed shape is about 0.24 and the measured spread shape about 0.004; the
 * boundary is placed between them, closer to the spread side because the tiled
 * step's per-tile neighbour work is paid even by a nearly empty tile.
 */
export const TILED_MIN_DENSITY = 0.05;

/** The representations this module chooses between. The core advertises which exist. */
export const REPRESENTATIONS = Object.freeze(['sparse', 'tiled']);

/**
 * The bounding box of a set of `[x, y]` cells, or `null` for none.
 *
 * The box, not the convex hull or the live count: the tiled world's cost follows
 * the number of tiles the population touches, and a box is the cheapest honest
 * proxy for that without a second copy of the tile size in the service.
 */
export function boundsOf(cells) {
  if (!Array.isArray(cells) || cells.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const cell of cells) {
    const x = cell[0];
    const y = cell[1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** Live cells per unit area of the bounding box, or 0 for an empty set. */
export function densityOf(cells) {
  const bounds = boundsOf(cells);
  if (bounds === null) return 0;
  return cells.length / (bounds.width * bounds.height);
}

/**
 * The representation to use for a live set, given what the core offers.
 *
 * `current` is returned when nothing can be decided — an empty world, or a core
 * that offers no tiled storage. A caller must treat the result as a request to
 * switch, not as a fact about the running process.
 */
export function chooseRepresentation(cells, offered, current = 'sparse') {
  const available = Array.isArray(offered) ? offered : REPRESENTATIONS;
  if (!available.includes('tiled')) return available.includes('sparse') ? 'sparse' : current;
  if (!Array.isArray(cells) || cells.length === 0) return current;
  if (cells.length < TILED_MIN_POPULATION) return 'sparse';
  return densityOf(cells) >= TILED_MIN_DENSITY ? 'tiled' : 'sparse';
}

/** Whether a chosen representation differs from the running one. */
export function needsSwitch(choice, current) {
  return choice !== current;
}

/**
 * Whether the measurement has an opinion at this population.
 *
 * Below the measured crossover the sparse world is the faster one, but that is
 * not a reason to take a person's manual choice away from them when they place a
 * small pattern: the service only reconsider the storage once the live set is
 * large enough for the choice to matter.
 */
export function hasMeasuredOpinion(population) {
  return Number.isInteger(population) && population >= TILED_MIN_POPULATION;
}
