# Plan for the version naming phase 02 milestone 01

> The version identifier and its state are owned by
> [../../../VERSIONS.md](../../../VERSIONS.md); this file owns only the plan for
> delivering it.

## Claim

Phase 02 milestone 01 ([../../milestones.md](../../milestones.md)): replace the
measured scalability gap with a representation that does not have it, and make
two viewer interfaces work for someone using the page.

The claim type is **implementation plus measurement**. The output is a third
world representation, the comparison that says which shape each representation
is for, and the record of both in
[../../../../../dev-log](../../../../../dev-log).

## Why it is where it is

[ADR 0009](../../../../adr/simulation-core/0009-sort-based-sparse-does-not-scale-to-the-target.md)
recorded that the sparse world fits the design target and cannot run it: the
sort-based step costs about half a microsecond per live cell, so one percent
density projects to seventeen to twenty-three seconds per generation. It named
the tiled bit-parallel representation as the closing candidate and assigned the
work to the version that names milestone 01 — this one.

## Approach

1. **Prior art first.** The representation is the one the G4G13 algorithm survey
   describes: fixed tiles, only non-empty ones stored, a halo carrying the
   one-cell border, and word-parallel operations inside a tile. The step is
   `next = ~s3 & ~s2 & s1 & (alive | s0)` over four count bit-planes, computed
   with a ripple-carry counter over the eight neighbour planes.
2. **Vectorise across tiles and rows.** Per-tile Python loops would lose to
   interpreter overhead; an active set of `M` tiles is an `(M, 64)` array and the
   adder tree becomes a few dozen array operations.
3. **Hold it to the existing oracle before believing it.** The dense world and
   the equivalence test already existed, so the tiled world was written against
   the same contract and checked against both others — including the number of
   cells a step reports changed, which is where it actually went wrong.
4. **Measure two shapes, not one.** A tiled step costs per active tile and a
   sparse step costs per live cell, so one ladder would have produced a number
   and no decision. The harness measures a clustered lattice and the same blocks
   scattered one per tile.
5. **Change the viewer interfaces** — a thicker adjustable grid, and a
   dark/light theme the canvas follows rather than only the page around it.

## Risks that were live

| Risk | How it was handled |
|---|---|
| The oracle compares state but not the interface, so a wrong return value ships | The shared contract now covers `step`'s return value; this is how F16 was found |
| numpy bit operations on `uint64` can silently carry across a tile seam | A dedicated seam test and a diagonal seam test, plus a partial-tile mask test |
| The active set is expensive for scattered populations, which is the interactive workload | Measured, not assumed: the scattered ladder is what keeps the default honest |

## Definition of done

* `TiledWorld` is public, shares the contract, and is held to the same oracle as
  the other two representations.
* The frontier is measured on two shapes and the crossing point is stated with
  the numbers behind it.
* The unclosed part — nothing chooses between the representations — is named,
  scheduled by milestone 02, and given a version.
* Both viewer interfaces work, are reachable from the page, and persist their
  state; the parts of them that are pure logic are covered by tests.
* Every gate passes and the record is in `dev-log/`.
