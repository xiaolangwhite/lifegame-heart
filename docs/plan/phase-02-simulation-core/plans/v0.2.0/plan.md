# Focused plan — v0.2.0

> Version state is owned by [../../../VERSIONS.md](../../../VERSIONS.md). This
> plan owns the implementation boundary of one version.

## Goal

A world that can exist at the design target of 65536 x 65536, advances by
Conway's rule, can be driven by another process, and can be edited and watched
in a browser: click a cell to bring it to life, run, pause, step, clear, zoom,
pan.

## Exact implementation boundary

| Area | Paths | Change |
|---|---|---|
| World representation | `src/lifegame/world/sparse.py` | create |
| Correctness oracle | `src/lifegame/world/dense.py` | create |
| Rule object | `src/lifegame/world/rules.py` | create |
| Shared errors | `src/lifegame/world/errors.py` | create |
| Line protocol | `src/lifegame/world/bridge.py`, `src/lifegame/world/__main__.py` | create |
| Module facade | `src/lifegame/__init__.py`, `src/lifegame/world/__init__.py` | create |
| Python packaging | `pyproject.toml` | switch from a virtual project to a packaged one; add numpy; register the benchmark marker |
| Tests | `tests/world/` | create |
| Viewer service and page | `src/viewer/` | create |
| Node scripts | `package.json` | add the run and test scripts |
| Decisions | `docs/adr/simulation-core/`, `docs/adr/service-and-api/` | create |
| Module contracts | `docs/model/world/`, `docs/model/viewer/` | create |
| Phase documents | `docs/plan/phase-02-simulation-core/` | create |
| Evidence | `dev-log/` | create the version entry |

## Explicitly out of scope

* Parallel or distributed stepping; the world advances one generation at a time.
* Persistence of patterns; no format decision is taken here.
* A push transport for the viewer; the page polls.
* A tiled or native representation. The measurement says one is needed for
  realistic density at the target scale, and the closing candidate is named in
  [../../milestones.md](../../milestones.md) M01 and owned by the version that
  names that milestone — not silently deferred.

## Gates to run

| Gate | Command |
|---|---|
| Everything | `scripts/verify.ps1 -Full` |
| Rule correctness against the oracle | `uv run pytest tests/world/test_oracle_equivalence.py` |
| Published pattern behaviour and boundaries | `uv run pytest tests/world/test_patterns.py` |
| The line protocol | `uv run pytest tests/world/test_bridge.py` |
| The frontier measurement | `uv run pytest -m benchmark -s tests/world/test_benchmark.py` |
| The viewer service | `node --test src/viewer/tests/` |

## Definition of done

Every criterion in [../../acceptance.md](../../acceptance.md) holds, with the
deciding command and its observed result recorded in `dev-log/`. The frontier
measurement names its profile, its lifecycle and its noise policy, and the
unclosed gap names its closing candidate and its owning version.
