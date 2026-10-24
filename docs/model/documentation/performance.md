# documentation — performance

> **Owner.** This file owns the module's performance contract: the admission
> floor, the oracle, the measurement method, the candidate set, the scale matrix,
> the noise policy and the explicit list of unmeasured quantities. Machine
> profiles and the measurement workflow are owned by
> [PERFORMANCE_ACCEPTANCE.md](../../plan/PERFORMANCE_ACCEPTANCE.md); the version
> that owns the floor is the one named there; version state lives in
> [VERSIONS.md](../../plan/VERSIONS.md).

Status: Unvalidated

## 1. Is there a performance contract?

There is exactly one admission floor for this module — the wall time of the
documentation gate on the full repository — and it is **not established**.
[PERFORMANCE_ACCEPTANCE.md](../../plan/PERFORMANCE_ACCEPTANCE.md) §5 declares it
as an open admission floor and names the version that owns establishing it; no
floor may be quoted as if it had been established.

The module needs a timing contract, unlike a module whose cost is paid once per
session, because the gate runs on every documentation change and its cost grows
with the tree. It needs no throughput, latency-percentile or memory floor today,
for three reasons:

1. **It is a batch process, not a service.** One invocation, one verdict, one
   process. There is no request rate, no concurrency and no steady state.
2. **Its scale dimension is the tree, and the tree is small.** Across the
   revisions measured in §6 the repository scan enumerated 92 to 113 entries;
   the fixtures are 19 to 29.
3. **Its only operational limit is the 30-second gate** for a single
   verification command
   ([PERFORMANCE_ACCEPTANCE.md](../../plan/PERFORMANCE_ACCEPTANCE.md) §2). Every
   measured surface of the module is below it, and the slowest — the fixture
   suite at 1.47 s to 1.62 s — has roughly a factor of twenty in hand (§6).

## 2. The budget, as an admission floor

| Surface | Floor | Oracle | Status | Owning version |
|---|---|---|---|---|
| `docguard` on the full repository | not established | wall time of the command plus its exit code, on a declared profile and lifecycle | `Unvalidated` | the version named where [PERFORMANCE_ACCEPTANCE.md](../../plan/PERFORMANCE_ACCEPTANCE.md) §5 records the floor, owning milestone M01 |
| [validate-documentation.ps1](../../../tools/documentation/validate-documentation.ps1) end to end, including PowerShell start-up | not established | wall time plus the forwarded exit code | `Unvalidated` | as above |
| [tests/run-tests.ps1](../../../tools/documentation/tests/run-tests.ps1) | not established; measured at 1.47 s to 1.62 s end to end, so it now fits the 30-second gate with roughly a factor of twenty in hand (§6) | wall time plus exit code, with the assertion count | the floor is `Unvalidated`; the measurement is scoped to the revision named in its cell | as above |
| [build.ps1](../../../tools/documentation/build.ps1) when every input is older than the artifact | not established; measured at 0.33 s to 0.39 s including PowerShell start-up (§6) | wall time plus exit code | as above | as above |
| [build.ps1](../../../tools/documentation/build.ps1) after an input changes, or with `-Clean` | not established; measured at 6.08 s after one source file's modification time advanced, and 4.66 s of compiler time from an empty build directory (§6) | wall time plus exit code | `Unvalidated` | as above |

An admission floor is a starting line, not proof that optimisation is finished
([ENGINE_STANDARD.md](../../../ENGINE_STANDARD.md) §4).

## 3. The oracle

| Question | Oracle |
|---|---|
| Is the tree conformant? | Exit code `0` of `docguard`, with the summary line's scanned-entry count printed alongside |
| Is it fast enough? | Wall time of the deciding command on a declared profile and lifecycle, **with the exit code recorded next to it** |
| Is a candidate faster? | The same command over the same tree, same lifecycle, same profile, three runs per cell, reported as minimum, median and maximum |
| Is the output stable? | Byte comparison of two runs' stdout, which is also an acceptance criterion of its own |

A number without its exit code is not admissible evidence for this module: a run
that aborts after three files is fast and worthless. The scanned-entry count is
recorded with every timing for the same reason — it is the size of the input the
verdict actually covers.

## 4. Measurement method

For every number recorded for this module:

1. **Profile.** Profile `M1` or a named alternative
   ([PERFORMANCE_ACCEPTANCE.md](../../plan/PERFORMANCE_ACCEPTANCE.md) §1).
2. **Lifecycle.** The measurements of §6 are **warm**: the executable already
   existed, the build was not run, and the operating system's file cache was
   populated by the preceding runs.
3. **Unit.** Wall-clock seconds for the whole command, from process start to
   process exit, plus the exit code and the scanned-entry count. A per-file or
   per-rule timing is a sub-stage and is never reported as the whole-flow number.
4. **Worker count.** One. `docguard` starts no threads and no child processes.
5. **Included and excluded stages.** Included: process start, traversal, reads,
   every check, ordering and rendering. Excluded: the build, because the artifact
   was already present; when the build is included it is named.
6. **Scale matrix.** The rows of §6 that apply, with the entry count recorded.
7. **Distribution.** Three consecutive runs per cell; minimum, median and maximum
   are reported, never a single value.
8. **Noise policy.** Declared in §5.
9. **Loser kept.** A candidate that loses stays in the record with its result.
10. **Audit before dismissing.** A losing candidate is re-checked for logic
    errors, runtime errors, resource contention, multi-worker conflicts and
    sample size, in that order, before the loss is accepted
    ([PERFORMANCE_ACCEPTANCE.md](../../plan/PERFORMANCE_ACCEPTANCE.md) §3).

## 5. Noise policy

* A single run is never reported as a measurement.
* The three runs of a cell are consecutive, in one PowerShell session, with
  `Measure-Command` around a single process launch.
* The tree must be **unchanged across the three runs of a cell**. The repository
  is edited by more than one agent at a time, so the scanned-entry count is
  recorded per cell and a cell whose counts disagree between runs is discarded.
* The build is excluded from §6 and named where it is not.
* A documented machine limit is authoritative and is not overridden by jitter
  ([PERFORMANCE_ACCEPTANCE.md](../../plan/PERFORMANCE_ACCEPTANCE.md) §2).
* An interrupted run is reported as interrupted and kept out of the distribution.

## 6. Scale matrix

Observed on profile `M1`, 2026-10-08, warm lifecycle, one worker, three
consecutive runs per cell, `docguard --root <tree> --quiet`, wall time of the
process launch. The tree was being edited concurrently by other work in the same
repository, so each row states the entry count that the run itself reported.

| Cell | Tree | Entries | Min (s) | Median (s) | Max (s) | Exit |
|---|---|---|---|---|---|---|
| C1 | `tests/fixtures/layout-missing` (smallest fixture) | 19 | 0.0234 | 0.0243 | 0.0253 | 1 |
| C2 | `tests/fixtures/clean` | 20 | 0.0239 | 0.0256 | 0.0435 | 0 |
| C3 | `tests/fixtures/module-catalog` (largest fixture) | 29 | 0.0257 | 0.0285 | 0.0404 | 1 |
| C4 | the whole repository | 113 | 0.0751 | 0.0756 | 0.1249 | 0 |
| C5 | the whole repository through [validate-documentation.ps1](../../../tools/documentation/validate-documentation.ps1) with `--format json`, one run | 113 | — | 0.37 | — | 0 |

### 6.0 The two costs that did not fit the shape, before and after

The suite and the build were the only surfaces of this module whose cost came
from the harness rather than from the tool, and both were measured before and
after the change that removed it. The "before" column is not a reconstruction:
it is the measurement that motivated the change.

| Observation | Command | Before | After |
|---|---|---|---|
| The full fixture suite | `powershell -NoProfile -ExecutionPolicy Bypass -File tools/documentation/tests/run-tests.ps1 -SkipBuild` | exit `0`, `61 assertion(s)`, **28.99 s** wall, one run, 54 captured output files | exit `0`, `61 assertion(s)`, **1.62 / 1.55 / 1.47 s** wall, three runs, no scratch files |
| The build with nothing to do | `... tools/documentation/build.ps1 -Quiet` | **4.4 s** wall: the script ran `cmake --build` unconditionally, and the build driver alone costs 4.26 s before it can decide there is nothing to do | exit `0`, **349 / 388 / 383 ms** wall, three runs |
| The build after one input changed | the same command, after the modification time of `src/main.cpp` was advanced | not distinguishable from the no-op case: the driver rebuilt either way | exit `0`, **6.08 s** wall; the artifact's modification time advanced and the source content was unchanged |

The before column for the suite decomposes exactly. The runner launched the
executable 27 times through `Start-Process` with redirected stdout and stderr,
which costs about **1.03 s per launch** on profile `M1`, while the executable
itself finishes in about **63 ms**. So 27 × 1.03 s ≈ **27.8 s** of the 28.99 s
was PowerShell's process plumbing — roughly **98%** of the run — and no
assertion ever read those scratch files. The current runner calls the executable
directly, takes the exit code from `$LASTEXITCODE` and the report from the
output stream, and compares the decoded stdout text in memory, so the harness
cost is one process start instead of twenty-seven.

The before column for the build is the reason the freshness check exists: at
4.26 s per invocation the build driver was the single largest item in every gate
run, including the runs where no input had changed since the last one. The
check compares the artifact's modification time against the newest file under
`src/` plus `CMakeLists.txt` and, when the artifact is not older, returns
without invoking the build system at all. The rebuild path is still exercised —
the third row is that measurement — and `-Clean` keeps its meaning of "remove
the build directory first".

The C5 row is **not** comparable with C1 to C4 in precision: it includes a
PowerShell start-up, about 0.3 s of its 0.37 s. Per invocation `docguard` takes
0.02 s to 0.13 s, and that is the number the suite's residual 1.47 s is spent
around rather than on.

The rows were not all taken at one revision: C1 to C3 are fixture trees whose
content did not change, while C4 and C5 are the same real repository measured
minutes apart. The "before" column of §6.0 was measured on 2026-10-08; the
"after" column on 2026-10-10, at the revision the round introduced.

The same before-and-after pair is recorded by the version that made the change in
[dev-log/v0.1.0fix1.md](../../../dev-log/v0.1.0fix1.md): it reports 28.3 s before
and 1.1 s to 1.3 s after for the suite, and 4.4 s before and 0.30 s after for the
no-op build. Those figures are **not** directly comparable with the ones above,
because they were taken through different wrappers: every timing on this page is
the wall time of a whole `powershell -File` invocation and therefore includes
about 0.3 s of PowerShell start-up. Keeping both, with their boundaries stated,
is the honest option; averaging them would not be.

An intermediate revision of the same repository produced 0.4 s, 92 entries
scanned, 47 errors, 1 warning and 48 violations in text format; that figure is
not a version-boundary result. The repository verdict for a version is owned by
that version's [dev-log](../../../dev-log/) entry and by the baseline commit
message it names
([acceptance.md](../../plan/phase-01-foundation/acceptance.md)). The suite's
before-and-after pair is the same measurement the dev-log records for A5.

### 6.1 Planned cells

Not built. The rows exist because the module's cost is linear in the tree, and
the crossover to "too slow" has never been approached.

| Cell | Tree | Purpose |
|---|---|---|
| C6 | a generated tree of 1,000 markdown files | the first row above the current repository |
| C7 | a generated tree of 10,000 markdown files | one order of magnitude further |
| C8 | a link-heavy tree: every file carrying 50 resolvable links | isolates the `O(L)` filesystem-query term |
| C9 | a tree with files of 1 MiB and more | exposes the `O(B)` memory bound and the whole-file read |
| C10 | a tree with one line of 100,000 unmatched `[` bytes | exercises the quadratic link-scanner case of DOC-02 |
| C11 | a cold lifecycle: no file cache, executable present | separates disk cost from process cost |
| C12 | `build.ps1` from a removed build directory | the build is part of the gate entry point's worst case |

## 7. What has not been measured

The explicit list. Nothing on this page is an established floor, and the
following are not measured at all:

* Any tree larger than 113 entries, and therefore the shape of the curve beyond
  the current repository.
* The link-heavy case: how much of a run the `O(L)` filesystem queries take.
* The large-file case: peak working-set memory, which is `O(B)` by construction
  and is the module's only unbounded resource.
* The pathological link-scanner line described in DOC-02.
* A cold lifecycle: every number above is warm.
* The `build.ps1` wall time from an empty build directory: 4.66 s of compiler
  time and 6.1 s of configure-plus-build were observed on 2026-10-08, but the
  delivered revision has not re-measured it, and the 6.08 s of §6.0 is a
  rebuild after one file changed rather than a build from nothing.
* The worst-case wall time of the gate entry point, which is a build after every
  source file changed. Its two pieces are measured (§6.0) and their sum is not.
* The freshness check's own cost: it enumerates `src/**` and compares
  modification times, and nothing separates that from the 0.33 s to 0.39 s no-op
  figure.
* The composition of the suite's remaining 1.47 s — how much is PowerShell
  start-up, how much is the tool, and how much is the assertion logic.
* A continuous-integration profile. The suite now has about twenty times the
  30-second budget in hand on `M1`, but no second profile has been measured and
  no CI machine has been characterised.
* The share of a single run taken by traversal, by reads, by the rule pass and by
  ordering. Only the total is measured.
* The effect of `--strict` on wall time, which the design says is nil but which
  has not been checked by measurement.
* Peak memory of the decoded-text cache and of the violation vector.
* Any other machine profile, and any non-Windows host. No portability claim is
  made or implied by the numbers above.
* The build's compiler time per translation unit, and whether parallel
  compilation is already saturated.

## 8. Candidate set

Nothing below has been measured against the baseline except where stated. The
candidates are listed so that the first measurement run compares them instead of
accepting the first implementation that works
([ENGINE_STANDARD.md](../../../ENGINE_STANDARD.md) §2.3).

| Candidate | What it changes | Hypothesis to test |
|---|---|---|
| A — the current single process, one traversal, one pass per rule | baseline | — |
| B — call the executable directly instead of launching it through `Start-Process` | the test harness only | the suite's 28.99 s was harness overhead, not tool time. **Adopted**: measured at 1.62 / 1.55 / 1.47 s for the same 61 assertions (§6.0). The hypothesis was confirmed, and by more than the estimate: the cost was one process object per launch, not the number of launches |
| H — skip the build system when no input is newer than the artifact | the build script | the build driver's 4.26 s is paid even when nothing changed. **Adopted**: measured at 349 / 388 / 383 ms with nothing to do, and 6.08 s when an input changes (§6.0). The hypothesis was confirmed; the residual is PowerShell start-up |
| C — stream large files instead of loading them | the memory bound | only files above a size threshold matter; the added complexity is invisible at repository scale |
| D — cache link-target resolution across files | `O(L)` filesystem queries | repeated targets dominate `L` in this repository; the cache must not change the verdict for a target created during the run, which cannot happen because the tree is read-only to the tool |
| E — replace the hand-written link scanner with a single-pass scanner | the quadratic worst case | a one-pass scanner removes DOC-02 without changing any verdict |
| F — parallelise the rule pass across files | wall time on a large tree | the per-file rule pass is embarrassingly parallel and the final sort makes the merge order-independent; the gain is zero until the fixed process cost is negligible |
| G — parallelise the traversal | the traversal cost | directory enumeration is syscall-bound; the expected gain is small except on network storage |

For this module the production requirement is the 30-second gate plus a verdict
that covers the tree, not the smallest possible wall time. A candidate that is
faster because it scans less is not a candidate. Any recorded result names its
candidate, and a losing candidate stays in the record with its measured result.
