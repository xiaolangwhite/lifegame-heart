# ADR 0003 — C++ is tooling only

## Status

Accepted (2026-10-08).

## Context

lifegame is defined as a Python core with a NodeJS service and interface
([../../../ENGINE_STANDARD.md](../../../ENGINE_STANDARD.md) §1.1). A C++
component was nevertheless introduced in the first version: the documentation
conformance gate. The user required that gate to be fast, which rules out a
script-language implementation over a repository tree that is expected to grow
to hundreds of documents.

Once one C++ component exists, the boundary starts to erode by convenience:
the next "obviously faster in C++" piece, then a native extension for the
simulation step. That erosion has a specific cost here — a native runtime
boundary would add a build dependency to every supported platform, and it would
have to be justified by measurement rather than by assumption.

## Decision

* C++ is a **tooling** language in this project. Tooling lives under
  `tools/<tool>/`, is built by CMake, and is never imported by Python or Node
  code.
* No C++ may enter the runtime path of the simulation, the service or the UI
  without a superseding ADR that names three things: the native boundary, the
  build integration, and the portable fallback for platforms where the native
  build is unavailable.
* Tool binaries are produced inside the repository tree, and their build
  intermediates obey the same confinement rule as every other artifact
  ([0002](0002-confine-transient-artifacts-to-repository.md)).
* The toolchain is the portable GCC 16.1.0 distribution kept outside any single
  project, so a tool build does not depend on a system-wide compiler
  installation on the system volume.

## Consequences

* The documentation gate can be reimplemented in another language later without
  changing the documentation rules — the check codes, not the language, are the
  interface.
* Simulation performance work cannot take the "write it in C++" shortcut
  without producing measurement evidence first, which is exactly the intended
  friction.
* The toolchain must work on the platforms the project claims to support. That
  is currently one profile, `M1`
  ([../../plan/PERFORMANCE_ACCEPTANCE.md](../../plan/PERFORMANCE_ACCEPTANCE.md));
  claiming more requires recording evidence on those platforms.

## Superseding

None.
