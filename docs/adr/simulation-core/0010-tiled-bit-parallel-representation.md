# ADR 0010 — Tiled bit-parallel representation for clustered populations

## Status

Accepted (2026-10-10). Implemented by `src/lifegame/world/tiled.py` in the
version that names phase 02 milestone 01 in
[../../plan/VERSIONS.md](../../plan/VERSIONS.md). It closes, for clustered
populations, the gap recorded in
[0009](0009-sort-based-sparse-does-not-scale-to-the-target.md).

## Context

[ADR 0009](0009-sort-based-sparse-does-not-scale-to-the-target.md) recorded that
the sparse representation fits the design target of 65536 x 65536 but cannot run
it: the sort-based step costs about half a microsecond per live cell, so one
percent density — 43 million live cells — projects to between seventeen and
twenty-three seconds per generation.

The survey cited in that ADR names the classical alternative: cut the world into
fixed tiles, keep only non-empty ones, and advance a tile with word-parallel bit
operations. A tile of 64 x 64 cells is 64 machine words, one per row, and a
generation of a tile is a few dozen word operations: 64 cells advance per word
operation instead of one.

Two things had to be settled before adopting it.

**Which shape wins.** A tiled step costs a constant per *active tile*, so it
wins when a tile holds many live cells and loses when the population is spread
thin — every isolated tile drags in its eight neighbours for nothing. The
measurement, on profile `M1` at 1024 x 1024 with still lifes so the population
does not drift:

| Live cells | sparse | dense | tiled | tiles |
|---|---|---|---|---|
| 400 | 0.175 ms | 12.930 ms | 0.303 ms | 1 |
| 4,000 | 1.371 ms | 13.125 ms | **0.330 ms** | 4 |
| 40,000 | 13.931 ms | 13.397 ms | **0.537 ms** | 49 |
| 200,000 | 84.061 ms | 14.224 ms | **1.955 ms** | 196 |
| 260,000 | 119.341 ms | 13.565 ms | **2.175 ms** | 256 |

and with the same blocks spread one per tile:

| Live cells | sparse | dense | tiled | tiles |
|---|---|---|---|---|
| 400 | **0.175 ms** | 13.430 ms | 0.652 ms | 32 |
| 4,000 | **1.402 ms** | 13.234 ms | 2.003 ms | 256 |

Tiled wins from about four thousand live cells in the clustered shape and by a
factor of fifty-five at 260,000. Sparse wins for a scattered population, which
is the shape a person produces by clicking cells one at a time.

**What it costs elsewhere.** The tiled world is slower to *query*: extracting
coordinates from a bit-packed store means unpacking it. At 260,000 live cells,
one `state` request costs 9.41 ms tiled against 1.27 ms sparse, and a
1024 x 1024 frame costs 12.00 ms against 3.75 ms. Stepping and querying pull in
opposite directions.

## Decision

* Ship the tiled representation as a third public world, alongside the sparse
  world and the dense oracle, sharing the same contract and the same oracle.
* The active set of a step is every non-empty tile plus the neighbours of any
  tile with a live cell on its border, because a birth can only appear in a tile
  adjacent to a live cell. Interior tiles of a dense region add nothing and their
  neighbours already exist, so the expansion is free there and costs up to nine
  times only for isolated tiles — the shape where the sparse world is the better
  tool.
* The **default stays sparse**, because the workload the viewer actually serves
  is scattered cells placed by hand, and it is measurably faster for that. The
  alternative is reachable through `--representation tiled`.
* Choosing automatically, per shape, is **not** implemented. It is named as the
  open follow-up in [../../plan/phase-02-simulation-core/risks.md](../../plan/phase-02-simulation-core/risks.md)
  and owned by the version that names phase 02 milestone 02.

## Consequences

* The gap in ADR 0009 is closed for clustered populations. **The projection has
  two halves and both matter.** The advantage comes from spatial compactness, not
  from the size of the population, and quoting only the first half would
  overstate it by two orders of magnitude.
  * If the 43 million live cells of a one-percent world are packed together, that
    is about 10,500 tiles, which the measured per-tile cost puts at roughly
    **0.08 to 0.09 seconds per generation**.
  * If the same one percent is spread evenly over the whole world — about 41 live
    cells per tile — then essentially all 1,048,576 tiles are active, and the
    same arithmetic gives **7.8 to 8.9 seconds per generation**. The sparse step
    needs 17 to 23 seconds for that population, so the advantage falls from about
    200 times to about twice.
  Both figures are arithmetic from a 1024 x 1024 measurement and are labelled as
  projections; the ladder has never been run above 1024 x 1024.
* For a scattered population the sparse world remains the right choice, so the
  two representations coexist rather than one replacing the other. That is a
  cost: two implementations of one contract, and a shared test that has to hold
  all three to the same oracle.
* The oracle test earned its keep again. A change count taken over array
  elements rather than bits reported three changed cells where four had changed,
  while every state comparison passed. The shared contract now covers `step`'s
  return value, not only the state it produces.
* Memory is 512 bytes per non-empty tile, plus working arrays of the same order
  per step. A dense 4096 x 4096 region is 4,096 tiles and about 2 MB, where the
  sparse world would have held 16.7 million keys. A scattered population is the
  expensive case in memory too: one live cell per tile costs 512 bytes plus its
  share of the active-set expansion.

## Superseding

None. This ADR does not supersede
[ADR 0005](0005-sparse-representation-at-target-scale.md) or
[ADR 0009](0009-sort-based-sparse-does-not-scale-to-the-target.md): the sparse
world still ships and is still the default, and the measurement that motivated
this one is unchanged.
