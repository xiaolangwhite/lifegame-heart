# ADR 0008 — The world is bounded and does not wrap

## Status

Accepted (2026-10-10). Implemented by `src/lifegame/world/sparse.py` and
`src/lifegame/world/dense.py` in the version that names phase 02 milestone 00 in
[../../plan/VERSIONS.md](../../plan/VERSIONS.md).

## Context

A cellular automaton on a grid needs an answer for what lies beyond the edge.
The two common answers are a torus, where opposite edges are neighbours, and a
bounded plane, where everything outside is permanently dead.

The choice is not cosmetic. It decides what a user sees when a glider reaches an
edge, it decides whether the coordinate encoding has to handle wrapping in the
neighbour mask, and it decides whether a pattern's population is conserved near
the boundary. It also has to be the same in both representations, or the oracle
test would compare two different worlds.

A torus is memory-free and keeps patterns alive indefinitely; a bounded plane
matches the mental model of "a grid of cells" that most people bring, and it is
what a click on a finite canvas implies.

## Decision

* The world is **bounded**. A cell outside `0 <= x < width` and
  `0 <= y < height` is permanently dead and contributes no neighbours.
* The condition is enforced in one place per representation: the sparse step
  masks every neighbour offset against the bounds before a key is formed, and the
  dense step pads the grid with a dead border before summing shifted slices.
* It is part of the module's contract, stated in
  `docs/model/world/interfaces.md` and tested by two named cases in
  `tests/world/test_patterns.py`: a blinker at the top edge loses the cell that
  would have been above the world, and a blinker at the left edge loses the one
  that would have been to its left. Neither reappears on the opposite edge.

## Consequences

* A pattern that reaches an edge decays in a way a torus would not, and that is
  the intended behaviour rather than a defect. It is recorded here so a future
  reader does not correct it by accident.
* The neighbour mask costs one comparison chain per offset per generation; a
  torus would have cost modulo arithmetic instead. The measured step profile
  attributes about 42 ms of a 119 ms step at 262,144 live cells to candidate
  construction, which includes those masks.
* A wrapping mode, if ever wanted, is a new option rather than a correction:
  both representations would take it as a parameter and the oracle test would
  cover both settings.

## Superseding

None.
