# ADR 0006 — numpy is the vectorised substrate

## Status

Accepted (2026-10-10). Implemented by `pyproject.toml` and
`src/lifegame/world/sparse.py` in the version that names phase 02 milestone 00
in [../../plan/VERSIONS.md](../../plan/VERSIONS.md).

## Context

Conway's rule over a sparse world needs, per generation, one neighbour count per
candidate cell. In pure Python that is a dictionary update per live cell per
neighbour — eight updates per cell — and the measurement puts it at 8.5 ms per
step for 4,000 live cells, against 1.4 ms for the vectorised version: a factor
of six, growing with the population.

[ADR 0003](../governance-and-build/0003-cpp-is-tooling-only.md) says that no C++
may enter the runtime path of the simulation without a superseding ADR naming
the native boundary, the build integration and the portable fallback. numpy
contains compiled extension modules, so using it puts native code in the runtime
path, and that clause applies to dependencies as much as to code this project
writes.

## Decision

* numpy is the vectorised substrate for the world. It is a **third-party Python
  dependency**, not native code written by this project, and it is installed
  from a prebuilt wheel by uv into the in-repository virtual environment.
* **Native boundary.** The boundary is the numpy C extension modules inside
  `site-packages` of the in-repository `.venv`. The project authors none of it
  and does not compile it.
* **Build integration.** `pyproject.toml` declares `numpy>=2.5`; uv resolves and
  installs it, and `scripts/bootstrap.ps1` provisions it. There is no
  project-side compilation step, so a machine without a C++ toolchain can still
  run the core.
* **Portable fallback.** The rule is implemented twice against the same
  contract: the dense reference world uses numpy as well, but the *algorithm*
  the sparse world uses is the neighbour-count-then-apply loop that the
  benchmark's pure-Python candidate implements without numpy. That candidate is
  the fallback's shape, and its cost is measured rather than asserted: 8.5 ms
  per step at 4,000 live cells, 0.7 ms at 400.

## Consequences

* The core requires a platform for which a numpy wheel exists. For CPython 3.14
  on Windows x86-64 the wheel was verified available before this decision was
  taken.
* The C++-is-tooling-only rule keeps its meaning: this ADR widens the *native
  boundary* to include a vetted numerical dependency, and it does not license
  project-authored native code.
* Replacing numpy later means replacing the inner loops of two modules; the
  public surface of the world does not mention numpy except in the type of the
  viewport array it returns.

## Superseding

None. This ADR does not supersede
[ADR 0003](../governance-and-build/0003-cpp-is-tooling-only.md); it applies its
exception clause.
