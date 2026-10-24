# ADR 0005 — Sparse representation at the target scale

## Status

Accepted (2026-10-10). Implemented by `src/lifegame/world/sparse.py` in the
version that names phase 02 milestone 00 in
[../../plan/VERSIONS.md](../../plan/VERSIONS.md).

## Context

The design target is a world of 65536 x 65536, which is 4.29e9 cells. Two
representations were considered seriously, and a third was measured because it
is the first thing anyone writes.

* **Dense**, one boolean per cell: 4.29 GB at the target size, and every step
  touches all of it. The allocation alone fails on this machine.
* **Sparse**, one packed 64-bit key per live cell: memory proportional to the
  live population, and a step proportional to it as well.
* **A pure-Python set of coordinate pairs with a dictionary of neighbour
  counts**: correct and obvious, and measured here rather than dismissed.

Published prior art agrees on the shape of the problem: the Life algorithm
survey from G4G13 groups implementations into bit-parallel dense, sparse active
sets, and quadtree memoisation (HashLife), and notes that the last only wins on
self-similar patterns.

## Decision

* The shipping representation is **sparse**: a sorted, unique array of packed
  64-bit keys, one per live cell, with `key = (y << 32) | x`.
* A dense world is kept and shipped as the **correctness oracle** and as the
  measured baseline. It refuses to construct above 64 million cells rather than
  consuming the machine.
* The target scale is a construction parameter, not a comment: the sparse world
  accepts 65536 x 65536 and the dense world rejects it with a message that names
  the sparse world.

## Consequences

* Memory at the target scale is 8 bytes per live cell. A world with a million
  live cells costs 8 MB, not 4.29 GB.
* A step costs about 0.53 microseconds per live cell on profile `M1`, measured
  on a still life of blocks so that the population does not drift during the
  measurement. That is roughly 0.45 s per generation at one million live cells
  and about 19 s at the 43 million cells that one percent density implies.
* The dense reference is about 13–14 ms per step *regardless of population*, so
  it wins above roughly 40,000 live cells on a 1024 x 1024 world. It cannot be
  the default at the target scale because it cannot exist there; the gap it
  exposes is recorded in
  [0009](0009-sort-based-sparse-does-not-scale-to-the-target.md) with the
  version that owns closing it.
* Every write operation has to maintain the sorted-unique invariant. That is
  what makes the step cheap and the mutation cost linear in the population; a
  click costs a memory move, which the measurement says is a few milliseconds at
  a million live cells.

## Superseding

None.
