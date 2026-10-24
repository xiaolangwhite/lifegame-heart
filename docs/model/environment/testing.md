# environment — testing

> **Owner.** This file owns what is tested, what is deliberately not tested,
> how to run the checks, the fixture layout, the failure modes the checks cover,
> the command that produced the last recorded result and the record of defects
> found and fixed inside this version. The interface and its exit codes are
> owned by [interfaces.md](interfaces.md); evidence ownership by
> [acceptance.md](../../plan/phase-01-foundation/acceptance.md).

Status: Implemented

## 1. Test surface

The module has no unit-test project of its own. A Python-side contract test
exists and is part of the `dev` dependency group, and every gate is run by one
aggregate entry point, [scripts/verify.ps1](../../../scripts/verify.ps1)
([interfaces.md](interfaces.md) §3.6). The module's test surface is therefore:

| Surface | What acts as the test |
|---|---|
| `path-contract` | The guard and the variable table inside [scripts/env.ps1](../../../scripts/env.ps1), exercised by every run of the other three scripts and by `uv run pytest` |
| `env-bootstrap` (provisioning) | The command itself, run repeatedly and once on a cold clone: [scripts/bootstrap.ps1](../../../scripts/bootstrap.ps1) ends with the static check as its own step 6 |
| `env-bootstrap` (entry point) | [scripts/verify.ps1](../../../scripts/verify.ps1), which is what runs every surface in this table and is itself observed by its per-gate table and its exit code |
| `temp-isolation` (static) | The 21 named checks of the static phase |
| `temp-isolation` (dynamic) | Five real workload steps plus one time-filtered scan of the watched locations, and a per-path shape test on the result |
| Python-side contract | `tests/environment/test_isolation_contract.py`, which asserts the same ten guarded variable names from inside the virtual environment and checks that `sys.executable`, `sys.base_prefix` and `tempfile.gettempdir()` resolve inside the repository |

The Python-side contract is what makes the guard list testable from two vantage
points: the PowerShell check reads the process environment from outside, and the
pytest module reads it from inside the interpreter the toolchain actually uses.

## 2. How to run

| Purpose | Command | Expected exit code |
|---|---|---|
| Every gate, edit-loop set | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify.ps1` | `0`; 7 gates, about 5 s |
| Every gate including the version-boundary pair | the same command with `-Full` | `0`; 9 gates, about 20 s |
| Resolved locations only | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-temp-isolation.ps1 -StaticOnly` | `0` when every check passes |
| Full proof | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-temp-isolation.ps1` | `0` when every check passes |
| Full proof without Node | the same command with `-SkipNode` | `0` when every executed check passes |
| Provision, then self-check | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/bootstrap.ps1` | `0` on success |
| Provision again, to test idempotency | the same command twice | `0` both times, second run performs no download |
| Provision a clean clone, then check it | `git clone . <dir>`, then the two commands above inside the clone | `0` in the clone, with every resolved path inside the clone |
| Python-side contract | `uv run pytest -q` | `0`; 14 tests |
| Node-only surface | `pnpm install` in the repository root | `0`; store and cache resolve inside the repository |
| Alias form | `npm run env:verify` | the same as the full proof |

The entry point sources [scripts/env.ps1](../../../scripts/env.ps1) itself, so
the session preamble is not required in order to run it. The individual commands
above still require it, and so does any other toolchain command
([AGENTS.md](../../../AGENTS.md) §1).

## 3. What the static phase checks

The static phase emits 21 checks; the exact names are in
[interfaces.md](interfaces.md) §4.2.

| Family | Checks | Failure mode it catches |
|---|---|---|
| Guarded variables | `env:LIFEGAME_ROOT`, `env:TEMP`, `env:TMP`, `env:TMPDIR`, `env:UV_CACHE_DIR`, `env:UV_PYTHON_INSTALL_DIR`, `env:PIP_CACHE_DIR`, `env:PIP_CONFIG_FILE`, `env:PYTHONPYCACHEPREFIX`, `env:npm_config_cache` | A published location that points outside the repository, is empty or whitespace-only, or is the literal answer a tool gives for a key it does not know |
| Interpreter binding | `venv interpreter home` | A virtual environment bound to a system-wide interpreter instead of the in-repository payload, or a `pyvenv.cfg` that was decoded with the wrong encoding |
| Tool-resolved locations | `uv cache dir`, `uv python dir` | A tool that resolves its own directory from its defaults rather than from the configuration |
| Python's own view | `python tempfile.gettempdir()`, `python sys.base_prefix`, `python sys.executable` | A Python process that would write temporary files or bind to an interpreter outside the repository |
| Declared cache paths | `pnpm storeDir (declared)`, `pnpm cacheDir (declared)`, `uv.toml cache-dir (declared)` | A declaration that is absolute, and therefore bound to one checkout: a clone or worktree would write into the checkout the declaration names |
| Resolved cache paths | `npm cache (from env)`, `pnpm store path (resolved)` | A tool that resolves its cache or store from a user-level configuration, from a file the current version of the tool no longer reads, or from another checkout |

The declared and resolved families are both present because either one alone is
insufficient. A declared-only check is satisfied by a value the tool never reads
(the false-positive shape of §6 row 7); a resolved-only check cannot tell that a
correct-looking absolute path belongs to a **different** checkout, which is
exactly what the cold-clone run observed (§5.4).

## 4. Failure modes covered

| Failure mode | Covered by | Failure is visible as |
|---|---|---|
| A published variable points outside the repository | Static phase, guarded-variable checks | `[FAIL]` line plus exit code `1` |
| A published variable is empty or is a tool's "unknown key" answer | Static phase, guarded-variable checks, through the inside-repository predicate | `[FAIL]` line plus exit code `1` |
| The interpreter payload was resolved outside the repository | `venv interpreter home`, `uv python dir`, `python sys.base_prefix` | `[FAIL]` lines plus exit code `1` |
| A tool ignores the project configuration and falls back to a user-level location | `uv cache dir`, `npm cache (from env)`, `pnpm store path (resolved)` | `[FAIL]` line plus exit code `1` |
| A committed cache declaration is bound to one checkout | The declared-cache-path checks | `[FAIL]` line plus exit code `1` |
| A copy of the repository resolves a cache into another checkout | `pnpm store path (resolved)` and the declared checks, run inside the copy | `[FAIL]` lines pointing at the other checkout, plus exit code `1` |
| Bytecode compilation writes outside the repository | Dynamic phase `python: bytecode compilation` plus the scan | An unexplained entry plus exit code `1` |
| A build intermediate lands outside the repository | Dynamic phase `cpp: build documentation tool` plus the scan | An unexplained entry plus exit code `1` |
| A package manager writes a store, cache or temporary file outside the repository | Dynamic phase `node: pnpm install` plus the scan | An unexplained entry plus exit code `1` |
| A native tool's warning is mistaken for a check failure | Every native call, in all four scripts, goes through a helper that drops stderr or redirects it to `Out-Host`, and the exit code is recorded separately | No `[warn]`-free run turning into exit code `2`; the observed repairs are §6 rows 7 and 9 |
| A non-project process writes a file of a shape the check does not characterise into a watched location during the window | The dynamic phase's per-path shape test reports it as a violation | An unexplained entry plus exit code `1`, even though no project tool wrote the file. This is the residue recorded as [risks.md](risks.md) ENV-04 and observed in §5.6 |
| A gate is run without the environment contract in force | The entry point dot-sources [scripts/env.ps1](../../../scripts/env.ps1) before the first gate | If it could not source, exit code `2` with no gate result claimed; the individual scripts still require the session preamble |
| A gate fails or a gate could not run, and the run reports success | The entry point records each gate's own exit code in a table and exits `1` if any is non-zero, `2` for that gate when it threw | The summary names the failing gates with their exit codes |
| The entry point is started from outside the repository root | The working directory is not changed, so the `python tests` gate can fail for a reason unrelated to the change | `python tests` exit code `5` and a failing run; observed in §5.6 and recorded as [risks.md](risks.md) ENV-08 |
| The check aborts before it can decide | The top-level `trap` | Exit code `2`, distinct from `1`; the observed repair is §6 row 2 |
| Provisioning is not reproducible | `bootstrap.ps1` run twice | A download or a changed state on the second run |
| Provisioning fails on a checkout that has nothing installed yet | `bootstrap.ps1` on a cold clone | A step failing before it installs anything; the observed defect is §6 row 9 |
| A workload step fails | The step is reported as `[warn]`; the scan still decides | A warning line, and the exit code of the check |

## 5. The last recorded results

The evidence owner for the acceptance criteria that name this module is the
version dev-log entry named in
[acceptance.md](../../plan/phase-01-foundation/acceptance.md). What follows is
the evidence behind the current revision, kept because a failed run and a
passing run are both evidence
([AI_DOCUMENTATION_GUIDE.md](../../AI_DOCUMENTATION_GUIDE.md) §2); the
version-boundary record for the criteria that name this module is
[dev-log/v0.1.0.md](../../../dev-log/v0.1.0.md).

### 5.1 The recorded failure, and its re-verification

An earlier revision of [scripts/verify-temp-isolation.ps1](../../../scripts/verify-temp-isolation.ps1)
aborted during the static phase. On 2026-10-08 the command

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-temp-isolation.ps1 -StaticOnly
```

printed eight `[OK  ]` lines (`env:TEMP` through `env:npm_config_cache`), then
terminated with

```
Cannot overwrite variable HOME because it is read-only or constant.
```

and process exit code `1` after 426 milliseconds. The checks from
`venv interpreter home` onward never ran, and no `- <check name> :: <detail>`
failure line was printed. The cause was that the script assigned to `$home`,
which is the read-only automatic variable `$HOME` because PowerShell variable
names are case-insensitive; [scripts/bootstrap.ps1](../../../scripts/bootstrap.ps1)
step 6 therefore could not pass either. **That failure record is kept above
verbatim, and it is no longer the current state: the defect is §6 row 1, and it
has been fixed and re-verified.**

The re-verification of the repaired revision is the command

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-temp-isolation.ps1
```

Run on profile `M1` with the session preamble applied, the current revision
produces **22 checks, 0 failures, exit code `0`**, with the lines

```
static phase: 21 checks, 0 failures
PASS
dynamic phase: scanned 78687 file(s); 0 changed since the workload started, 0 excused, 0 unexplained
total: 22 checks, 0 failures
```

The `-StaticOnly` form produces 21 checks, 0 failures, exit code `0`. Wall times
observed on 2026-10-10: 12.4 s and 10.2 s standalone, and 11.0 s and 11.9 s when
the entry point ran it under `-Full`. Runs of an earlier revision of the same
command were recorded at 13.1 s, 14.8 s, 16.2 s and 18.8 s. The timings and
their reproduction commands are in [performance.md](performance.md) §7.

The scan count moves with the machine's temporary-directory population rather
than with the repository: 78,505 on 2026-10-08 and 78,685 to 78,687 on
2026-10-10, under the same depth bounds.

### 5.2 The environmental-class exclusion, as observed

The exclusion no longer has a proof step, so there is no per-run branch left to
observe. What is observed now is the shape test and the evidence behind it:

* the class, its three structural conditions and the evidence that it is not
  this project's are recorded once in
  [evidence/windows-temporary-artifact-class.md](../../../evidence/windows-temporary-artifact-class.md);
* a run prints every path it excused, under
  `excused as the characterised environmental class: <n> file(s)`, followed by
  the paths themselves, so a reader can always see what a run ignored;
* the runs recorded in §5.5 and [performance.md](performance.md) §7 excused
  either nothing or one to two files of the class, and reported zero
  unexplained changes.

The design that this replaced had two observable branches, and both are kept as
failure evidence rather than deleted:

```
history control: 18 instance(s) of the class predate the repository (2026-10-08 12:32:16Z)
exclusion earned: ... independent of this repository (18 instances predate it)
```

```
idle control: nothing appeared while idle
```

The first was the history branch, observed on 2026-10-08 and depending on
machine files that an operating-system cleanup can remove. The second is the
observation branch, and on 2026-10-10 the combination of a cleaned temporary
directory and a quiet idle window left the exclusion unearned, so a file that
no project tool had written was reported as a violation: exit code `1` and
25 s on a tree that had not changed between runs. That failure is §6 row 11 and
is why the mechanism is now a characterised class.

### 5.3 The Python-side contract

```powershell
uv run pytest -q
```

Observed: `14 passed in 0.03s`, exit code `0`. The wall time of the command was
804 ms including `uv`'s own overhead and a 254 ms bytecode compile; the 0.03 s
figure is pytest's own and excludes that overhead.

### 5.4 The cold-clone check

The acceptance criterion that names this check is A11 in
[acceptance.md](../../plan/phase-01-foundation/acceptance.md): a clean `git
clone` must provision itself with one command, and the conformance gate must
pass inside the clone with a tool built from scratch there. Run on 2026-10-08 on
profile `M1`:

| Step | Command | Observed | Exit |
|---|---|---|---|
| Clone | `git clone . TEMP/clone-check` | a clone with no `.venv`, no `.cache` and no C++ build directory | `0` |
| Cold provisioning | `scripts/bootstrap.ps1` inside the clone | 522.6 s, dominated by a 21.7 MiB CPython 3.14.7 download and `uv sync` | `0` |
| Second provisioning | the same command again | 2.1 s, no download | `0` |
| Isolation, static | `scripts/verify-temp-isolation.ps1 -StaticOnly` inside the clone | 21 checks, 0 failures, every resolved path inside **the clone** | `0` |
| Conformance gate | `tools/documentation/validate-documentation.ps1` inside the clone | 0 violations over 110 entries; `docguard` configured in 3.4 s and built in 3.81 s from scratch | `0` |

### 5.5 The aggregate entry point, as observed

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify.ps1
```

Observed on profile `M1` on 2026-10-10, with no session preamble applied,
because the script sources the contract itself:

| Gate | Exit | Time |
|---|---|---|
| documentation conformance | `0` | 415 ms |
| gate self-tests | `0` | 1218 ms |
| tool build (incremental) | `0` | 323 ms |
| isolation (static) | `0` | 1343 ms |
| python tests | `0` | 664 ms |
| python lint | `0` | 329 ms |
| node install | `0` | 76 ms |
| **total** | **`0`** | **4.4 s of gate time, 4.8 s wall** |

`-Full` adds two gates and was observed at 18.6 s, 19.7 s and 20.8 s wall on
three passing runs, with the added gates costing 11.0–11.9 s (isolation full)
and 2.9–3.0 s (bootstrap idempotence). The gate self-test time is the visible
effect of a tool-side change: the fixture suite costs 1.2–1.5 s now, where the
`documentation` module recorded 28.3 s before its per-case process launches were
replaced by direct calls.

### 5.6 The observed failures of the current revision

Two failures were observed against the revision documented here. Neither is
reproducible on demand, and both are kept because a failed run is evidence.

**A full isolation gate failed once inside the entry point.** One
`scripts/verify.ps1 -Full` run reported

```
[verify] 1 of 9 gate(s) failed in 19.3 s
  - isolation (full, version-boundary) (exit 1)
```

Four later `-Full` runs (18.6 s, 19.7 s, 20.8 s and one untimed) and two
standalone full isolation runs (10.2 s, 12.4 s) all exited `0`. The failing
run's output was truncated before the violating path was printed, so the path
was not captured and the cause is not proven. What is proven is the coverage
gap that makes such a failure possible:

* the harness exclusion pattern is `\\dsh-[0-9a-zA-Z]{6,}\\`, which requires an
  alphanumeric run after `dsh-` and therefore stops at a second hyphen;
* a directory listing taken after the runs found **46** `dsh-` directories in
  the system temporary directory — `dsh-workspace-changes-*` (20),
  `dsh-subprocess-*` (11), `dsh-acl-*` (5), `dsh-spill-*` (4), `dsh-im-*` and
  four bare `dsh-<id>` — and **none** of them matched the pattern as a directory
  path;
* third-party applications write into the same shared directory: two
  `WeTypeVoiceDiagnostic_*.log` files were created there during the same
  session, and their shape is not the excused one either.

Either source produces the same outcome: a changed path that is not this
project's, reported as a violation. The pattern and the fix are
[risks.md](risks.md) ENV-04; the run is [performance.md](performance.md) §7
row 16.

**The entry point fails when it is started from a subdirectory.** Run from
`docs/`, the same command with `-SkipNode` reported

```
python tests              False    5 1098
[verify] 1 of 6 gate(s) failed in 5.7 s
  - python tests (exit 5)
```

Exit code `5` is pytest's "no tests ran". The cache and temporary locations were
unaffected — no `.cache` or `TEMP` directory appeared under `docs/`, because
`env.ps1` exports those as absolute paths that win over the relative
declarations — so the residue is confined to the gates that depend on the
working directory. The recorded observation is [performance.md](performance.md)
§7 row 15 and the risk is [risks.md](risks.md) ENV-08.

## 6. Defects found and fixed inside this version

These defects were found **after** the module was first documented as
implemented, and each was repaired in the source on disk. They are recorded
here because a defect that was found and fixed is evidence, and because deleting
the record would make the same class of mistake available again. None of them is
an open risk; the open risks are in [risks.md](risks.md).

| # | Defect | How it was found | Fix | How the fix was verified |
|---|---|---|---|---|
| 1 | `verify-temp-isolation.ps1` assigned the interpreter-home value to `$home`, which is the read-only automatic variable `$HOME` under PowerShell's case-insensitive name lookup. The static phase aborted after eight checks with exit code `1`, and bootstrap step 6 could never pass. | The static phase was run and the run was kept as failure evidence (§5.1). | The local variable was renamed to `$interpreterHome`; the same change introduced the explicit UTF-8 read of `pyvenv.cfg` (row 5). | `-StaticOnly` now reports 21 checks, 0 failures, exit code `0`; the full run reports 22 checks, 0 failures. Command in §5.1. |
| 2 | The script header documented exit code `2` for "could not complete its checks", but no code path emitted it, so an unexpected terminating error surfaced as the violation code `1`. | Reading the script against its own header during the repair work; the defect was already recorded as a risk before the fix. | A top-level `trap` was installed before any work begins; it prints the message and the script stack trace, then exits `2`. | The trap is placed before the static phase, so any abort after it takes the `2` path; the exit-code table in [interfaces.md](interfaces.md) §4.5 and the failure row in [responsibilities.md](responsibilities.md) §3.3 were updated in the same change. A deliberate triggering run is still a missing negative fixture (§8). |
| 3 | The guard in `env.ps1` ran **after** the loop that created directories and set variables, so a checkout hosted on the system volume had directories created on that volume before the refusal fired. | Reading the script's own control flow: the `foreach` over `$directoryVars` preceded the guard loop. | All ten values are now computed into one ordered table, validated in a guard loop, and only then applied. The pip-configuration existence test moved into the same guard loop. | `env.ps1` is now side-effect free on refusal by construction; the flow is stated in [data-flow.md](data-flow.md) §3.1 and the complexity split in [implementation.md](implementation.md) §3.1. |
| 4 | Published variables were outside the guard list: `npm_config_tmp`, `LIFEGAME_ROOT` and `PIP_CONFIG_FILE`. | Comparing the published variables against the guard loop and against acceptance criterion A3. | `LIFEGAME_ROOT` and `PIP_CONFIG_FILE` were added to the guard; `npm_config_tmp` was removed from the script, from `.npmrc` and from the published surface, because npm 11 rejects the key and the location is already decided by `TEMP`/`TMP` (see row 6). The guard list is now exactly the ten published variables. | `-StaticOnly` reports ten `env:` checks, including `env:LIFEGAME_ROOT` and `env:PIP_CONFIG_FILE`; `tests/environment/test_isolation_contract.py` asserts the same ten names, and `uv run pytest -q` passes 14 tests. |
| 5 | `pyvenv.cfg` was read with PowerShell's default text decoder, which is ANSI on PowerShell 5.1. The repository path contains non-ASCII characters, so the recorded `home` value came back corrupted and a correct interpreter binding failed the check. | The `venv interpreter home` check was compared against the file's actual bytes and against `Select-String` output. | The file is read with `[System.IO.File]::ReadAllText` and an explicit UTF-8 encoding object without a byte-order mark. | `venv interpreter home` reports the in-repository payload path as `OK`; the check is in the static-phase list of [interfaces.md](interfaces.md) §4.2 and passes in every recorded run. |
| 6 | `.npmrc` declared `store-dir` and `cache-dir`, which pnpm 12 ignores: pnpm 10 moved package-manager settings to `pnpm-workspace.yaml`, and the store was landing outside the repository. | `pnpm store path` was run directly and printed a path outside the repository while both `.npmrc` keys read back as written. | `storeDir` and `cacheDir` were declared in `pnpm-workspace.yaml`; `.npmrc` kept only the keys npm still honours at that point (every setting was later removed; see row 10); the `tmp` key was dropped with `npm_config_tmp` (row 4); a `pnpm store path (resolved)` check was added so the *resolved* store is observed, not just the declared key. | `pnpm store path` now prints the in-repository store path, and the check reports `OK` for `pnpm storeDir (declared)`, `pnpm cacheDir (declared)` and `pnpm store path (resolved)`. The observed values are in [interfaces.md](interfaces.md) §4.2. |
| 7 | The inside-repository predicate accepted any string that resolved inside the repository after `GetFullPath`, so a tool answering `undefined` for a key it does not know passed a check that verified nothing. Additionally, native tools' stderr was reaching the checker: under `$ErrorActionPreference = 'Stop'`, one npm or pnpm warning line became a terminating error and the run reported "could not complete" for a healthy environment. | Both were observed while adding the `pnpm store path` and `pnpm config get` probes: the probes answered with non-path literals, and package-manager warnings aborted runs. | The predicate now requires an absolute path or a UNC path and rejects the literals `undefined`, `null`, `true`, `false` and `nan`; every external command goes through a quiet-invocation helper that switches the preference to `Continue`, discards stderr and records the exit code separately. | The ten `env:` checks and all tool probes report `OK` on a healthy environment, and the run reaches its own pass/fail decision instead of aborting. The predicate is stated in [interfaces.md](interfaces.md) §4.2. |
| 8 | The dynamic phase took two full snapshots — one before and one after the workload — and diffed them, which cost a second traversal plus a full path-to-timestamp map of the watched roots. | The algorithm's cost was analysed against the 30-second gate of [PERFORMANCE_ACCEPTANCE.md](../../plan/PERFORMANCE_ACCEPTANCE.md) §2 while the dynamic phase was being made to fit it. | Replaced by a single scan filtered by the workload start instant: creation and modification both leave a modification time at or after that instant, so one traversal detects both events. The excluded shape is tested per changed path against the characterised class (row 11). | The full run reports 22 checks, 0 failures and scans 78,685–78,687 files; the recorded wall times are 10.2 s and 12.4 s standalone and 11.0–11.9 s inside the entry point, all inside the 30-second gate. See [performance.md](performance.md) §7. |
| 9 | `bootstrap.ps1` could not provision a clean checkout at all. `uv python find 3.14` writes `No interpreter found ...` to stderr when no interpreter exists, and under `$ErrorActionPreference = 'Stop'` PowerShell 5.1 turns a native stderr line into a terminating error, so the script aborted in its install step before installing anything. Every warm run passed, because the probe succeeds there and prints nothing to stderr. | The first cold-clone run — the only run that exercises the state in which the probe fails (§5.4). The run was kept as failure evidence in [dev-log/v0.1.0.md](../../../dev-log/v0.1.0.md). | Every external command now goes through one of two helpers. `Invoke-NativeStream` pipes the tool's output to the console with `Out-Host` so the function returns only the exit code; `Invoke-NativeCapture` takes the first stdout line, drops stderr and records the exit code separately. `Invoke-Step` now requires its body to return an exit code and throws on a non-zero value. | The cold clone provisioned itself with `bootstrap.ps1`, exit code `0` in 522.6 s, and a second run completed in 2.1 s with no download (§5.4). |
| 10 | Every declared cache path was **absolute**, so it named the primary checkout. A `git clone` or a `git worktree` therefore wrote its caches into the original checkout while each copy reported itself isolated — and this repository's agent environment creates a worktree per task, so the copies are real. | The first cold-clone run: the static phase inside the clone reported three `[FAIL]` lines — `pnpm storeDir`, `pnpm cacheDir` and `pnpm store path (resolved)`, the names in use at the time; the first two are now `pnpm storeDir (declared)` and `pnpm cacheDir (declared)` — all resolving into the primary checkout. It was the first time the check caught a real defect. | Every declared path became repository-relative: `cache-dir` in [uv.toml](../../../uv.toml), `storeDir`/`cacheDir` in [pnpm-workspace.yaml](../../../pnpm-workspace.yaml), `cache-dir` in [scripts/pip.ini](../../../scripts/pip.ini). `.npmrc` was reduced to comments only, because npm resolves a relative value against the working directory and an absolute one binds a single checkout; the npm cache is now owned solely by `npm_config_cache` from [scripts/env.ps1](../../../scripts/env.ps1). The `Test-RepoRelative` predicate and the three declared-value checks were added, and the static phase grew from 20 to 21 checks. The decision is [ADR 0004](../../adr/governance-and-build/0004-cache-locations-are-checkout-relative.md), which supersedes the absolute-path clause of ADR 0002. | Inside the clone, `pnpm store path` resolves to `<clone>\.cache/pnpm-store\v11`; the declared `storeDir` reads back as `.cache/pnpm-store`; `-StaticOnly` reports 21 checks, 0 failures in the clone and in the primary checkout, and the full run reports 22 checks, 0 failures (§5.1, §5.4). |

| 11 | The environmental-artifact exclusion had to be **re-earned on every run**: at least five instances of the class older than the repository, or an observation window in which only the class appeared. A proof that must be reproduced per run failed for reasons unrelated to the claim: an operating-system cleanup of the temporary directory removed the historical instances, the idle window was quiet, and the check reported a file that no project tool had written as a violation — exit code `1` and 25 s on a tree that had not changed between runs, against a normal 11–12 s. | A full isolation run on 2026-10-10 returned exit code `1` on an unchanged tree; the run was kept as failure evidence, and the machine state was inspected afterwards (temporary-directory history and a controlled idle window). | The class is characterised **once**, with its evidence recorded in [evidence/windows-temporary-artifact-class.md](../../../evidence/windows-temporary-artifact-class.md), and the run applies a per-path shape test to the scan's result: zero length, whole name a GUID, `.tmp` extension, directly in the system temporary directory. Every excused path is printed, the switch-gated wrapper was deleted so only the shape test remains, and a file in a cache, build, bytecode or package location is never excused. | Two standalone full runs and four `-Full` runs report 22 checks, 0 failures, exit code `0`, with `0 changed / 0 excused` or `1 changed / 1 excused / 0 unexplained`, in 10.2–12.4 s — the recorded runs are [performance.md](performance.md) §7 rows 2 and 14. Determinism is restored: two runs over the same tree agree. |

The three defects most worth keeping in mind are rows 7, 10 and 11, and they are
one lesson in three forms. Row 7 was a check that passed while verifying
nothing, because it read only the resolved location. Row 10 was a resolved
location that was absolute and *correct-looking* while belonging to the wrong
checkout. Row 11 was a check that failed while verifying nothing, because its
exclusion depended on machine state that is not part of the claim. A check is
only evidence while its verdict follows from the thing it claims to measure.

## 7. Fixture layout

The module defines no fixture files. Its inputs are the repository itself and
the host profile:

| Input | Role |
|---|---|
| `.venv\pyvenv.cfg` | read by the `venv interpreter home` check; must be decoded as UTF-8 |
| [uv.toml](../../../uv.toml) | read as text by the `uv.toml cache-dir (declared)` check; a declaration that the tool ignores is not observable through `uv` itself, because a sourced environment answers first |
| [pnpm-workspace.yaml](../../../pnpm-workspace.yaml) | the declared `storeDir` and `cacheDir` the two declared-value checks read back |
| `tests\` | compiled by the dynamic phase's bytecode workload |
| [package.json](../../../package.json) | decides whether the `pnpm install` workload runs |
| `tools\documentation\build.ps1` | the C++ workload step |
| `TEMP\` | the redirected temporary directory the workloads write into |
| `.cache\*\` | the redirected caches the static phase asserts are inside the repository |
| The watched user-profile roots | the baseline for the dynamic phase; the harness's own temporary directory is excluded by pattern ([responsibilities.md](responsibilities.md) §3.3) |
| The system temporary directory's own population | the input to the per-path shape test; whether the class exists on this machine at all is evidenced once in [evidence/windows-temporary-artifact-class.md](../../../evidence/windows-temporary-artifact-class.md), not re-derived per run |
| The gates' own exit codes | the entry point's only input: it records each one and never parses a gate's output |
| A second checkout of the repository | the input the cold-clone check needs: it is the only way to observe a cache that resolves into another checkout |

A negative fixture — a configuration that provably points outside the
repository without writing anything to the system volume — is Planned for the
version that owns milestone M00 in [VERSIONS.md](../../plan/VERSIONS.md). Until
it exists, the refusal paths of the guard and of the `2` exit code have no
automated test.

## 8. Deliberately not tested

| Not tested | Why | Owner or scope decision |
|---|---|---|
| The guard's refusal path | The guard evaluates values `env.ps1` itself computed, so provoking it requires hosting the checkout on the system volume, which the rule forbids; a safe negative fixture is Planned | the version owning M00, see [VERSIONS.md](../../plan/VERSIONS.md) |
| The missing-`pip.ini` refusal | It requires removing and restoring a repository file inside the test; the check is Planned with the negative fixture | the version owning M00, see [VERSIONS.md](../../plan/VERSIONS.md) |
| A deliberate exit-code-`2` trigger | The `trap` exists and is placed before any work, but no automated test aborts a run on purpose | the version owning M00, see [VERSIONS.md](../../plan/VERSIONS.md) |
| The entry point's per-gate `2` path | The code records `2` for a gate that threw, but no fixture provokes a gate failure or a throw, so the path is unexercised; the individual checkers' exit codes are exercised | the version owning M01, see [VERSIONS.md](../../plan/VERSIONS.md) |
| A repeated run of the entry point from a subdirectory | One run is recorded (§5.6); whether the Python gate is always the one that fails has not been established | the version owning M01, see [VERSIONS.md](../../plan/VERSIONS.md) |
| The widened harness exclusion pattern | The pattern on disk is unchanged, so there is nothing new to test; closing ENV-04 requires the change first | the version owning M01, see [VERSIONS.md](../../plan/VERSIONS.md) |
| Moving a provisioned tree to another directory | The declared paths now follow the checkout, so no configuration edit is involved; the residual case is `.venv`, whose `pyvenv.cfg` records an absolute payload path, and no measured capture of a moved tree exists. The procedure is [implementation.md](implementation.md) §5.2 | the version owning M01, see [VERSIONS.md](../../plan/VERSIONS.md) |
| A `uv` or pip invocation started from a subdirectory | The declared `cache-dir` is relative and both tools resolve it against the working directory; the resulting cache is inside the checkout but in an undocumented location ([risks.md](risks.md) ENV-06). No measured capture exists | the version owning M01, see [VERSIONS.md](../../plan/VERSIONS.md) |
| A pnpm release other than the pinned one | Only `pnpm@12.6.0` has been observed resolving a relative `storeDir` against the workspace root; a version sweep needs a second pnpm installed ([risks.md](risks.md) ENV-07) | the version owning M01, see [VERSIONS.md](../../plan/VERSIONS.md) |
| Two concurrent bootstrap runs | Nothing asserts the tools' own locking; a concurrent run is not part of the acceptance criteria | the version owning M01 (the CI work that would run the gates unattended), see [VERSIONS.md](../../plan/VERSIONS.md) |
| A session blocked by the execution policy | Would require a session without the process-scope bypass; the failure is silent by nature (phase risk R02) | the version owning M00, see [VERSIONS.md](../../plan/VERSIONS.md) |
| The low-integrity directory rule | Needs two session contexts, one of them unsandboxed (phase risk R01) | the version owning M01, see [VERSIONS.md](../../plan/VERSIONS.md) |
| Non-Windows hosts | Profile `M1` is the only declared profile and it is Windows | scope decision, no version scheduled |
| A host without Node | Profile `M1` declares Node ≥ 24; `-SkipNode` covers the flag path only | scope decision, no version scheduled |
| Locations outside the dynamic watch list | The list is a closed enumeration ([risks.md](risks.md) ENV-03); a wider list is Planned | the version owning M00, see [VERSIONS.md](../../plan/VERSIONS.md) |
| The C++ workload on a cold build tree in the primary checkout | The clone run performed a from-zero build of the gate and recorded it (§5.4, `configure` 3.4 s, `build` 3.81 s); the primary checkout has never had its build directory removed for this measurement | the version owning M01, see [VERSIONS.md](../../plan/VERSIONS.md) |

A skipped check is never reported as a passing check, and a coverage gap stays
in this table until the version that owns it closes it.
