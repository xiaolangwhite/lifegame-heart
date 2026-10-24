# Phase 02 — milestones

> Version state is owned by [../VERSIONS.md](../VERSIONS.md). This file records
> what each milestone contains, not whether it is done.

## M00 — sparse world and an interactive viewer

**Delivered by:** the version naming this milestone in
[../VERSIONS.md](../VERSIONS.md).

**Contains:**

* `src/lifegame/world/` — the sparse world (packed keys in a sorted array, 8
  bytes per live cell), the dense reference world used as the correctness
  oracle, the rule object, and the bounded non-wrapping boundary condition.
* The line protocol served by `python -m lifegame.world`, owned by the module
  that defines it.
* `src/viewer/` — the NodeJS service and the browser page: click to toggle,
  run, pause, step, clear, zoom, pan.
* The correctness evidence: random-state equivalence against the oracle, plus
  the published behaviours of a block, a blinker and a glider.
* The measured frontier between the sparse and dense representations, including
  the crossover and the phase profile of a sparse step.
* The recorded conclusion that the sort-based sparse step does not scale to the
  target at realistic density, with the closing candidate and the version that
  owns it.

**Exit condition:** every criterion in [acceptance.md](acceptance.md) holds,
with recorded commands and results.

## M01 — tiled bit-parallel representation

**Delivered by:** the version naming this milestone in
[../VERSIONS.md](../VERSIONS.md).

**Contains:**

* A world representation built from fixed-size bit-packed tiles: only non-empty
  tiles are stored, each tile steps with word-parallel operations, and a halo
  carries the one-cell border between neighbours. The step cost becomes
  proportional to the number of active tiles rather than to the number of live
  cells, and each tile advances 64 cells per word operation.
* A measured comparison against the M00 representation on **two shapes** of
  population — blocks packed together, and the same blocks one per tile — so the
  record says which shape each representation is for rather than only which is
  faster on one ladder.
* The shared oracle extended to hold all three representations to the same
  contract, including the number of cells a step reports as changed.
* Two interface changes in the viewer: a thicker, adjustable grid, and a
  dark/light theme that the canvas follows.

**Exit condition:** the frontier table shows the new representation winning at
the densities the target scale implies, and names the shape where it does not.

## M02 — history, dispatch, push transport and browser coverage

**Delivered by:** the version naming this milestone in
[../VERSIONS.md](../VERSIONS.md).

**Contains:**

* **A history layer.** Every generation recorded as the cells that were born and
  the cells that died, keyframes at an interval to bound the cost of walking the
  chain, rollback to any recorded generation, and a portable archive that leaves
  the machine. The substrate decision, including the second dialect, is
  [ADR 0011](../../adr/data-and-formats/0011-sqlite-default-mysql-supported.md).
* **Shape-aware representation selection.** The measurement says sparse wins for
  scattered populations and tiled wins for clustered ones, and the default is
  therefore right for the viewer's workload and wrong for a loaded large
  pattern. The history layer is also what makes a switch lossless: export the
  live set, start a core on the other representation, import it back.
* A push transport, so the browser is not polling for frames.
* Automated coverage of the browser surface: canvas drawing, pointer gestures,
  wheel anchoring and the polling loop, executed against a synthetic document
  rather than only inspected.

**Exit condition:** a session survives the process that produced it and can be
rolled back to any recorded generation; the representation is chosen from the
interface rather than from a default; and the browser behaviour has been
executed by a test rather than described.
