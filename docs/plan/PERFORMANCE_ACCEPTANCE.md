# PERFORMANCE_ACCEPTANCE — machine numbers and the measurement workflow

> **Authority.** This document owns the machine profiles, the measurement
> workflow and the admission floors. Performance claims in module documents
> point here instead of restating numbers.
>
> Budgets recorded here are **admission floors, not proof that optimisation is
> finished** ([ENGINE_STANDARD.md](../../ENGINE_STANDARD.md) §4).

## 1. Machine profiles

### 1.1 Profile `M1` — declared development machine

| Property | Value |
|---|---|
| CPU | 11th Gen Intel Core i7-11800H @ 2.30 GHz, 8 physical / 16 logical cores |
| Memory | 31.85 GiB visible |
| Operating system | Windows 11 Home (Chinese), build 26200, 64-bit |
| Repository volume | `E:`, 3526 GB total, 2151.4 GB free at declaration |
| System volume | `C:`, 200 GB total, 40.8 GB free at declaration |
| Interpreter | CPython 3.14.7 (uv-managed, uv 0.12.15) |
| Node runtime | Node.js v24.19.0, pnpm 12.6.0 |
| C++ tooling toolchain | GCC 16.1.0 (w64devkit, portable), CMake 4.4.2 |
| Version control | git 2.55.0.windows.4 |

A measurement made on any other profile is labelled with that profile's name
and may not be compared against `M1` numbers without saying so.

The 40.8 GB free on the system volume is one of the reasons the environment
contract forbids writing any project artifact to `C:`
([AGENTS.md](../../AGENTS.md) §1).

## 2. The 30-second gate

Any single verification command must complete within **30 seconds**. A command
that exceeds it is not "slow but fine":

* it is moved to a managed background job and reported as such;
* its wall time is recorded, with the timeout value that was in effect;
* a gate that only passes by removing the timeout is not a passing gate.

The 30-second gate applies to gates and smoke runs, not to bulk measurement
runs, which are always scheduled explicitly and record their own bounds.

## 3. Measurement workflow

Every measured claim follows this sequence, and the record keeps every step:

1. **Declare the profile.** `M1` or a named alternative.
2. **Declare the lifecycle.** Cold, warm or reused — and what "reused" means
   for this measurement (page cache, bytecode cache, connection pool).
3. **Declare the unit.** Operations per second, or bytes, or C/K/Q percentiles.
   A percentage without its denominator is not evidence.
4. **Declare the worker count** and any concurrency limit.
5. **Declare the included and excluded stages.** A sub-stage may never stand in
   for the whole-flow gate.
6. **Measure the scale matrix** crossing the expected crossover point: below
   it, near it, above it, plus a high, stress and configured-maximum row.
7. **Report the distribution**, not a single number; include resource metrics.
8. **State the noise policy** and the regression baseline before running.
9. **Keep the loser.** A candidate that lost stays in the record with its
   result.
10. **Audit before dismissing.** A candidate that lost against a naive baseline
    is re-checked for logic errors, runtime errors, resource contention,
    multi-worker conflicts and sample size — in that order — before the result
    is accepted as a real loss.

## 4. Budget discipline

* An over-budget run is executed anyway and kept as failure evidence.
* A frontier gate names its oracle, the invariants that must not regress, the
  serious candidate set, the reasoned exclusions and the fallback.
* Every frontier claim needs a microbenchmark **and at least one end-to-end
  workload on a real consumer**.
* Defaults that are known to be dominated may not ship.
* An unresolved performance gap must name the version that will close it.
  Difficulty is not evidence that a gap may be closed.

## 5. Admission floors

Measured on profile `M1`, warm, with the commands and raw output recorded in
[dev-log/v0.1.0.md](../../dev-log/v0.1.0.md) and
[dev-log/v0.1.0fix1.md](../../dev-log/v0.1.0fix1.md). A floor is set at roughly
twice the measured value so that ordinary jitter does not fail the gate, and the
measured value is kept beside it so the margin is visible.

| Surface | Command | Measured | Floor | Status |
|---|---|---|---|---|
| Routine verification, every default gate | `scripts/verify.ps1` | 4.8 s of gate time, 5.3 s wall, 7 gates | 15 s | Validated (v0.1.0fix1) |
| Version-boundary verification, every gate | `scripts/verify.ps1 -Full` | 18.1 s, 9 gates | 60 s | Validated (v0.1.0fix1) |
| Isolation, static phase | `scripts/verify-temp-isolation.ps1 -StaticOnly` | 1.0–1.5 s, 21 checks | 10 s | Validated (v0.1.0) |
| Isolation, full | `scripts/verify-temp-isolation.ps1` | 11.1 / 12.4 s across two runs at v0.1.0fix1 (22 checks, 78,682 files scanned), deterministic. Earlier revisions measured 12.7 / 12.8 / 12.9 s; the removed earned-exclusion path reached 25 s and produced a false failure. | 29 s against the run minimum; the spread is why a single run is not a measurement | Validated (v0.1.0fix1) |
| Gate self-tests | `tools/documentation/tests/run-tests.ps1` | 1.1–1.3 s, 61 assertions across 17 fixture trees. Was 28.3 s before the direct-invocation rewrite; 27 launches through `Start-Process` cost 1033 ms each against a 63 ms validator run. | 6 s | Validated (v0.1.0fix1) |
| C++ tool build, no input changed | `tools/documentation/build.ps1 -Quiet` | 0.30 s with the freshness check; 4.4 s before it existed | 5 s | Validated (v0.1.0fix1) |
| Cold-clone bootstrap | `git clone . <dir>`, then `scripts/bootstrap.ps1` in the clone | 522.6 s: 21.7 MiB interpreter download plus `uv sync` | 900 s | Validated (v0.1.0) |
| Clone conformance gate, tool built from scratch | `tools/documentation/validate-documentation.ps1` in the clone | 0 violations over 110 entries; configure 3.4 s, build 3.81 s | 30 s once built | Validated (v0.1.0) |
| Environment bootstrap, warm | `scripts/bootstrap.ps1` | 1.8–2.8 s | 10 s | Validated (v0.1.0) |
| Documentation gate, current tree | `tools/documentation/validate-documentation.ps1` | 0.35–0.6 s through the wrapper, 55–70 ms for `docguard.exe` itself, at about 116 scanned entries | none yet | Unvalidated at target tree size |
| Python test suite | `uv run pytest -q` | 0.7 s wall; pytest reports 0.03 s internal for 14 tests | 5 s | Validated (v0.1.0) |
| Python lint | `uv run ruff check` | 0.34–0.45 s | 5 s | Validated (v0.1.0) |
| uv command overhead, warm | `uv run python -c pass` | 335–438 ms; 92–99 ms with `--no-sync` | none: overhead, not a target | Validated (v0.1.0) |
| C++ from-scratch build of the gate | `tools/documentation/build.ps1` on an empty build directory | 6.1 s wall, 4.66 s in the compiler link step | 30 s | Validated (v0.1.0) |
| World step, sparse, 4,000 live cells | `uv run pytest -m benchmark -s tests/world/test_benchmark.py` | 1.359 ms per generation | none yet: this is a frontier, not an admission floor | Validated (v0.2.0) |
| World step, sparse, 260,000 live cells | the same command | 101–138 ms per generation across two runs, 0.31–0.53 microseconds per live cell | none yet | Validated (v0.2.0) |
| World step, dense reference, any population at 1024 x 1024 | the same command | 12.6–14.3 ms per generation, flat in the population | none yet | Validated (v0.2.0) |
| Viewer frame, 1024 x 1024 sparse viewport | recorded in [dev-log/v0.2.0.md](../../dev-log/v0.2.0.md) | see the viewer's own measurement | none yet | see the version entry |

### 5.1 Closed in v0.1.0fix1

`tools/documentation/tests/run-tests.ps1` used to measure **29 s**, sitting on
the 30-second boundary of §2, and was carried as an unresolved item. The cause
was not the validator, which runs in 63 ms, but 27 launches through
`Start-Process` with redirected standard streams, at 1033 ms each. The fix was
mechanical and the gate now measures 1.1–1.3 s; the open item is closed, and
the measurement that closed it is in
[dev-log/v0.1.0fix1.md](../../dev-log/v0.1.0fix1.md).

### 5.2 Open performance gap carried by v0.2.0

The design target is a world of 65536 x 65536, which is 4.29e9 cells. The
representation chosen for it stores only live cells, so the world **fits**; it
does not yet **run** at the densities that size implies.

| Live cells | Sparse, ms per generation | Dense reference, ms per generation |
|---|---|---|
| 400 | 0.181 | 13.643 |
| 4,000 | 1.359 | 13.931 |
| 40,000 | 15.361 | 14.313 |
| 200,000 | 106.493 | 14.327 |
| 260,000 | 138.171 | 13.224 |

Measured on profile `M1` at 1024 x 1024, on a still life of blocks so that the
population does not drift, best of one warm-up plus five timed generations, with
the run recording `min` and `median` rather than a single number.

Two runs of the same ladder are on record and they do not agree above 4,000 live
cells: the second measured 12.879 ms at 40,000 and 101.020 ms at 260,000 where
the first measured 15.361 ms and 138.171 ms, while the 400-cell row is identical
at 0.181 ms in both. The per-cell constant is therefore **0.31 to 0.53
microseconds**, not a single figure, and the spread is machine load rather than
a difference in the code. Only what both runs share is used below.

The crossover is at about **40,000 live cells** — four percent of that world —
because the sparse step costs hundreds of nanoseconds per live cell: it builds
eight neighbour arrays and then sorts and counts nine times the live population.
The theoretical one-in-nine crossover does not apply, because the sparse
constant factor is several times larger than the shape of the algorithm
suggests. One percent of the target world is 43 million live cells, which those
constants put at **17 to 23 seconds per generation**, stated as a projection and
not as a measurement: the ladder has never been run above 1024 x 1024.

### 5.2 Closed for clustered populations, open for the default

The gap that `v0.2.0` recorded — the world fits the target scale but cannot run
it — is now closed **for a clustered population** by the tiled bit-parallel
representation, and remains open in a different form: nothing chooses between
the two representations yet.

Same profile, same world, same still-life lattice, one warm-up plus five timed
generations, with the tile count beside the time:

| Live cells | Sparse | Dense reference | Tiled | Tiles |
|---|---|---|---|---|
| 400 | 0.175 ms | 12.930 ms | 0.303 ms | 1 |
| 4,000 | 1.371 ms | 13.125 ms | **0.330 ms** | 4 |
| 40,000 | 13.931 ms | 13.397 ms | **0.537 ms** | 49 |
| 200,000 | 84.061 ms | 14.224 ms | **1.955 ms** | 196 |
| 260,000 | 119.341 ms | 13.565 ms | **2.175 ms** | 256 |

and with the same blocks spread one per tile:

| Live cells | Sparse | Dense reference | Tiled | Tiles |
|---|---|---|---|---|
| 400 | **0.175 ms** | 13.430 ms | 0.652 ms | 32 |
| 4,000 | **1.402 ms** | 13.234 ms | 2.003 ms | 256 |
| 4,096 | **1.430 ms** | 13.296 ms | 1.984 ms | 256 |

The tiled step costs a constant per active tile and the sparse step costs a
constant per live cell, so the two cross at about **4,000 live cells in the
clustered shape**, and in the scattered shape the sparse world wins throughout
because every isolated tile pays for eight neighbours that hold nothing.

Projected to the target scale, and labelled a projection because the ladder has
never been run there. **The projection has two halves and the difference between
them is two orders of magnitude, so neither half is quoted alone.**

| One percent of 65536 x 65536, 43 million live cells | Active tiles | Projected tiled | Sparse for the same population |
|---|---|---|---|
| packed together, about 4,096 cells per tile | about 10,500 | **0.08 to 0.09 s per generation** | 17 to 23 s |
| spread evenly, about 41 cells per tile | about 1,048,576 | **7.8 to 8.9 s per generation** | 17 to 23 s |

The tiled advantage comes from **spatial compactness, not from the size of the
population**: the step costs a constant per active tile, so a hundredfold more
tiles costs a hundredfold more time. Against the sparse step it is about two
hundred times faster when the population is packed and about twice as fast when
it is spread. The scalability gap is closed for the shape that matters, and the
arithmetic says which shape that is.

**What remains open**, and is owned by the version naming phase 02 milestone 02:
the default is `sparse`, which is the wrong choice for a clustered population,
and no rule picks one from the other. The measurement above is the input that
rule needs. Querying pulls the other way — at 260,000 live cells a `state`
request costs 9.41 ms tiled against 1.27 ms sparse, and a 1024 x 1024 frame
12.00 ms against 3.75 ms — so a selection rule has to weigh both.

### 5.3 Not measured

* `docguard` on a repository of the target size. The measured figures are for a
  tree of about 116 scanned entries and must not be extrapolated.
* Any world size above 1024 x 1024. The ladder is one world, one profile and one
  lifecycle; the target scale itself has not been stepped under measurement.
* Repeated cold-clone runs. One run is recorded; the 522.6 s figure is
  dominated by a single network download and is not a stable measurement of
  anything but the network.
* The viewer's frame cost at a dense viewport, and its behaviour when the
  browser cannot keep up with the tick rate.
