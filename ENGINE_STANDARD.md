# ENGINE_STANDARD — lifegame

> **Authority.** This document owns the project definition, the engineering
> principles and the performance principles. It does **not** own version state
> (see [docs/plan/VERSIONS.md](docs/plan/VERSIONS.md)) and it does not own
> module contracts (see [docs/model/](docs/model/)).

## 1. Project definition

**lifegame** is a large-world Game of Life simulation platform.

Its subject is not a 100×100 toy grid. The subject is a world large enough that
the *implementation strategy itself* decides whether the world can exist at all:
memory layout, update scheduling, persistence and transport dominate behaviour
long before the cellular rule does.

### 1.1 Language split

| Layer | Language | Owns |
|---|---|---|
| Simulation core | **Python 3.14** | world model, rule evaluation, scheduling, persistence adapters, analysis |
| Service and interface | **NodeJS 24** | HTTP/WebSocket surface, live streaming, session orchestration, web UI delivery |
| Tooling | **C++20** | development tools that must be fast and dependency-free (documentation validator, fixtures generators) |

Two rules follow from this split and are not negotiable:

1. **C++ is tooling only.** No C++ code may become part of the runtime path of
   the simulation, the service or the UI without a superseding ADR that names
   the native boundary, the build integration and the portable fallback.
2. **Python and NodeJS are peers, not caller and callee.** The boundary between
   them is a versioned, documented contract (see
   [docs/model/](docs/model/)); neither side may reach into the other's
   internals through files, environment variables or private endpoints.

### 1.2 Environment contract

The development environment is part of the product's definition, not a local
convenience:

* Python interpreter: uv-managed CPython 3.14, payload under
  `.cache/uv-python/`, virtual environment at `.venv/`.
* Node runtime: system Node.js ≥ 24, package manager pnpm, store and cache
  under `.cache/`.
* **No temporary file, no package cache, no bytecode cache and no build
  intermediate may be written to `C:`.** Every such location is redirected
  inside the repository tree by `scripts/env.ps1`.
* The environment is reproducible from a clean checkout by
  `scripts/bootstrap.ps1` alone.

Authority for the environment module: [docs/model/environment/](docs/model/environment/).

## 2. Engineering principles

### 2.1 Top-Tier Principle

A deliverable is not "done" when it runs. It is done when, on a declared
machine profile and a declared workload, it is the best of the candidate set
that was actually measured — and when the evidence names the oracle, the
candidates that lost, and why they lost.

Consequences:

* `top-tier`, `fastest` and `optimal` may only be claimed relative to a stated
  candidate set, workload, build, profile, scale and variance policy.
* A default that is known to be dominated must not ship.
* A failed or excluded candidate stays in the record as evidence. Removing it
  is falsification.

### 2.2 Big World Principle

The design point is the target scale, not the test scale.

Consequences:

* Data structures, memory layout, scheduling and I/O are chosen for the target
  world size from the first commit; convenience that only holds at toy scale
  is not a valid shortcut.
* Every performance claim is measured at sizes that cross the expected
  crossover point: below it, near it, above it, and at the configured maximum.
* A design that cannot be extended to the target scale must be recorded as
  `Planned` for replacement in a named future version, never silently kept.

### 2.3 No minimal-implementation-first

Implementing the smallest thing that passes, with the intention of "optimising
later", is prohibited. It produces exactly the structural choices that later
forbid optimisation, and it hides the real cost of the first version.

The order is inverted: establish prior art and a complexity bound **before**
writing the implementation (section 3), then implement the design that the
bound justifies.

### 2.4 Evidence discipline

* `Implemented` requires naming the code entry point.
* `Validated` requires the exact command, the declared configuration and the
  observed result — and is scoped: a compile does not prove runtime, a smoke
  run does not prove correctness, one platform does not prove portability.
* Failed, skipped and timed-out runs are preserved verbatim.
* Documentation states are drawn from the closed vocabulary in
  [docs/AI_DOCUMENTATION_GUIDE.md](docs/AI_DOCUMENTATION_GUIDE.md) §3.

### 2.5 Single authority per claim type

Each claim type has exactly one owner file. Consumers summarise and link; they
never copy. The full assignment is in
[docs/DOCUMENTATION_RULES.md](docs/DOCUMENTATION_RULES.md) §2, and the
conformance gate is `tools/documentation/validate-documentation.ps1`.

### 2.6 Blocked work is scheduled, not dropped

If a work item cannot be completed, it is either kept open or moved to a named
future version in [docs/plan/VERSIONS.md](docs/plan/VERSIONS.md). Difficulty is
not evidence that a performance gap may be closed, and an unfinished item
never disappears without a version that owns it.

## 3. Workflow before code

For any non-trivial change:

1. State the claim type, its owner, its consumers and the active version.
2. Find prior art / a published algorithm; prefer the established one.
3. Establish the complexity bound and confirm it is low enough for the target
   scale (Big World Principle).
4. Implement and integrate only the design the bound justifies.
5. Update the coupled document set in the same work item
   ([docs/DOCUMENTATION_RULES.md](docs/DOCUMENTATION_RULES.md) §7).
6. Run the gate, then report: what changed, what was verified, what remains
   unverified or future, and whether a commit and tag exist.

## 4. Performance principles

* Budgets are **admission floors**, never proof that optimisation is finished.
* A frontier gate names: the oracle, the invariants that must not regress, the
  serious candidate set, the **reasoned exclusions**, and the fallback.
* Every frontier claim requires a microbenchmark **and at least one end-to-end
  workload on a real consumer**.
* The measured matrix spans profile × scale, with distributions and resource
  metrics, not single numbers.
* Noise policy is declared before measuring; a documented machine limit is
  authoritative and must not be overridden by jitter.
* A candidate that loses must be accompanied by an implementation audit and a
  re-run on identical boundaries before it is dismissed.

Exact measurement workflow and machine numbers:
[docs/plan/PERFORMANCE_ACCEPTANCE.md](docs/plan/PERFORMANCE_ACCEPTANCE.md).

## 5. What this standard does not own

| Question | Owner |
|---|---|
| Which version is current / next / complete | [docs/plan/VERSIONS.md](docs/plan/VERSIONS.md) |
| How documents must be structured and coupled | [docs/DOCUMENTATION_RULES.md](docs/DOCUMENTATION_RULES.md) |
| What each document must contain and how evidence is recorded | [docs/AI_DOCUMENTATION_GUIDE.md](docs/AI_DOCUMENTATION_GUIDE.md) |
| Internal component boundaries | [docs/MODULE_COMPONENT_GUIDE.md](docs/MODULE_COMPONENT_GUIDE.md) |
| What a module promises | [docs/model/](docs/model/) |
| Repository operating rules for agents | [AGENTS.md](AGENTS.md) |
