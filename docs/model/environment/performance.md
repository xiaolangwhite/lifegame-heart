# environment — performance

> **Owner.** This file owns the module's performance contract: the admission
> floor, the oracle, the measurement method, the recorded observations, the
> scale matrix, the noise policy, the candidate set and the explicit list of
> unmeasured quantities. Machine profiles, the measurement workflow and the
> floor values are owned by
> [PERFORMANCE_ACCEPTANCE.md](../../plan/PERFORMANCE_ACCEPTANCE.md); version
> state by [VERSIONS.md](../../plan/VERSIONS.md).

Status: Partially Implemented

## 1. Is there a performance contract?

This module has one measured admission floor — the wall time of provisioning a
clean checkout with [scripts/bootstrap.ps1](../../../scripts/bootstrap.ps1) —
plus the floors for the two isolation commands. All of them are recorded in
[PERFORMANCE_ACCEPTANCE.md](../../plan/PERFORMANCE_ACCEPTANCE.md) §5, which owns
the values and the versions that established them; this file owns the
observations they were derived from, their lifecycle and their spread.

The module has no runtime latency, throughput or memory budget, and that
absence is safe for three reasons:

1. **Nothing in the product's runtime path calls it.** It runs when a session
   starts, when a checkout is provisioned, and when the isolation claim is
   checked. The simulation, the service and the UI never invoke it.
2. **Its cost is paid once per event, not per unit of work.** There is no
   scale dimension in the product sense: the cost does not grow with world
   size, request rate or message count.
3. **Its heavy cost is not its own.** The cold bootstrap is dominated by a
   network download; the dynamic phase's cost is dominated by the workloads it
   runs (`pnpm install`, the C++ tool build), whose budgets belong to the tools
   and to the `documentation` module, and by a scan whose input is the user
   profile rather than the project.

The operational limit that does apply to a gate is the 30-second gate for a
single verification command
([PERFORMANCE_ACCEPTANCE.md](../../plan/PERFORMANCE_ACCEPTANCE.md) §2). The full
isolation run is the module's slowest gate command and has been measured against
it (§7); provisioning is not a gate command and is measured against the
provisioning floor that §5 of that document owns.

## 2. The budget, as an admission floor

| Surface | Floor owner | Oracle | Latest observation |
|---|---|---|---|
| `verify.ps1` (default set, 7 gates) | [PERFORMANCE_ACCEPTANCE.md](../../plan/PERFORMANCE_ACCEPTANCE.md) §5 | exit code `0` plus wall time | 4.4 s of gate time, 4.8 s wall, all 7 gates passing (§7 row 13) |
| `verify.ps1 -Full` (9 gates) | [PERFORMANCE_ACCEPTANCE.md](../../plan/PERFORMANCE_ACCEPTANCE.md) §5; must fit the 30-second gate of §2 | exit code `0` plus wall time | 18.6–20.8 s wall across three passing runs (§7 row 14) |
| `verify-temp-isolation.ps1 -StaticOnly` | [PERFORMANCE_ACCEPTANCE.md](../../plan/PERFORMANCE_ACCEPTANCE.md) §5 | exit code `0` and 21 checks, 0 failures | 1.0–1.5 s inside the entry point; 1.11 s standalone (§7 row 1) |
| `verify-temp-isolation.ps1` (full) | [PERFORMANCE_ACCEPTANCE.md](../../plan/PERFORMANCE_ACCEPTANCE.md) §5; must fit the 30-second gate of §2 | exit code `0` and 22 checks, 0 failures | 10.2 s and 12.4 s standalone; 11.0 s and 11.9 s inside `-Full` (§7 row 2) |
| `bootstrap.ps1` from a clean checkout | [PERFORMANCE_ACCEPTANCE.md](../../plan/PERFORMANCE_ACCEPTANCE.md) §5 | exit code `0` plus wall time, with the download volume named | 522.6 s cold, dominated by a 21.7 MiB interpreter download (§7 row 8) |
| `bootstrap.ps1` on a provisioned checkout | [PERFORMANCE_ACCEPTANCE.md](../../plan/PERFORMANCE_ACCEPTANCE.md) §5 | exit code `0` plus wall time, no download | 1.8 s in the primary checkout, 2.1 s on the second run in the clone; 2.9–3.0 s inside `-Full` (§7 row 9) |

An admission floor is a starting line, not proof that optimisation is finished
([ENGINE_STANDARD.md](../../../ENGINE_STANDARD.md) §4). No floor is declared in
this file: the values live in
[PERFORMANCE_ACCEPTANCE.md](../../plan/PERFORMANCE_ACCEPTANCE.md) §5, and the
observations below are their inputs.

## 3. The oracle

| Question | Oracle |
|---|---|
| Is the environment correct? | Exit code `0` of [scripts/verify-temp-isolation.ps1](../../../scripts/verify-temp-isolation.ps1), with the check list printed |
| Is it fast enough? | Wall time of the deciding command, measured on a declared profile and lifecycle, with the exit code recorded alongside so a fast failure is never mistaken for a fast pass |
| Is a candidate better? | The same command, same inputs, same lifecycle, measured on the same profile, with a distribution rather than a single value |

A number without its exit code is not admissible evidence for this module: an
aborted run can be arbitrarily fast.

## 4. Measurement method

For every number recorded for this module:

1. **Profile.** Profile `M1` or a named alternative
   ([PERFORMANCE_ACCEPTANCE.md](../../plan/PERFORMANCE_ACCEPTANCE.md) §1).
2. **Lifecycle.** Cold (no `.venv`, no `.cache/`), warm (both present and
   current), cold clone (a `git clone` with no `.venv`, no `.cache/` and no C++
   build directory), or reused (state left by a previous run of the same
   command), and which of those apply.
3. **Unit.** Wall-clock seconds for the whole command, from process start to
   process exit, plus the exit code. A per-step timing is reported as a
   sub-stage and never as the whole-flow gate.
4. **Worker count.** One; the module runs its steps sequentially and starts no
   parallel workers. Any concurrency observed comes from the invoked tool and
   is named.
5. **Included and excluded stages.** Stated per measurement. Network transfer
   inside `uv python install`, `uv sync` and `pnpm install`, and any C++
   compilation, are named explicitly when included.
6. **Scale matrix.** The rows of §6 that apply, with the size of the watched
   location set and the number of files scanned under it recorded for the
   dynamic phase.
7. **Distribution.** At least three runs per cell; report the minimum, the
   median and the maximum, not a single value.
8. **Noise policy.** Declared before the run (§5).
9. **Loser kept.** A candidate that loses stays in the record with its result.
10. **Audit before dismissing.** A losing candidate is rechecked for logic
    errors, runtime errors, resource contention, multi-worker conflicts and
    sample size, in that order, before the loss is accepted
    ([PERFORMANCE_ACCEPTANCE.md](../../plan/PERFORMANCE_ACCEPTANCE.md) §3).

## 5. Noise policy

* A single run is never reported as a measurement. The observations of §7 are
  labelled as runs, they carry their reproduction command and exit code, and
  the run count behind each number is stated.
* Runs are taken with no other project build active; background activity that
  cannot be stopped (operating-system maintenance, antivirus scanning of the
  repository volume) is declared in the record.
* The dynamic phase's file scan competes with nothing, but its result depends on
  the state of the user profile; the number of files scanned is recorded with
  every dynamic observation, because the scan cost is proportional to it.
* A cold clone's dominant cost is a single network transfer. One cold run
  therefore measures the network as much as it measures the module, and it is
  reported with the transfer volume rather than as a stable figure.
* A documented machine limit is authoritative and is not overridden by jitter
  ([PERFORMANCE_ACCEPTANCE.md](../../plan/PERFORMANCE_ACCEPTANCE.md) §2).
* Any interrupted run is reported as interrupted and kept out of the
  distribution.

## 6. Scale matrix

The rows cross the states a checkout actually moves between, and the columns are
the two quantities the oracle returns.

| Cell | State | Node | C++ build | Recorded | Observed? |
|---|---|---|---|---|---|
| C1 | clean checkout: no `.venv`, no `.cache/` | included | included | wall time, exit code | yes, §7 row 8, on a clone |
| C2 | warm checkout: `.venv` and `.cache/` current | included | included | wall time, exit code | yes, §7 row 9 |
| C3 | warm checkout with `package.json` changed | included | included | wall time, exit code | not yet |
| C4 | warm checkout without Node | skipped | included | wall time, exit code | not yet |
| C5 | warm checkout without the C++ tool build | included | skipped | wall time, exit code | not yet |
| C6 | static phase only, warm checkout | n/a | n/a | wall time, exit code | yes, §7 row 1 |
| C7 | warm checkout with a small watched set | included | skipped | wall time, exit code, file count `F` | not yet |
| C8 | warm checkout with the profile's full watched set | included | skipped | wall time, exit code, file count `F` | partly, §7 records `F` for the full set |
| C9 | cold clone: provisioned from nothing, then every gate run inside it | included | included, from scratch | wall time, exit code, every resolved path | yes, §7 rows 8, 10, 11 and 12 |
| C10 | warm checkout, the aggregate entry point, default set | included | included, incremental | wall time, exit code, per-gate table | yes, §7 row 13 |
| C11 | warm checkout, the aggregate entry point, `-Full` | included | included, incremental | wall time, exit code, per-gate table | yes, §7 row 14 |
| C12 | warm checkout, the entry point started from a subdirectory | included | included, incremental | wall time, exit code, the failing gate | yes, §7 row 15 |

`F` is the number of files below the watched roots. Cells C7 and C8 exist
because the dynamic phase is `O(F)` and `F` is the only quantity in this module
that can grow without the project changing. Cell C9 exists because a clone is
the only state in which a cache that resolves into a *different* checkout is
observable; it is the state that found the defect recorded in
[testing.md](testing.md) §6 row 10. Cells C10 to C12 exist because the
aggregate entry point is the command a session actually runs, and C12 records
the state in which it is started from the wrong directory
([risks.md](risks.md) ENV-08).

## 7. Recorded observations

All observations below are on profile `M1`, one worker, recorded 2026-10-08.
Lifecycles: **warm** (`.venv` and `.cache/` present and current) and **cold
clone** (a `git clone` of the repository with no `.venv`, no `.cache/` and no
C++ build directory). Each observation names the command that produced it; the
static and dynamic phases of one command are sub-stages of that command and are
never reported as the whole-flow gate.

| # | Command | Lifecycle | Observed | Exit code | Runs |
|---|---|---|---|---|---|
| 1 | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-temp-isolation.ps1 -StaticOnly` | warm | 21 checks, 0 failures; 1.11 s end to end including the nested PowerShell start | `0` | 3 |
| 2 | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-temp-isolation.ps1` | warm | 22 checks (21 static + 1 dynamic), 0 failures; re-observed at 13.1 s on the current revision; earlier recorded runs of this version at 14.8 s, 16.2 s and 18.8 s | `0` | 4 |
| 3 | the same full command, dynamic phase only | warm | 78,505 files scanned under the watched roots; 1 changed, 1 excused by the proven environmental class, 0 unexplained | — | 3 |
| 4 | `uv run python -c "pass"` | warm | ≈350 ms project overhead (implicit sync included); 402 ms in the check run | `0` | 2 |
| 5 | `uv run --no-sync python -c "pass"` | warm | ≈95 ms; 93 ms in the check run | `0` | 2 |
| 6 | `uv run pytest -q` | warm | 14 passed; 0.03 s of pytest time excluding `uv` overhead; 804 ms wall including `uv` and a 254 ms bytecode compile | `0` | 1 |
| 7 | full run, peak working set of the checking process | warm | 313.7 MB | — | 1 |
| 8 | `git clone . TEMP/clone-check`, then `scripts/bootstrap.ps1` inside the clone | cold clone | 522.6 s, dominated by a 21.7 MiB CPython 3.14.7 download and `uv sync` | `0` | 1 |
| 9 | `scripts/bootstrap.ps1` on a provisioned checkout | warm | 1.8 s in the primary checkout; 2.1 s on the second run in the clone; no download in either | `0` | 3 |
| 10 | `scripts/verify-temp-isolation.ps1 -StaticOnly` inside the clone | cold clone | 21 checks, 0 failures; every resolved path inside the clone | `0` | 1 |
| 11 | `tools/documentation/validate-documentation.ps1` inside the clone | cold clone, tool built from scratch | 0 violations over 110 entries; `configure` 3.4 s, `build` 3.81 s | `0` | 1 |
| 12 | `pnpm config get storeDir` and `pnpm store path` inside the clone | cold clone | `.cache/pnpm-store` (declared, relative) and `<clone>\.cache/pnpm-store\v11` (resolved) | `0` | 1 |
| 13 | `scripts/verify.ps1` | warm | 7 gates, all passing, 4.4 s of gate time and 4.8 s wall; per-gate: documentation 415 ms, self-tests 1218 ms, tool build 323 ms, isolation static 1343 ms, pytest 664 ms, ruff 329 ms, node 76 ms | `0` | 2 |
| 14 | `scripts/verify.ps1 -Full` | warm | 9 gates; 18.6 s, 19.7 s and 20.8 s wall on passing runs; the two added gates cost 11.0–11.9 s (isolation full) and 2.9–3.0 s (bootstrap idempotence) | `0` on three runs, `1` on one run recorded in row 16 | 4 |
| 15 | `scripts/verify.ps1 -SkipNode` started from `docs/` | warm, wrong working directory | 6 gates; `python tests` exited `5` ("no tests ran") and the run reported `1 of 6 gate(s) failed in 5.7 s`; no cache or temporary directory appeared under the subdirectory | `1` | 1 |
| 16 | `scripts/verify.ps1 -Full`, the one failing run | warm | `1 of 9 gate(s) failed in 19.3 s`: `isolation (full, version-boundary)` exited `1`. The run's output was truncated before the violating path was printed, so the path was not captured | `1` | 1 |

Row 16 is the only failure recorded against the current revision, and it is the
reason [risks.md](risks.md) ENV-04 exists. Four later `-Full` runs (three of
them in row 14) and two standalone full isolation runs in row 2 all exited `0`,
so the failure is not reproducible on demand. The harness exclusion pattern
covers one of the harness's several `dsh-` directory families, and the
directory listing taken afterwards found 46 `dsh-` directories of which none
matched the pattern as a directory path; a harness capture written during the
window is the most likely cause, and a third-party application
(`WeTypeVoiceDiagnostic_*.log`) was observed writing into the same directory in
the same session. Both are stated as the observed residue, not as a proven
attribution.

The number that matters for the gate is row 2: on the current revision the full
isolation run was observed at 10.2 s and 12.4 s standalone and at 11.0 s and
11.9 s when the entry point ran it, against the 30-second limit of
[PERFORMANCE_ACCEPTANCE.md](../../plan/PERFORMANCE_ACCEPTANCE.md) §2. Earlier
runs of this version, taken before the environmental exclusion was redesigned
and while the fixture suite still cost 28 s, were recorded at 13.1 s, 14.8 s,
16.2 s and 18.8 s. The spread is why §5 refuses to report a single run as a
measurement.

Row 13 is the number a session pays per edit, and row 14 is the number a
version boundary pays. The two gates that `-Full` adds are the whole difference:
isolation full and bootstrap idempotence together account for 14–15 s of the
18.6–20.8 s total, and both are evidence for a delivered revision rather than
feedback for an edit, which is why they are not in the default set.

Row 8 is not a gate command: the cold bootstrap takes 522.6 s and therefore
cannot sit under the 30-second gate that
[PERFORMANCE_ACCEPTANCE.md](../../plan/PERFORMANCE_ACCEPTANCE.md) §2 applies to
gates and smoke runs. It is provisioned against the bootstrap floor in §5 of
that document, and it is listed here with its lifecycle so that the two limits
are not confused.

Rows 8, 10, 11 and 12 were taken on one clone, in one sequence: provisioning
first, then the static check, then the conformance gate. Row 11 therefore
includes a from-zero C++ build of the gate tool, which the primary checkout has
never had to perform for this measurement.

The file count behind rows 2 and 3 was broken down on 2026-10-08 as follows.
The runs recorded on 2026-10-10 scanned 78,685 to 78,687 files under the same
depth bounds, so the composition below is representative of the shape rather
than exact for those runs:

| Watched root | Files | Scan |
|---|---|---|
| `%LOCALAPPDATA%\uv` | 42,749 | recursive |
| `%LOCALAPPDATA%\npm-cache` | 28,334 | recursive |
| `%APPDATA%\uv` | 5,428 | recursive |
| `%LOCALAPPDATA%\pip` | 963 | recursive |
| `%APPDATA%\npm` | 469 | recursive |
| `%USERPROFILE%\.local\bin` | 4 | recursive |
| `%APPDATA%\pip` | 1 | recursive |
| the system temporary directory | 558 | two levels deep |
| **total** | **78,506 counted directly; 78,505 reported by the check run** | |

The one-file difference is the check's own bookkeeping: the direct count was
taken at a moment when the system temporary directory held one more file than
during the recorded check run. Both numbers refer to the same traversal order
and the same depth bound, and neither is stable across runs — the point of
recording them is that `F` is around 78,500 and is dominated by package caches,
not by the repository.

Cost fractions observed on 2026-10-08: the recursive package-cache traversal
accounted for ≈7.2 s of the full run, the two-level system-temporary traversal
for ≈0.08 s, and the workload steps for the remainder. The static phase is
≈1 s. On the current revision the full run is 10.2–12.4 s, and the scan is
still the largest single contributor, so `F` — not the repository — sets the
cost of that gate.

The depth bound is what keeps that contributor inside the gate, and the figure
that motivated it is larger than the one measured above: an observation taken
while the dynamic phase was being redesigned put a full recursive scan of the
system temporary directory on this machine at about 11 s for a single pass.
That observation and the ≈7.2 s package-cache traversal above are not directly
comparable — they were taken at different moments, with a different system
temporary-directory population, and the first one was a single pass over data
that the second does not traverse — so this file records both with their origin
rather than reconciling them into one number. Either figure is enough to make
the point: an unbounded traversal of the system temporary directory is the part
of the dynamic phase that can grow without the repository changing, which is why
[interfaces.md](interfaces.md) §4.3 states the two-level bound as part of the
watched-location contract.

The environmental-class exclusion no longer has a proof step to cost anything.
The class is characterised once, with its evidence in
[evidence/windows-temporary-artifact-class.md](../../../evidence/windows-temporary-artifact-class.md),
and the run applies a per-path shape test whose cost is `O(C)` in the number of
changed paths — normally zero. The design it replaced did have a measurable
cost: it either listed the system temporary directory or, in the no-history
case, slept for ten seconds and scanned, and on the failure that removed it the
run took 25 s against a normal 11–12 s. That path no longer exists, so it is
recorded as history in [testing.md](testing.md) §6 row 11 rather than as an
unmeasured branch.

### What is still not a measurement

Rows 1–12 are single- or few-run observations, not the three-run-per-cell
distribution that §4.7 requires. They are recorded because a number that was
observed must be recorded with its command and exit code, and because the
30-second gate needed a real answer; they are not an admission floor and are not
copied into [PERFORMANCE_ACCEPTANCE.md](../../plan/PERFORMANCE_ACCEPTANCE.md) §5.

## 8. What has not been measured

The explicit list of quantities with no observation behind them:

* The per-step cost of bootstrap: the guard and skeleton step, `uv python
  install`, `uv venv`, `uv sync`, `pnpm install`, and the static check it
  invokes last. Only the whole command is recorded (row 8), and its dominant
  stage is named by inspection, not by instrumentation.
* The split of the 522.6 s cold bootstrap between download, extraction and
  `uv sync`; the download volume (21.7 MiB) is recorded, the time split is not.
* Cell C3 (warm checkout with `package.json` changed), cell C4 (`-SkipNode`)
  and cell C5 (`-SkipCpp`), and cell C7 (small watched set).
* Repeated cold-clone runs. One run is recorded; its dominant cost is a single
  network transfer, so it is not a stable measurement of the module.
* The wall time of the C++ tool build as a dynamic-phase workload step measured
  on its own, on a cold build tree. Row 11 records a from-zero build inside the
  conformance gate; the entry point's incremental tool-build gate is 0.3–0.5 s
  (row 13), and the build's own freshness check is owned by the `documentation`
  module.
* The entry point's behaviour when a gate throws: the code path records `2` for
  that gate, but no negative fixture provokes it, so it is unexercised.
* Repeated runs of the entry point from a subdirectory. One run is recorded
  (row 15, cell C12); whether the failing gate is always the Python one has not
  been established.
* The per-gate cost distribution of `-Full` beyond the two added gates; row 14
  records the total and the two large contributors, not a distribution.
* Whether a second cache tree actually appears when `uv` or pip runs from a
  subdirectory of the checkout. The mechanism is documented by both tools and is
  an open risk ([risks.md](risks.md) ENV-06), but no run has captured the
  resulting directory.
* Peak working-set memory of the scan as a function of `F`; one full-run
  observation exists (313.7 MB) and no scaling series does.
* The effect of `compile-bytecode = true` on `uv sync` wall time.
* The cost of the static check added last — one text read of
  [uv.toml](../../../uv.toml) — as distinct from the other 20 checks.
* The wall time of `docguard` on the full repository. An intermediate value of
  0.4 s was observed while the gate was being built; the `documentation`
  module's dev-log owns the final figure for that gate, and this file does not
  restate it.
* Whether any candidate in §9 is faster than the current implementation.
* Any comparison against another machine profile, and any portability claim.

## 9. Candidate set

The candidates are listed so that the first formal measurement run compares
them instead of accepting the first implementation that works
([ENGINE_STANDARD.md](../../../ENGINE_STANDARD.md) §2.3). None of them has been
measured except where §7 says so.

| Candidate | What it changes | Hypothesis to test | Status |
|---|---|---|---|
| A — current sequential idempotent steps | baseline | — | in production |
| B — skip `uv sync` when `.venv` and `uv.lock` are unchanged | one cheap stamp check before a network-capable step | warm bootstrap is dominated by `uv sync` | unmeasured |
| C — `uv sync --frozen` when the lock exists | removes re-resolution | re-resolution is part of the warm cost | unmeasured |
| D — run the independent steps concurrently | step ordering | no step depends on another's output except the skeleton; the gain is bounded by the slowest step | unmeasured |
| E — `-StaticOnly` instead of the full check inside bootstrap | what bootstrap validates | the full check inside bootstrap would exceed the 30-second gate | **decided, not by measurement**: bootstrap already uses `-StaticOnly`, because the full check includes `pnpm install`, a C++ build and a 78,500-file scan, none of which belong to provisioning |
| F — one time-filtered scan instead of two full snapshots | the dynamic phase's algorithm | it halves the traversal cost and detects the same two events | **in production**; it replaced two snapshots and is one reason the full run fits the gate (§7, row 2) |
| G — a full recursive scan of the system temporary directory instead of two levels | scan depth | deeper scanning detects more | **audited and not adopted**: the package caches, not the system temporary directory, dominate `F` (§7), and the extra depth detects no event that the two-level bound misses |
| H — absolute declared cache paths, the form this module shipped first | where a configuration file says the cache lives | an absolute declaration pins every cache to one place | **removed from production, by evidence**: a clone's `pnpm store path` resolved into the primary checkout, so each copy was isolated in name only. Replaced by checkout-relative declarations, decided in [ADR 0004](../../adr/governance-and-build/0004-cache-locations-are-checkout-relative.md); the defect is [testing.md](testing.md) §6 row 10 |
| I — re-earning the environmental exclusion on every run | whether an observed machine class may be excused | a per-run proof is stronger than a recorded characterisation | **removed from production, by evidence**: the proof failed on an unchanged tree after an operating-system cleanup and a quiet idle window, and the gate took 25 s against 11–12 s. Replaced by the characterised class in [evidence/windows-temporary-artifact-class.md](../../../evidence/windows-temporary-artifact-class.md); the defect is [testing.md](testing.md) §6 row 11 |
| J — fixing the working directory in the entry point before the first gate | what directory the gates run in | the gates that depend on the working directory stop failing when the caller starts elsewhere | **decided, not yet implemented**: one run from a subdirectory made the `python tests` gate exit `5` (row 15). The fix is one line and is owned by the version owning M01 ([risks.md](risks.md) ENV-08) |
| K — widening the harness exclusion pattern to every `dsh-` family | which harness paths the dynamic phase ignores | the observed intermittent false failure disappears | **decided, not yet implemented**: the pattern covers one family of several, measured against 46 directories (row 16). Owned by the version owning M01 ([risks.md](risks.md) ENV-04) |
| L — one process for several `docguard` cases instead of one per case | the fixture suite's process count | the suite's harness cost dominates its tool cost | **already realised in the tool**: the suite went from 28.3 s to 1.2–1.5 s when `Start-Process` was replaced by a direct call, which is why the entry point's self-test gate is now about a second (row 13). Owned by the `documentation` module's record |

For the check itself, the production requirement is not speed but the 30-second
gate and the correctness of the observation. A candidate that is faster because
it observes less is not a candidate.
