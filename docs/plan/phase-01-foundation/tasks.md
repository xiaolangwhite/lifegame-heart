# Phase 01 — tasks

> State words follow [../../AI_DOCUMENTATION_GUIDE.md](../../AI_DOCUMENTATION_GUIDE.md) §3.
> Version state is owned by [../VERSIONS.md](../VERSIONS.md).

## M00 — environment isolation and documentation gate

| Id | Task | State | Code entry point |
|---|---|---|---|
| T01 | Define every transient location in one place and refuse to run when one points at `C:`. | Implemented | `scripts/env.ps1` |
| T02 | Provision the environment from a clean checkout, idempotently. | Implemented | `scripts/bootstrap.ps1` |
| T03 | Prove with an executable check that no project artifact lands outside the repository. | Implemented | `scripts/verify-temp-isolation.ps1` |
| T04 | Pin the interpreter contract: uv-managed CPython 3.14, payload inside the repository. | Implemented | `uv.toml`, `.python-version`, `pyproject.toml` |
| T05 | Redirect the Node package manager cache and store into the repository, in a checkout-relative form. | Implemented | `.npmrc`, `pnpm-workspace.yaml`, `package.json` |
| T06 | Write the normative layer: project definition, engineering and performance principles. | Implemented | `ENGINE_STANDARD.md` |
| T07 | Write the policy layer: structure, coupling, evidence, states, components. | Implemented | `docs/DOCUMENTATION_RULES.md`, `docs/AI_DOCUMENTATION_GUIDE.md`, `docs/MODULE_COMPONENT_GUIDE.md` |
| T08 | Write the scope layer: version authority, roadmap, machine profile and measurement workflow. | Implemented | `docs/plan/VERSIONS.md`, `docs/plan/ROADMAP.md`, `docs/plan/PERFORMANCE_ACCEPTANCE.md` |
| T09 | Record the module contracts for the modules this phase creates. | Implemented | `docs/model/` |
| T10 | Build the C++ conformance gate with its own test suite. | Implemented | `tools/documentation/` |
| T11 | Record decisions taken during this phase as ADRs. | Implemented | `docs/adr/` |
| T12 | Record the executed verification for the version. | Implemented | `dev-log/` |

## M01 — project skeletons

| Id | Task | State | Code entry point |
|---|---|---|---|
| T20 | Importable Python package under `src/lifegame/` with tests. | Planned | — |
| T21 | Buildable Node package with a test entry point. | Planned | — |
| T23 | Establish the first measured admission floors on profile `M1`. | Planned | — |
| T24 | Continuous integration that runs the gate runner. | Planned | — |

## Delivered ahead of its milestone

| Id | Task | State | Code entry point | Delivered in |
|---|---|---|---|---|
| T22 | Single command running every gate with one exit code. | Implemented | `scripts/verify.ps1` | the version owning M00's fix, see [../VERSIONS.md](../VERSIONS.md) |
