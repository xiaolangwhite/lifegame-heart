# Focused plan — v0.1.0

> Version state is owned by [../../../VERSIONS.md](../../../VERSIONS.md). This
> plan owns the implementation boundary of one version.

## Goal

Make the repository reproducible and self-verifying before any simulation code
exists: a Python 3.14 environment managed by uv, with every temporary file,
package cache and build intermediate confined to the repository tree, plus a
documentation system whose conformance is decided by an executable gate.

## Exact implementation boundary

| Area | Paths | Change |
|---|---|---|
| Environment contract | `scripts/env.ps1`, `scripts/pip.ini`, `uv.toml`, `.python-version`, `.npmrc`, `pnpm-workspace.yaml` | create |
| Provisioning | `scripts/bootstrap.ps1` | create |
| Isolation proof | `scripts/verify-temp-isolation.ps1` | create |
| Python project | `pyproject.toml`, `.venv/` | create |
| Node project | `package.json` | create |
| Normative layer | `ENGINE_STANDARD.md`, `docs/plan/VERSIONS.md` | create |
| Policy layer | `AGENTS.md`, `docs/DOCUMENTATION_RULES.md`, `docs/AI_DOCUMENTATION_GUIDE.md`, `docs/MODULE_COMPONENT_GUIDE.md`, `docs/plan/PERFORMANCE_ACCEPTANCE.md` | create |
| Scope layer | `docs/plan/phase-01-foundation/`, `docs/model/`, `docs/adr/` | create |
| Evidence layer | `dev-log/`, `evidence/` | create |
| Gate | `tools/documentation/` | create |

## Explicitly out of scope

* Any simulation behaviour, world representation or cellular rule.
* Any service endpoint, protocol or user interface.
* Continuous integration configuration.
* Measured admission floors — they belong to the next milestone in
  [../../../plan/phase-01-foundation/milestones.md](../../milestones.md).

## Gates to run

| Gate | Command |
|---|---|
| Documentation conformance | `tools/documentation/validate-documentation.ps1` |
| Gate self-tests | `tools/documentation/tests/run-tests.ps1` |
| Isolation | `scripts/verify-temp-isolation.ps1` |
| Bootstrap idempotence | `scripts/bootstrap.ps1` twice |
| Python tests and lint | `uv run pytest`, `uv run ruff check` |
| Repository cleanliness | `git diff --check`, `git status --porcelain` |

## Definition of done

Every criterion in
[../../../plan/phase-01-foundation/acceptance.md](../../acceptance.md) holds,
with the deciding command and its observed result recorded in
`dev-log/v0.1.0.md`.

## Known blocker carried into this version

Creating a directory outside a sandboxed session makes it unwritable for that
session, so the directory skeleton is created by the provisioning script rather
than by hand. Full mechanism and evidence:
[evidence/windows-directory-access-label.md](../../../../../evidence/windows-directory-access-label.md).
