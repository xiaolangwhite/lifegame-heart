# Phase 02 — tasks

> State words follow [../../AI_DOCUMENTATION_GUIDE.md](../../AI_DOCUMENTATION_GUIDE.md) §3.
> Version state is owned by [../VERSIONS.md](../VERSIONS.md).

## M00 — sparse world and an interactive viewer

| Id | Task | State | Code entry point |
|---|---|---|---|
| T30 | Store a world of the target size in memory proportional to its live population. | Implemented | `src/lifegame/world/sparse.py` |
| T31 | Express Conway's rule as a value object with a notation and a transition. | Implemented | `src/lifegame/world/rules.py` |
| T32 | Write an independent dense world to serve as the correctness oracle and the measured baseline. | Implemented | `src/lifegame/world/dense.py` |
| T33 | Fix the boundary condition as bounded and non-wrapping, in both representations. | Implemented | `src/lifegame/world/sparse.py`, `src/lifegame/world/dense.py` |
| T34 | Publish a line protocol so another process can drive the world. | Implemented | `src/lifegame/world/bridge.py` |
| T35 | Prove rule correctness against the oracle and against published pattern behaviour. | Implemented | `tests/world/test_oracle_equivalence.py`, `tests/world/test_patterns.py` |
| T36 | Measure the frontier between the two representations and profile a sparse step. | Implemented | `tests/world/test_benchmark.py` |
| T37 | Render a viewport, toggle cells on click, run, pause, step, clear, zoom and pan. | Implemented | `src/viewer/` |
| T38 | Record the representation decision, the substrate decision and the measured gap as ADRs. | Implemented | `docs/adr/simulation-core/`, `docs/adr/service-and-api/` |

## M01 — tiled bit-parallel representation and push transport

| Id | Task | State |
|---|---|---|
| T40 | Represent the world as bit-packed tiles, storing only non-empty tiles, with a one-cell halo between neighbours. | Planned |
| T41 | Re-run the frontier ladder with the tiled representation and record the new crossover. | Planned |
| T42 | Replace frame polling with a push transport. | Planned |
| T43 | Decide and implement pattern persistence. | Planned |
| T44 | Automate the browser surface, so the viewer has evidence beyond its HTTP API. | Planned |
