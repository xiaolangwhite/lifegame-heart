# ADR 0004 — Cache locations are checkout-relative

## Status

Accepted (2026-10-08). Implemented by the environment module delivered with the
version that names phase 01 milestone 00 in
[../../plan/VERSIONS.md](../../plan/VERSIONS.md), and verified by a cold-clone
run recorded in [../../../dev-log/v0.1.0.md](../../../dev-log/v0.1.0.md).

## Context

[ADR 0002](0002-confine-transient-artifacts-to-repository.md) decided that cache
locations declared in project configuration files are **absolute** paths inside
the repository. The reasoning at the time was that a relative path is resolved
against the current working directory, so a command run from a subdirectory
would scatter caches; an absolute path pins them to one place.

That reasoning is sound for a single checkout and wrong for more than one. An
absolute path in a committed file names exactly one directory. A `git clone`, a
`git worktree`, or a second checkout therefore sends its caches **into the
original checkout**: each copy believes it is isolated while all of them share
and contend for one directory. This is not theoretical here — the agent
environment creates a worktree per task, and this project's first cold-clone
verification failed on it:

```
[FAIL] pnpm storeDir      <repo>/.cache/pnpm-store
[FAIL] pnpm cacheDir      <repo>/.cache/pnpm-cache
[FAIL] pnpm store path    <repo>/.cache/pnpm-store\v11
```

The clone's own store resolved to the primary checkout. The isolation check
caught it; nothing else would have.

Two secondary facts shaped the replacement:

* `pnpm config get storeDir` answers with the declared string, so a check that
  reads the declaration cannot tell "declared correctly" from "actually used".
  The same run showed the *resolved* store was also absolute — and outside the
  clone.
* `uv` resolves a relative `cache-dir` against the working directory, while
  `pnpm` resolves a relative `storeDir` against the workspace root. The
  behaviours differ and the decision has to accommodate both.

## Decision

* Every cache location **declared in a committed configuration file** is
  repository-relative: `cache-dir` in `uv.toml`, `storeDir` and `cacheDir` in
  `pnpm-workspace.yaml`, `cache-dir` in `scripts/pip.ini`.
* `.npmrc` declares no settings at all, because npm resolves a relative path
  against the working directory and an absolute path binds one checkout. The
  npm cache location is owned solely by `UV`-style environment variables
  exported from `scripts/env.ps1`, which computes them from that script's own
  location and is therefore correct in any checkout.
* `scripts/env.ps1` remains the authoritative mechanism. It produces **absolute**
  values for the running checkout, and it takes precedence over every declared
  fallback.
* The isolation check validates both forms, because each catches what the other
  misses:
  * a **declared** value must be relative and must not escape the repository
    when resolved against its root — this catches a checkout-bound path;
  * a **resolved** value must be absolute and inside the repository — this
    catches a declaration that the tool ignores or misresolves.
* The working directory for every toolchain command is the repository root, as
  fixed by [AGENTS.md](../../../AGENTS.md) §1.

## Consequences

* Renaming, moving, cloning or forking the repository requires **no**
  configuration edit. The previous form did.
* A clone or worktree can no longer write into another checkout. The failure
  mode that motivated this ADR is gone rather than merely detectable.
* `uv` invocations from a subdirectory create a second cache directory under
  that subdirectory. It stays inside the checkout, and `UV_CACHE_DIR` from the
  environment script overrides the declared fallback entirely; the dependency
  is recorded as an open risk in
  [../../plan/phase-01-foundation/risks.md](../../plan/phase-01-foundation/risks.md).
* The check grew from 20 to 21 static checks, and one of them now reads a
  configuration file as text (`uv.toml`'s `cache-dir`) rather than asking the
  tool. That is deliberate: asking `uv` returns the environment variable's
  value when the script has been sourced, which would hide a bad declaration.
* Anyone who reads ADR 0002 alone will find the superseded rule; the
  `Superseding` section there points here.

## Superseding

This ADR supersedes the absolute-path clause of
[ADR 0002](0002-confine-transient-artifacts-to-repository.md). ADR 0002's
central decision — every transient artifact stays inside the repository tree,
and the environment script refuses to continue when one does not — is unchanged
and remains in force.
