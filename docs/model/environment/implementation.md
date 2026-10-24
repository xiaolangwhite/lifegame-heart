# environment — implementation

> **Owner.** This file owns how the module is built: layout, algorithms and
> their complexity, required environment, configuration and relocation, the
> reasons for the structural choices, and the alternatives that were rejected.
> The interface is owned by [interfaces.md](interfaces.md); the rule by
> [AGENTS.md](../../../AGENTS.md) §1 and
> [ENGINE_STANDARD.md](../../../ENGINE_STANDARD.md) §1.2. The decision that
> makes the declared cache paths checkout-relative is
> [ADR 0004](../../adr/governance-and-build/0004-cache-locations-are-checkout-relative.md).

Status: Implemented

## 1. File and directory layout

The module is not a package; it is four scripts plus the configuration files
that the toolchain reads. Relative paths below are relative to the repository
root.

```
scripts/
  env.ps1                     path-contract: defines, validates and publishes every transient location
  bootstrap.ps1               env-bootstrap: provisions a clean checkout, idempotently
  verify.ps1                  env-bootstrap: the single gate entry point; sources the contract, runs every gate, one exit code
  verify-temp-isolation.ps1   temp-isolation: static and dynamic isolation proof
  pip.ini                     pip configuration, selected by PIP_CONFIG_FILE; relative cache-dir
uv.toml                       uv cache (relative fallback), interpreter preference, bytecode policy
.npmrc                        deliberately declares no settings; see section 5.1
pnpm-workspace.yaml           pnpm workspace, relative storeDir and cacheDir
.python-version               interpreter series pin (3.14)
pyproject.toml                Python project: requires-python, dev group, ruff, pytest
package.json                  script aliases, engines.node, packageManager
TEMP/                         redirected temporary directory
.cache/
  uv/                         uv cache          (UV_CACHE_DIR; uv.toml cache-dir is the fallback)
  uv-python/                  interpreter payloads (UV_PYTHON_INSTALL_DIR)
  pip/                        pip cache         (PIP_CACHE_DIR; pip.ini cache-dir is the fallback)
  npm/                        npm cache         (npm_config_cache only; .npmrc declares nothing)
  pnpm-store/                 pnpm content-addressable store (pnpm-workspace.yaml storeDir is relative; the store lives one level deeper, under pnpm-store/v11)
  pnpm-cache/                 pnpm metadata cache          (pnpm-workspace.yaml cacheDir is relative)
  pycache/                    Python bytecode   (PYTHONPYCACHEPREFIX)
```

`pyproject.toml` and `package.json` are listed because the module depends on
them, not because it owns them: the environment module owns neither the Python
dependency set nor the Node manifest. Ownership is stated in
[responsibilities.md](responsibilities.md) §2.

## 2. Prior art

The module implements each tool's **documented** configuration mechanism
instead of inventing a mechanism of its own:

| Tool | Documented mechanism used |
|---|---|
| `uv` | `uv.toml` project settings (a relative `cache-dir`) plus the `UV_CACHE_DIR` and `UV_PYTHON_INSTALL_DIR` environment variables and the `--install-dir` command-line override |
| pip | `PIP_CONFIG_FILE` selecting a project configuration file whose `cache-dir` is relative, plus the `PIP_CACHE_DIR` environment variable |
| Python | `PYTHONPYCACHEPREFIX` for bytecode; `TEMP`/`TMP`/`TMPDIR` for `tempfile` |
| npm | the `npm_config_cache` environment variable only; the project `.npmrc` exists but declares no settings, and §6 states why |
| pnpm | `storeDir` and `cacheDir` in `pnpm-workspace.yaml`, relative to the workspace root — the file pnpm 10 moved package-manager settings into |
| PowerShell | process-scope execution policy, dot-sourcing for caller-visible effects, `trap` for a distinct abort exit code, a native-invocation helper for every external command, and `Out-Host` where a helper must return an exit code rather than a tool's output (§3.4) |

No tool is redirected through an undocumented file-layout assumption. That is
why the guard list is an enumeration of named variables rather than a rule about
directories: only a named variable can be checked without guessing. The one
place the module deliberately stops using a documented key is `npm_config_tmp`
(§6 and [interfaces.md](interfaces.md) §2.3.1): the key is documented by older
npm versions, npm 11 reports it as unknown, and the location it was supposed to
control is already covered by `TEMP`/`TMP`.

## 3. Algorithms and complexity

The module has no algorithmic frontier. Its costs are bounded by a small
constant plus one host-sized scan. The bounds are stated so that "low enough"
is a statement about complexity rather than about convenience
([ENGINE_STANDARD.md](../../../ENGINE_STANDARD.md) §2.3).

| Routine | Work | Bound |
|---|---|---|
| `env.ps1` guard loop | For each of `V = 10` published values: one whitespace test, one regular-expression match of length `L`, and (for the pip configuration) one existence probe | `O(V · L)` filesystem probes; **no writes** |
| `env.ps1` apply loop | For each of `V = 10` values: one `Test-Path`, one conditional `New-Item`, one `Set-Item` | `O(V)` filesystem probes; independent of repository size |
| `bootstrap.ps1` step 1 | `Test-Path` per skeleton entry (`D = 17`) | `O(D)` |
| `bootstrap.ps1` step 2 | One `uv python find` process; a payload install only on a miss | `O(1)` probes; install is I/O-bound (network plus extraction) |
| `bootstrap.ps1` steps 3–5 | One process per step, each reusing tool-side caches | `O(1)` processes; cost is I/O-bound |
| `verify-temp-isolation.ps1` static phase | `V = 10` guarded-variable checks, one interpreter-home read, one text read of `uv.toml`, and `P = 9` further probes (two `uv`, one Python process returning three values, three pnpm, one npm), each native call wrapped by one helper | `O(V + P)` process spawns and reads |
| `verify-temp-isolation.ps1` environmental-class shape test | One property read per changed path: directory equality, a name match, and one length read | `O(C)` where `C` is the number of changed paths, which is normally 0 or a handful |
| `verify.ps1` | One process start per gate (`G = 7` by default, `9` with `-Full`), plus one dot-source of `env.ps1` and one formatted summary | `O(G)` process spawns; the cost is dominated by the gates themselves, not by the runner |
| `verify-temp-isolation.ps1` dynamic scan | One enumeration of the watched roots, one exclusion-pattern test per file, one timestamp comparison per file | `O(F)` time and `O(C)` memory, where `F` is the number of files below the watched roots and `C ≤ F` the number whose timestamp is at or after the workload start |
| Inside-repository predicate | `GetFullPath` plus a case-insensitive `StartsWith` | `O(L)` per value |
| Repository-relative predicate | reject an absolute or drive-qualified value, then `GetFullPath(Join-Path root value)` plus a case-insensitive `StartsWith` | `O(L)` per value |

`F` is set by the user profile and is **not** bounded by the repository. On
profile `M1`, the watched roots held 78,505 files at the last run
([performance.md](performance.md) §7). That is why §4.3 of
[interfaces.md](interfaces.md) bounds the depth of the system-temporary scan.

### 3.1 Guard before apply

The script computes all ten values into a single ordered table, then walks that
table once to validate it, then walks it again to create directories and set
variables. Splitting the two phases is what makes the failure mode safe: a
checkout hosted on the system volume is refused while the process is still
side-effect free. A single loop that validated and applied entry by entry would
leave the earlier directories created on the volume the module exists to
protect.

The pip configuration file is validated inside the guard loop by existence
rather than by value shape, because it is a file the script reads, not a
directory the script creates.

### 3.2 One time-filtered scan instead of two snapshots

The dynamic phase records one instant — `workloadStartUtc`, taken immediately
before the workloads run — and, after them, enumerates the watched roots once
and keeps every file whose `LastWriteTimeUtc` is at or after that instant.

The property that makes this equivalent to a before/after diff: creating a file
and modifying a file both move `LastWriteTimeUtc` to the moment of the write,
which is necessarily at or after the workload start. A file that existed before
the workload and was not touched keeps an earlier timestamp and is correctly
ignored. So the single scan detects creation **and** modification, which is
everything the two-snapshot contract ever detected, for one traversal instead
of two. The earlier design additionally had to hold a full path-to-timestamp
map of the before-state and diff it against the after-state, which cost `O(F)`
memory as well as the second traversal.

The system temporary directory is scanned exactly two levels deep
(`-Recurse -Depth 2`). The package-cache roots are scanned recursively because
that is where those tools lay out their trees. The depth bound exists because
the system temporary directory is shared with every other application on the
machine and is dominated by unrelated directories — see
[performance.md](performance.md) §7 for the observed counts and timings.

### 3.3 An exclusion that is characterised once and evidenced

The machine used for development continuously creates zero-length files
directly in the system temporary directory whose entire name is a GUID with a
`.tmp` extension. Treating that class as unrelated by assumption would be
exactly the "weaken the check until it passes" failure the module exists to
prevent, so the class is characterised once, with evidence, and then applied
mechanically:

| Element | Content |
|---|---|
| Shape | zero length; the entire file name matches `^<guid>\.tmp$`; the file sits directly in the system temporary directory, not in a subdirectory |
| Evidence that it is not this project's | [evidence/windows-temporary-artifact-class.md](../../../evidence/windows-temporary-artifact-class.md): every toolchain step was run on its own and produced none of them, and they keep appearing during windows in which nothing of this project runs |
| Runtime behaviour | each changed path is tested against the shape; a match is excused and printed, a non-match is a violation |
| Explicitly not excused | anything in a cache, build, bytecode or package location, and any file that fails any of the three shape tests |

Shape is checked structurally, not by name alone: the parent directory must be
the system temporary directory, the name must match the GUID-plus-`.tmp`
pattern, and the length must be zero.

An earlier revision made the check **re-earn** this exclusion on every run:
either at least five instances older than the repository, or an idle
observation window. That design was removed, and the reason is the point:

* an operating-system cleanup of the temporary directory removed the historical
  instances, so the first proof stopped holding;
* the idle window happened to be quiet, so the second proof did not hold either;
* the check then reported a file that no project tool had written as a
  violation — a false `FAIL` on a tree that had not changed — and the fallback
  path cost 25 s against a normal 11–12 s.

A proof that must be reproduced on every run fails for reasons unrelated to the
claim it supports, and a check that fails for unrelated reasons stops being
evidence. The mechanism is now a characterised class with a recorded evidence
file rather than a per-run derivation. The reversal is [testing.md](testing.md)
§6 row 11, and the residue — a non-project write of a *different* shape during
the window, including harness families the exclusion pattern does not cover —
is [risks.md](risks.md) ENV-04.

### 3.4 Every native tool is invoked through a helper

Both scripts that call external programs route every call through a local
helper; no native command is invoked directly. The reason is a PowerShell 5.1
behaviour: under `$ErrorActionPreference = 'Stop'`, a native program's stderr
output becomes a terminating error **even when stderr is redirected**. A tool
that has nothing to report writes to stderr; a probe that answers "no" writes to
stderr; a package manager writes warnings to stderr.

| Helper | Script | Behaviour |
|---|---|---|
| `Invoke-NativeQuiet` | `verify-temp-isolation.ps1` | switches the preference to `Continue` for the call, collects stdout, drops stderr, records `$LASTEXITCODE` separately, returns the first stdout line |
| `Invoke-NativeCapture` | `bootstrap.ps1` | the same shape, used for probes such as "is an interpreter present": the answer is the exit code, and the probe's stderr is an expected part of answering "no" |
| `Invoke-NativeStream` | `bootstrap.ps1` | runs the tool with its output piped into `Out-Host`, so the tool's output reaches the console and the function's return value is only the exit code |
| `Invoke-NativeStep` | `verify.ps1` | the same shape as `Invoke-NativeStream`: relaxes the preference for the call and pipes the tool's output into `Out-Host`, so the function returns the exit code and never an array of the tool's lines |

`bootstrap.ps1`'s `Invoke-Step` requires its body to **return an exit code** and
raises `Step failed: <name> (exit code <code>)` on a non-zero value. Before that
contract existed, the script ran the probe directly, a clean checkout produced
`No interpreter found for Python 3.14 ...` on stderr, the preference turned it
into a terminating error, and the script aborted in its install step before
installing anything. Warm checkouts hid the defect completely, because there the
probe succeeds and prints nothing to stderr. The first cold-clone run exposed it
([testing.md](testing.md) §6 row 9).

An unexpected error in the checker exits `2`, never `1`, from a top-level
`trap`: "could not check" and "violation found" are different claims.

### 3.5 `pyvenv.cfg` is read as UTF-8

The repository path contains non-ASCII characters. `uv venv` writes
`pyvenv.cfg` as UTF-8, while PowerShell 5.1's default text reader is ANSI, so
reading the file with the default decoder corrupts the recorded `home` value
and makes a correct interpreter binding fail the check. The script reads the
file with `[System.IO.File]::ReadAllText` and an explicit UTF-8 encoding object
that omits the byte-order mark.

### 3.6 A declaration and a resolution are two separate claims

The static phase asserts both, through two predicates:

* `Test-InsideRepo` requires an **absolute** value (or a UNC path), rejects the
  literals a tool prints for a key it does not know, and then requires the
  resolved path to start with the repository root. It is applied to everything a
  tool answers and to every value `env.ps1` publishes.
* `Test-RepoRelative` requires a **relative** value that does not escape the
  repository when it is resolved against the repository root. It is applied to
  the values declared in committed configuration files: `storeDir` and
  `cacheDir` in `pnpm-workspace.yaml`, and `cache-dir` in `uv.toml`.

One form alone is provably insufficient, and both failures were observed rather
than imagined:

* Reading only the resolved location cannot tell that the location belongs to a
  **different checkout**. Every value in the cold clone resolved to an absolute
  path inside a repository — just not the one being checked
  ([testing.md](testing.md) §6 row 10).
* Reading only the declared value cannot tell that the tool **never read it**.
  `pnpm config get store-dir` answered correctly while the store landed
  somewhere else entirely ([testing.md](testing.md) §6 row 7).

`uv.toml`'s `cache-dir` is read as text rather than asked of `uv`, because a
sourced environment makes `uv cache dir` answer with `UV_CACHE_DIR`; asking the
tool would hide a bad declaration behind a correct environment variable.

## 4. Required environment

| Requirement | Value | Enforced by |
|---|---|---|
| Operating system | Windows | All paths and all four scripts are Windows-specific |
| Shell | Windows PowerShell ≥ 5.1 | `#Requires -Version 5.1` in each script |
| Execution policy | Process-scope `Bypass` | The scripts are unsigned and the machine policy is `RemoteSigned`; the module never changes a machine or user setting |
| `uv` | 0.12.15 on the declared profile | `bootstrap.ps1` steps 2–4, the static-phase probes |
| Python | `uv`-managed CPython 3.14 (3.14.7 is the resolved payload at the last check) | `.python-version`, `uv.toml` `python-preference = "only-managed"` |
| Node and pnpm | Node ≥ 24, `pnpm@12.6.0` | `package.json` `engines` and `packageManager`; optional via `-SkipNode`. The relative-store resolution is asserted only for the pinned version ([risks.md](risks.md) ENV-07) |
| Volume layout | The repository is not on the system volume | The guard in `env.ps1` throws when it is |
| Working directory | The repository root for every toolchain command | [AGENTS.md](../../../AGENTS.md) §1; the relative declared `cache-dir` values depend on it ([risks.md](risks.md) ENV-06) |
| Sandbox integrity label | The repository root carries a low-integrity mandatory label so confined sessions can write | `bootstrap.ps1` creates directories inside a confined session; the label is why (phase risk R01) |

The declared machine profile and its versions are owned by
[PERFORMANCE_ACCEPTANCE.md](../../plan/PERFORMANCE_ACCEPTANCE.md) §1.

## 5. Configuration and relocation

### 5.1 Where each setting lives

| Setting | File | Why there |
|---|---|---|
| `uv` cache directory | [uv.toml](../../../uv.toml) `cache-dir`, relative | `uv.toml` is read from the project root, so the value applies without a sourced environment; `UV_CACHE_DIR` from `scripts/env.ps1` is the authoritative mechanism and wins when it is set |
| `uv` interpreter preference and bytecode policy | [uv.toml](../../../uv.toml) `python-preference`, `compile-bytecode` | project-level `uv` settings, kept out of `pyproject.toml` because the `uv.toml` file wins when both exist |
| Interpreter series | [.python-version](../../../.python-version) | read by `uv` interpreter resolution |
| Python requirements | [pyproject.toml](../../../pyproject.toml) | packaging and dependency ownership |
| pip cache and configuration selection | [scripts/pip.ini](../../../scripts/pip.ini) (relative `cache-dir`) plus `PIP_CONFIG_FILE` and `PIP_CACHE_DIR` in [scripts/env.ps1](../../../scripts/env.ps1) | `PIP_CONFIG_FILE` overrides the user-level configuration that lives on the system volume; the environment variable is the authoritative mechanism for the location |
| npm cache | [scripts/env.ps1](../../../scripts/env.ps1) (`npm_config_cache`) | [.npmrc](../../../.npmrc) declares no settings: npm resolves a relative path against the working directory, an absolute path binds one checkout, and npm 11 reports the pnpm-only keys as unknown project configuration |
| pnpm store and metadata cache | [pnpm-workspace.yaml](../../../pnpm-workspace.yaml) `storeDir`, `cacheDir`, relative | pnpm 10 moved package-manager settings here; the same keys in `.npmrc` are inert for pnpm 12, and pnpm resolves these against the workspace root |
| Temporary directories, bytecode prefix, cache mirrors for a session | [scripts/env.ps1](../../../scripts/env.ps1) | one place for everything that must affect a running process |

### 5.2 Relocation

No committed configuration file names a checkout path, so renaming, moving,
cloning or forking the repository requires **no** configuration edit: each
declared value is relative and follows whichever checkout is running
([ADR 0004](../../adr/governance-and-build/0004-cache-locations-are-checkout-relative.md)).
A move of an already-provisioned tree still needs the following, in order,
because `.venv\pyvenv.cfg` records the absolute payload path that `uv venv`
resolved when it created the environment:

1. Remove `.venv\` (a human action; the module never deletes) and let
   `bootstrap.ps1` step 3 recreate it, so `pyvenv.cfg` records the new payload
   path.
2. Re-run `bootstrap.ps1` from the new root; it re-creates the skeleton,
   re-resolves the interpreter payload inside the new tree, and re-syncs
   packages.
3. Re-source [scripts/env.ps1](../../../scripts/env.ps1) in the session;
   `LIFEGAME_ROOT` is derived from the script location and needs no edit.
4. Run the full isolation check, not the static one, and read the exit code.

A clone or a worktree needs none of this: it starts with no `.venv` at all, and
`bootstrap.ps1` creates one that points into the copy. The cold-clone run in
[testing.md](testing.md) §5.4 is the measured form of that statement.

The failure this replaced is kept rather than erased. When the declared paths
were absolute, a copy wrote into the **original** checkout until its
configuration was edited, and the static phase could only report the
consequence ([testing.md](testing.md) §6 row 10). Both halves are recorded
because the first design was chosen deliberately, on a correct argument that
stopped holding as soon as a second checkout existed.

## 6. Why the structural choices were made

| Choice | Reason |
|---|---|
| One script owns every transient location | One authority per claim type ([DOCUMENTATION_RULES.md](../../DOCUMENTATION_RULES.md) §2); adding a location is one edit plus one documentation edit |
| The guard validates all ten values **before** the apply loop creates anything | A refusal must not itself write to the volume it protects; a checkout hosted on the system volume is the case that makes this observable |
| `env.ps1` must be dot-sourced | The variables must exist in the caller's process; a child process would exit with them |
| `env.ps1` leaves `$ErrorActionPreference` and the strict mode alone | It runs inside a shared session; mutating caller state would change unrelated commands |
| The guard throws instead of warning | A silent fallback to the system volume is exactly the failure the module exists to prevent ([AGENTS.md](../../../AGENTS.md) §1) |
| The guard enumerates ten names | A named variable can be checked exactly; a rule about directories cannot. The count is one above the nine of criterion A3 on purpose: the A3 list is a floor |
| The guard also rejects empty values | A value that resolves to nothing is not a location, and silently substituting a default is how a fallback to the system volume starts |
| `npm_config_tmp` was removed from both the script and `.npmrc` | npm 11 rejects the key as unknown and emits a stderr warning, while the location it claimed to control is decided by `TEMP`/`TMP` through `os.tmpdir()`; keeping it added a guard entry that could not verify anything |
| Checkout-relative cache declarations in the committed configuration files | An absolute declared path names exactly one checkout, so a `git clone` or a `git worktree` — and this repository's agent environment creates a worktree per task — wrote its caches into the original checkout while each copy reported itself isolated. A relative value follows whichever checkout is running, and the tools' resolution rules are documented. This replaced an earlier absolute-path design whose argument was sound for a single checkout only |
| `.npmrc` declares no settings | npm resolves a relative path against the working directory and an absolute path binds one checkout, so neither form is safe to commit; npm 11 additionally reports the pnpm-only keys as unknown project configuration, which put a warning on stderr on every invocation. The npm cache is owned by `npm_config_cache`, computed by `env.ps1` from that script's own location |
| The check asserts declared values **and** resolved values | A declared-only check is satisfied by a value the tool ignores; a resolved-only check cannot tell that a correct-looking path belongs to another checkout. Both failures were observed ([testing.md](testing.md) §6 rows 7 and 10) |
| The static phase reads `uv.toml` as text instead of asking `uv` | A sourced session makes `uv cache dir` answer with `UV_CACHE_DIR`, so asking the tool would hide a bad declaration behind a correct environment variable |
| The interpreter payload directory is set by `UV_PYTHON_INSTALL_DIR` and `--install-dir`, not by `uv.toml` | `python-install-dir` is not a valid `uv.toml` key; `uv` 0.12.15 rejects the whole file when it appears (measured) |
| pnpm's store and cache are declared in `pnpm-workspace.yaml` | pnpm 10 moved package-manager settings there; the `.npmrc` keys still read back as written but do not decide where pnpm writes |
| `bootstrap.ps1` creates every directory | A directory created before the sandbox label policy was active does not inherit the low-integrity label, and a confined session then cannot write into it (phase risk R01) |
| Every native call goes through a helper, and a step body returns an exit code | Under `Stop`, PowerShell 5.1 converts a native stderr line into a terminating error; a clean checkout's failed interpreter probe therefore aborted provisioning before it installed anything, while every warm run passed ([testing.md](testing.md) §6 row 9) |
| Provisioning is idempotent and never deletes | A second run must be safe to execute at any time; deleting would make the script destructive and unverifiable |
| Isolation is proven in two phases | The static phase is cheap and catches configuration errors immediately; the dynamic phase is the only part that observes what a real workload does |
| Workloads are real tool runs (Python temp file, bytecode compile, C++ build, Node temp file, `pnpm install`) | A synthetic probe would not exercise the tools whose behaviour the claim covers ([ENGINE_STANDARD.md](../../../ENGINE_STANDARD.md) §4) |
| A failing workload step is reported as `[warn]` and the run continues | The scan, not the step's exit code, decides the check; aborting would hide the remaining evidence |
| The dynamic phase takes one time-filtered scan, not two snapshots | Creation and modification both leave a timestamp at or after the workload start, so one traversal detects everything two traversals did, at half the cost and without holding a before-state map |
| The system temporary directory is scanned two levels deep | A full recursive scan of a directory shared with every other application on the machine is dominated by unrelated trees; the bound is stated rather than implicit |
| A file shape is excused because it was characterised once and evidenced | Re-deriving the class at run time made the gate slow and non-deterministic: an operating-system cleanup removed the historical instances, a quiet idle window removed the other proof, and an unchanged tree reported a false `FAIL` ([testing.md](testing.md) §6 row 11). The characterisation is recorded with its evidence and applied per path, and every excused path is printed |
| One aggregate entry point sources the environment and runs every gate | The failure it removes is not hypothetical: a suite run without the session preamble goes red for a reason unrelated to the change under test, and it did ([testing.md](testing.md) §5.5). Sourcing the contract inside the entry point makes the preamble unforgettable rather than remembered |
| The entry point forwards each gate's exit code and never parses its output | A verdict belongs to the gate that owns it ([DOCUMENTATION_RULES.md](../../DOCUMENTATION_RULES.md) §2); parsing a tool's text would create a second authority on a peer's result and would break on a reworded message |
| Native tool stderr is discarded and the exit code recorded separately | One warning line from a package manager must not be able to turn an isolated environment into "could not complete" |
| `pyvenv.cfg` is decoded explicitly as UTF-8 | The repository path is non-ASCII and PowerShell 5.1's default reader is ANSI; the default would fail a correct environment |
| An unexpected error exits `2`, never `1` | "Could not check" and "violation found" are different claims and must be different exit codes |
| The harness temporary directory is excluded by an explicit pattern | The harness owns it, not the project; the exclusion is written down rather than inferred |
| A separate `temp-isolation` component | The claim must be checkable by someone who did not write the contract, and the checker must be able to fail |

## 7. Rejected alternatives

| Alternative | Why rejected |
|---|---|
| Absolute cache paths in the committed configuration files | The form this module shipped first, and it bound every cache to the checkout that named it: a `git clone` or `git worktree` wrote into the original checkout while reporting itself isolated. The cold-clone check resolved the clone's pnpm store to the primary checkout, and that is not a theoretical risk here, because the agent environment creates a worktree per task. Replaced by checkout-relative declarations ([ADR 0004](../../adr/governance-and-build/0004-cache-locations-are-checkout-relative.md)); the history is kept in [testing.md](testing.md) §6 row 10 |
| Declaring the npm cache in `.npmrc`, in either form | A relative value is resolved against the working directory and an absolute value binds one checkout; npm 11 additionally reports the pnpm-only keys as unknown configuration and warns on stderr. The npm cache is owned by `npm_config_cache` from `env.ps1`, which computes it from the script's own location and is therefore correct in any checkout |
| Checking only the declared cache values | Satisfied by a value the tool never reads, which is exactly the false positive of [testing.md](testing.md) §6 row 7 |
| Checking only the resolved cache paths | Cannot distinguish "inside this checkout" from "inside another checkout", which is exactly the failure the cold clone exposed ([testing.md](testing.md) §6 row 10) |
| Trusting a relative declaration to resolve in the same place for every tool | `uv` and pip resolve it against the working directory while pnpm resolves it against the workspace root; the difference is real and is recorded as [risks.md](risks.md) ENV-06 and ENV-07 rather than smoothed over |
| Two full before/after snapshots of the watched roots | Costs a second traversal and a full path map, and detects exactly what one timestamp-filtered pass detects: creation and modification both move the modification time past the workload start |
| Comparing file hashes before and after | Adds `O(total bytes)` per run with no extra detection power over name plus last-write time |
| Unconditionally ignoring zero-length GUID `.tmp` files in the system temporary directory, without evidence | It is a real observed machine class, but excusing it without the recorded evidence would be indistinguishable from weakening the check. The class *is* excused now — per path, on shape, with every excused path printed and the evidence in [evidence/windows-temporary-artifact-class.md](../../../evidence/windows-temporary-artifact-class.md) — which is a different thing from assuming it away |
| Re-earning the exclusion on every run, by history count or idle observation | The form this module shipped first, and it failed on an unchanged tree: an operating-system cleanup of the temporary directory removed the historical instances, the idle window happened to be quiet, and the check reported a file no project tool had written. It also cost 25 s against a normal 11–12 s because the fallback path slept for ten seconds. A proof that must be reproduced per run can fail for reasons unrelated to the claim it supports; replaced by the characterised class ([testing.md](testing.md) §6 row 11) |
| Excusing the whole system temporary directory, or everything the harness writes | The directory is shared with every application on the machine; excusing it wholesale would delete the only observational evidence this module has. The exclusions are a named harness pattern and one narrow shape, and each excused path is printed |
| A shell alias or a `package.json` script as the only aggregate entry point | An alias still requires the caller to have sourced the environment, which is the failure it would have to prevent; `package.json` additionally requires Node to be present in order to lint Python |
| Parsing each gate's output to decide whether it passed | Puts a second authority on a peer's verdict, breaks on a reworded message, and would report a tool that printed "0 errors" and exited `1` as a pass |
| Making the entry point a PowerShell module or a function library | It would have to be imported before use, which reintroduces the preamble it exists to remove; a single script invoked with `-File` is one command with one exit code |
| Re-implementing a peer's gate inside the entry point | Duplicates a verdict that already has an owner ([DOCUMENTATION_RULES.md](../../DOCUMENTATION_RULES.md) §2) and guarantees the two copies drift |
| Recursing into the whole system temporary directory | Its content belongs mostly to other applications; the extra depth detects nothing the two-level bound misses and pushes the gate past the 30-second limit ([PERFORMANCE_ACCEPTANCE.md](../../plan/PERFORMANCE_ACCEPTANCE.md) §2) |
| Keeping `npm_config_tmp` as a published variable guarded for completeness | It was inert: npm 11 warns about it as an unknown key and Node's temporary directory is decided by `TEMP`/`TMP`. A guard entry that cannot fail meaningfully is noise, not coverage |
| Leaving pnpm's store declaration in `.npmrc` | pnpm 10 moved the setting to `pnpm-workspace.yaml`; the `.npmrc` value reads back but does not decide where the store lands, which is the false-positive shape this module exists to prevent |
| Accepting any non-empty string as a resolved location | `pnpm config get store-dir` answers `undefined` for a key it does not know, and `GetFullPath('undefined')` resolves *inside* the repository — a check that passes while verifying nothing. The predicate now requires an absolute path and rejects the literal answers |
| Letting a native tool's stderr reach the script | Under `Stop`, a probe's "not found" message or a package manager's warning becomes a terminating error; on a clean checkout that aborted provisioning, and in the checker it reported "could not complete" for a healthy environment |
| Reading `pyvenv.cfg` with the default decoder | PowerShell 5.1 reads ANSI by default; the non-ASCII repository path corrupted the `home` value and failed a correct binding |
| `python-install-dir` in `uv.toml` | Not a valid key; `uv` 0.12.15 refuses to parse the whole file, which would silently drop `cache-dir` with it |
| A wrapper executable that re-launches every tool with a fixed environment | Duplicates every command line, breaks pipelines and exit-code propagation, and does not cover tools started indirectly |
| Directory junctions or symlinks from the default system-volume cache locations into the repository | Requires elevation to create; the system volume path would still be the location a tool writes to, so the check would have to treat it as acceptable |
| Setting the locations as machine- or user-scoped environment variables | Changes the host for every unrelated project; the contract is process-scoped on purpose |
| A cleanup step in `bootstrap.ps1` that prunes `.cache/` | Destructive, and the module's own rule is that it never deletes |
| Watching the entire system volume for changes | Cost is unbounded and unrelated activity would make the check meaningless |
| Checking only `TEMP`/`TMP`/`TMPDIR` | Misses package caches, the bytecode cache and build intermediates — three of the four artifact classes the rule names |
| Copying or mirroring cache directories out of the system volume after a build | The artifact was already written to the system volume; the rule is about where it is written, not where it ends up |
| Making the module an importable Python package | It would need a Python process to set up the environment that Python itself depends on; the contract is a shell-level bootstrap |

## 8. Known implementation gaps

These are the gaps that are still open. Each is owned by a risk with a version
that owns it ([risks.md](risks.md)):

* The inside-repository predicate is a string prefix test (ENV-01).
* The dynamic watch list is a closed enumeration (ENV-03).
* The harness exclusion pattern covers one `dsh-` directory family out of
  several, so a harness capture written during the window can be reported as a
  project violation — observed once, not reproduced (ENV-04).
* The in-repository cache tree has no retention contract (ENV-05).
* A relative `cache-dir` in `uv.toml` or `scripts/pip.ini` is resolved against
  the working directory, so a tool started from a subdirectory builds a second
  cache tree there (ENV-06).
* The relative-store resolution of pnpm is asserted for the pinned release only
  (ENV-07).
* The entry point does not fix the working directory, so the `python tests` gate
  fails when it is started from a subdirectory (ENV-08).

The defects that were found and fixed inside this version — the automatic
variable collision, the missing exit code `2`, the guard running after the
apply loop, the unguarded published variables, the pnpm store landing outside
the repository, the false-positive predicate, the native-stderr abort, the
ANSI read of `pyvenv.cfg`, the two-snapshot dynamic phase, the bootstrap abort
on a clean checkout, the checkout-bound absolute cache declarations, and the
per-run re-earning of the environmental exclusion — are not listed here as
gaps. Their record, with the failing observation and the re-verification
command for each, is [testing.md](testing.md) §6.
