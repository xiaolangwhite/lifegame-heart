# ADR 0002 — Confine every transient artifact to the repository tree

## Status

Accepted (2026-10-08). Implemented by the environment module delivered with the
version that names phase 01 milestone 00 in
[../../plan/VERSIONS.md](../../plan/VERSIONS.md).

## Context

The development machine has a small system volume: `C:` holds 200 GB with
40.8 GB free, while the repository volume holds 3526 GB with 2151.4 GB free
([../../plan/PERFORMANCE_ACCEPTANCE.md](../../plan/PERFORMANCE_ACCEPTANCE.md) §1.1).
Package caches, interpreter payloads, bytecode caches and build intermediates
are exactly the artifacts that grow without bound, so their default location —
the user profile on the system volume — is the wrong one.

Additionally, the agent runtime hands every shell command a fresh temporary
directory on the system volume. A toolchain that is simply "run as usual"
therefore pollutes the system volume by default, every time, and neither the
tool nor the caller notices.

Observed facts that constrain the solution:

* uv resolves a relative `cache-dir` against the **current working directory**,
  so a relative value produces a second cache tree whenever a command runs from
  a subdirectory.
* `uv.toml` supports `cache-dir` but not `python-install-dir`; an unknown key
  makes the whole file fail to parse. The interpreter payload directory can
  only be set through `UV_PYTHON_INSTALL_DIR` or `--install-dir`.
* pip, npm and pnpm each read a different configuration surface, and each has a
  user-level default on the system volume that silently wins if the project
  configuration is not selected.

## Decision

* Every transient location is defined in exactly one place,
  `scripts/env.ps1`, which is sourced into each shell before any toolchain
  command runs.
* The script refuses to continue — it throws — when a location it manages still
  points at `C:`. A silent fallback is treated as worse than a failure.
* Cache paths in `uv.toml`, `.npmrc` and `scripts/pip.ini` are absolute and
  inside the repository. `PIP_CONFIG_FILE` is set so the user-level pip
  configuration cannot win.
* Isolated directory creation is confined to `scripts/bootstrap.ps1`, because a
  directory created outside a sandboxed session does not inherit the access
  label that sandboxed sessions require (see
  [../../../evidence/windows-directory-access-label.md](../../../evidence/windows-directory-access-label.md)).
* `scripts/verify-temp-isolation.ps1` proves the property rather than asserting
  it: a static phase checks every resolved location, and a dynamic phase
  snapshots the system-volume fallback locations, runs a representative
  workload and reports every file created or modified below them.

## Consequences

* Moving the repository requires updating the absolute paths in `uv.toml`,
  `.npmrc` and `scripts/pip.ini`. This is recorded as a risk with a named
  owner in [../../plan/phase-01-foundation/risks.md](../../plan/phase-01-foundation/risks.md).
* Every new tool that writes transient files must be added to `scripts/env.ps1`
  and to the `environment` module's `interfaces.md` in the same change.
* The isolation check has to know which system-volume paths are the
  *harness's* and not the project's; it excludes the per-command temporary
  directory the agent runtime creates, and documents that exclusion where it
  is applied.
* A wrongly configured shell now fails loudly instead of quietly writing to the
  system volume.

## Superseding

The clause of the Decision that requires cache paths in `uv.toml`, `.npmrc`
and `scripts/pip.ini` to be **absolute** is superseded by
[ADR 0004](0004-cache-locations-are-checkout-relative.md), which makes them
checkout-relative after a clone and a git worktree were observed writing their
caches back into the original checkout.

Everything else here stands: transient artifacts stay inside the repository
tree, `scripts/env.ps1` is the authoritative definition of where they go, and
it refuses to continue when a location points at the system volume.
