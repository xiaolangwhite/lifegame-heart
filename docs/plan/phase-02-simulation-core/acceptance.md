# Phase 02 — acceptance criteria

> Criteria are stable; results are not written here. Each criterion names the
> command that decides it and the evidence owner. Verification state is scoped
> ([../../AI_DOCUMENTATION_GUIDE.md](../../AI_DOCUMENTATION_GUIDE.md) §3.1).

| Id | Criterion | Deciding command | Evidence owner |
|---|---|---|---|
| B1 | A world of the design target, 65536 x 65536, can be constructed, and its memory cost is proportional to the live population rather than to the world's area. | `uv run python -c "from lifegame.world import SparseWorld; SparseWorld(65536, 65536)"` plus the frontier measurement | `dev-log/<version>.md` |
| B2 | The sparse world and an independently written dense world produce identical states from identical inputs, over randomised states and several world sizes. | `uv run pytest tests/world/test_oracle_equivalence.py` | `dev-log/<version>.md` |
| B3 | Published Life behaviours hold: a block is a still life, a blinker has period two, a glider returns after four generations displaced by one cell diagonally, and no pattern wraps around an edge. | `uv run pytest tests/world/test_patterns.py` | `dev-log/<version>.md` |
| B4 | The line protocol serves every documented command, reports every documented error code, and ends cleanly on `quit` or on end of input. | `uv run pytest tests/world/test_bridge.py` | `dev-log/<version>.md` |
| B5 | A browser page renders a viewport of the world, toggles a cell on click, runs, pauses, steps, clears, zooms and pans. | the viewer's end-to-end test plus a recorded manual session | `dev-log/<version>.md` |
| B6 | The frontier between the shipped representation and the dense reference is measured, with the crossover and the phase profile recorded, and the measurement states its profile, its lifecycle and its noise policy. | `uv run pytest -m benchmark -s tests/world/test_benchmark.py` | `dev-log/<version>.md` |
| B7 | Any performance gap the phase cannot close names the candidate that would close it and the version that owns it. | review of [../PERFORMANCE_ACCEPTANCE.md](../PERFORMANCE_ACCEPTANCE.md) §5 and the module's `performance.md` | `dev-log/<version>.md` |
| B8 | The whole verification suite still passes through one command. | `scripts/verify.ps1 -Full` | `dev-log/<version>.md` |

A criterion without an executed command is `Unvalidated`. A gate that could not
run is reported as not run, never as passed.
