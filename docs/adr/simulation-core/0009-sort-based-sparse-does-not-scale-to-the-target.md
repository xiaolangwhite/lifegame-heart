# ADR 0009 — The sort-based sparse step does not scale to the target

## Status

Accepted (2026-10-10) as a record of a gap that was real at the time. The gap it
records is **closed for clustered populations** and remains open in a different
form, both by [0010](0010-tiled-bit-parallel-representation.md), which was
delivered by the version that names phase 02 milestone 01 in
[../../plan/VERSIONS.md](../../plan/VERSIONS.md) — the version this ADR assigned
the work to. The measurement below is left as it was written; 0010 carries the
comparison that followed, and what remains open is the absence of a rule that
chooses between the two representations.

## Context

[ADR 0005](0005-sparse-representation-at-target-scale.md) chose a sparse
representation because a dense one cannot exist at the design target of
65536 x 65536. That decision is about *feasibility* and it stands. The
measurement taken afterwards is about *speed*, and it does not stand up.

Measured on profile `M1`, on a 1024 x 1024 world holding a still life of blocks
so the population is constant, best of one warm-up plus five timed generations:

| Live cells | Sparse, ms per step | Dense, ms per step |
|---|---|---|
| 400 | 0.181 | 13.643 |
| 4,000 | 1.359 | 13.931 |
| 40,000 | 15.361 | 14.313 |
| 200,000 | 106.493 | 14.327 |
| 260,000 | 138.171 | 13.224 |

The dense reference is essentially constant, because it scans the world's area.
The sparse step costs about 0.53 microseconds per live cell, because each step
builds eight neighbour arrays and then sorts and counts nine times the live
population. The crossover is therefore at about 40,000 live cells — four percent
of that world — and not at the one-in-nine density the algorithm's shape
suggests.

At the design target the arithmetic is unforgiving. One percent of 65536 x 65536
is 43 million live cells: roughly nineteen seconds per generation. Five percent
is over a minute. A world that can be represented, clicked and stepped one
generation at a time is not yet a world that can be *run* at the density the
target implies.

Two alternatives were considered and are not adopted here:

* **Quadtree memoisation (HashLife).** Asymptotically the best answer for
  self-similar patterns and the wrong answer as a general default: it needs a
  different world model, it is substantially more complex, and its advantage
  appears only when the pattern repeats.
* **Project-authored native code.** Forbidden as a runtime path by
  [ADR 0003](../governance-and-build/0003-cpp-is-tooling-only.md) without a
  superseding decision, and the project has one dependency-based exception
  already ([ADR 0006](0006-numpy-is-the-vectorised-substrate.md)); a second
  should be earned by measurement rather than by impatience.

## Decision

Record the gap rather than hide it, and name the candidate that closes it: a
**tiled bit-parallel representation**. The world is partitioned into fixed-size
tiles; a tile is stored only when it is non-empty; each tile advances with
word-parallel bit operations, so one machine word carries 64 cells; and a
one-cell halo carries the border between neighbouring tiles.

Its expected advantage is structural, not incremental: the step cost becomes
proportional to the number of *active tiles* rather than to the number of live
cells, and each tile does its work 64 cells at a time.

## Consequences

* The frontier table in
  [../../plan/PERFORMANCE_ACCEPTANCE.md](../../plan/PERFORMANCE_ACCEPTANCE.md) §5
  carries the unclosed gap explicitly, and the phase risk R10 points here.
* The version that names phase 02 milestone 01 owns closing it, and closing it
  means re-running the same ladder on the same profile and recording the new
  crossover. It did: the crossover is about 4,000 live cells when the population
  is clustered, the tiled step is 55 times faster at 260,000 live cells, and the
  target-scale projection falls from seventeen to twenty-three seconds per
  generation to about 89 milliseconds. See
  [0010](0010-tiled-bit-parallel-representation.md).
* The public surface of the world is unchanged by that work: a caller holds a
  world and steps it. That is why the gap could be closed in a later version
  without invalidating what shipped before it.
* What survives from this ADR is the part the closing version did not solve:
  nothing chooses between the representations, so one of the two shapes runs on
  the slower one. Phase risk R16 carries that, and
  [../../plan/phase-02-simulation-core/milestones.md](../../plan/phase-02-simulation-core/milestones.md)
  M02 owns it.

## Superseding

Partially superseded by
[0010](0010-tiled-bit-parallel-representation.md), which closes the recorded gap
for clustered populations. This ADR is not withdrawn: the measurement it reports
is unchanged, the sparse representation it chose still ships and is still the
default, and the shape for which its conclusion holds is stated by 0010.
