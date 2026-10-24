# Phase 01 — milestones

> Version state is owned by [../VERSIONS.md](../VERSIONS.md). This file records
> what each milestone contains, not whether it is done.

## M00 — environment isolation and documentation gate

**Delivered by:** the version naming this milestone in
[../VERSIONS.md](../VERSIONS.md).

**Contains:**

* `scripts/env.ps1` — the single definition of where every transient artifact
  goes, plus the guard that refuses to continue when one of those locations
  points at `C:`.
* `scripts/bootstrap.ps1` — idempotent provisioning from a clean checkout.
* `scripts/verify-temp-isolation.ps1` — executable proof that running the
  toolchain creates nothing outside the repository tree.
* `scripts/verify.ps1` — the single verification entry point: it sources the
  environment itself, runs every gate and reports one exit code. Delivered in
  the fix on this milestone rather than in its original scope, after a
  measurement showed that eight commands and a repeated preamble were the
  largest source of operational complexity.
* uv configuration (`uv.toml`, `.python-version`, `pyproject.toml`) with the
  managed interpreter payload under `.cache/uv-python/`.
* Node cache redirection (checkout-relative, through `scripts/env.ps1` and
  `pnpm-workspace.yaml`) and the Node package manifest.
* The documentation system: normative, policy, scope, evidence and derived
  layers, with a module catalog.
* `tools/documentation/` — the C++ conformance gate, its build, its tests and
  its README describing every check code.

**Exit condition:** every criterion in
[acceptance.md](acceptance.md) holds, with recorded commands and results.

## M01 — project skeletons and gate runner

**Delivered by:** the version naming this milestone in
[../VERSIONS.md](../VERSIONS.md).

**Contains:**

* An importable `lifegame` package under `src/` with its module contract.
* A Node package with a buildable, testable entry point.
* One command that runs every gate (documentation, isolation, Python tests,
  lint, C++ tool tests) and reports a single exit code.
* The first measured admission floors on profile `M1`
  ([../PERFORMANCE_ACCEPTANCE.md](../PERFORMANCE_ACCEPTANCE.md)).

**Exit condition:** the gate runner exits `0` on a clean checkout, and the
measured floors are recorded with their commands and results.
