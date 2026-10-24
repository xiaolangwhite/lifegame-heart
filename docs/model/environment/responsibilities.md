# environment — responsibilities

> **Owner.** This file owns the claims of the `environment` module, its
> boundary against every peer it touches, and the behaviour required when it
> fails. The rule text itself is owned by [AGENTS.md](../../../AGENTS.md) §1 and
> [ENGINE_STANDARD.md](../../../ENGINE_STANDARD.md) §1.2; version state by
> [VERSIONS.md](../../plan/VERSIONS.md).

Status: Implemented

## 1. Claims this module owns

| Claim | Enforced by | Consumer that relies on it |
|---|---|---|
| Every transient location the toolchain uses is defined in exactly one place | [scripts/env.ps1](../../../scripts/env.ps1) `$directoryVars` | every shell session |
| All ten published variables are validated **before** any directory is created or any variable is set, and a location on the `C:` volume stops the session before a tool runs | [scripts/env.ps1](../../../scripts/env.ps1) guard loop | any tool start-up |
| pip reads the repository configuration and no user-level configuration | [scripts/env.ps1](../../../scripts/env.ps1) (`PIP_CONFIG_FILE`), [scripts/pip.ini](../../../scripts/pip.ini) | pip, `uv pip` |
| `uv` writes its cache and its interpreter payload inside the repository | [uv.toml](../../../uv.toml), [scripts/env.ps1](../../../scripts/env.ps1) (`UV_CACHE_DIR`, `UV_PYTHON_INSTALL_DIR`) | `uv sync`, `uv run`, `uv venv` |
| The active interpreter is a `uv`-managed CPython 3.14 whose payload resolves inside the repository | [uv.toml](../../../uv.toml) (`python-preference`), [.python-version](../../../.python-version), [pyproject.toml](../../../pyproject.toml) | Python core, tests, lint |
| Python bytecode caching is redirected inside the repository | [scripts/env.ps1](../../../scripts/env.ps1) (`PYTHONPYCACHEPREFIX`) | any Python process |
| npm and pnpm keep cache, store and metadata cache inside the repository | [scripts/env.ps1](../../../scripts/env.ps1) (`npm_config_cache`), [pnpm-workspace.yaml](../../../pnpm-workspace.yaml) (`storeDir`, `cacheDir`) | NodeJS service and UI, tooling |
| A clone or a worktree keeps its own caches: every cache path declared in a committed configuration file is checkout-relative, and the npm cache is computed from the running script's own location | [uv.toml](../../../uv.toml), [pnpm-workspace.yaml](../../../pnpm-workspace.yaml), [scripts/pip.ini](../../../scripts/pip.ini), [scripts/env.ps1](../../../scripts/env.ps1); asserted by the declared-value checks of [scripts/verify-temp-isolation.ps1](../../../scripts/verify-temp-isolation.ps1) | the DSH per-task worktrees, a second checkout, a fork |
| The repository can be provisioned from a clean checkout by one idempotent command | [scripts/bootstrap.ps1](../../../scripts/bootstrap.ps1) | new session, new machine, future CI |
| The isolation claim is decidable by observation, not by argument | [scripts/verify-temp-isolation.ps1](../../../scripts/verify-temp-isolation.ps1) | acceptance criteria A1, A2, A3, A7, A10, A11 in [acceptance.md](../../plan/phase-01-foundation/acceptance.md) |
| Every gate runs from one command that sources the environment contract itself, so a caller cannot skip the preamble and cannot miss a gate | [scripts/verify.ps1](../../../scripts/verify.ps1) | an operator, an agent, a future aggregate gate or CI job |
| The aggregate verdict distinguishes "a gate failed" from "the runner could not complete" | [scripts/verify.ps1](../../../scripts/verify.ps1) exit codes `1` and `2` | an operator, a future CI job |
| An incomplete isolation check is distinguishable from a found violation | [scripts/verify-temp-isolation.ps1](../../../scripts/verify-temp-isolation.ps1) top-level `trap` emitting exit code `2` | an operator, a future aggregate gate |
| Every project directory is created by one script, in the same session context as the work | [scripts/bootstrap.ps1](../../../scripts/bootstrap.ps1) step 1 | confined agent sessions (phase risk R01 in [phase-01-foundation/risks.md](../../plan/phase-01-foundation/risks.md); [risks.md](risks.md) §2) |

## 2. Boundary against each peer

| Peer | This module owns | The peer owns | What must not cross |
|---|---|---|---|
| `documentation` module (`tools/documentation/`) | where files are written; the interpreter and caches the gate's Python-free build runs under; the aggregate entry point that invokes the gate | what documents must contain, link resolution, check codes, the gate's exit code | The isolation check must not enforce documentation rules, and the gate must not re-implement cache redirection. [scripts/verify.ps1](../../../scripts/verify.ps1) calls the gate's three published commands and forwards their exit codes; it never inspects their output to decide whether a gate passed |
| Phase plan documents (`docs/plan/phase-01-foundation/`) | the mechanism and its interface | the acceptance criteria and their evidence ownership | This module does not restate criteria; it links to [acceptance.md](../../plan/phase-01-foundation/acceptance.md) |
| Future `simulation-core` and service modules | the locations their toolchains write to | their own data formats, persistence paths and behaviour | A module must not invent a private temporary or cache directory; a new location is added to `env.ps1` and to [interfaces.md](interfaces.md) in the same change |
| Build manifests ([pyproject.toml](../../../pyproject.toml), [package.json](../../../package.json)) | the cache and temporary locations those tools use | package metadata, dependency sets, version constraints, script aliases | `[tool.uv]` location settings must not be added to `pyproject.toml` while `uv.toml` exists; the manifest comment states this |
| C++ tooling | the build, cache and temporary locations the tool build runs under | the tool's own source, build definition and outputs | Nothing under `src/` may import from `tools/`; the module does not build the tool, it only guarantees where its intermediates land |
| The DSH harness | nothing | the per-command `C:`-volume temporary directory it hands to every command | The project must not police the harness; the dynamic phase excludes it explicitly and says so (§3.3) |
| The operating system and the user | process-scoped environment variables for one shell | machine policy, user policy, disk contents | The module never changes a machine- or user-scoped setting and never deletes a file |
| The toolchain binaries (`uv`, pip, Python, npm, pnpm, Node) | the inputs that decide where they write | their own defaults, resolution order and behaviour | A tool's default location is never treated as acceptable because the tool "usually" honours the environment variable |

## 3. Required behaviour when it fails

### 3.1 `path-contract` — [scripts/env.ps1](../../../scripts/env.ps1)

The guard is the **first** thing that can fail: it computes all ten values in
memory, validates every one of them, and only then enters the apply loop. A
refusal therefore leaves no directory and no variable behind.

| Failure | Required behaviour | Must never happen |
|---|---|---|
| A guarded variable resolves to the `C:` volume | Throw before creating anything, naming the variable and its value | Create a directory or set a variable first, then refuse |
| A guarded variable resolves to an empty or whitespace-only value | Throw, naming the variable | Accept an empty value as "not set yet" |
| [scripts/pip.ini](../../../scripts/pip.ini) is missing | Throw, naming the expected path, before the apply loop runs | Silently fall back to the user-level pip configuration on the system volume |
| A directory in the variable table does not exist | Create it during the apply loop, then set the variable | Write into a location without recording it in the variable table |
| The script is dot-sourced twice | Set the same values again, create nothing new | Delete or clean an existing directory |

The refusal messages are part of the interface and are quoted in
[interfaces.md](interfaces.md) §2.4.

### 3.2 `env-bootstrap` — [scripts/bootstrap.ps1](../../../scripts/bootstrap.ps1)

| Failure | Required behaviour | Must never happen |
|---|---|---|
| The isolation guard throws in step 0 | The bootstrap terminates with a non-zero exit code and no further step runs | Skip step 0 to make bootstrap succeed |
| A step fails | `Invoke-Step` throws with the step name and the exit code; earlier steps are not rolled back | Report success because some steps succeeded |
| The interpreter probe finds no interpreter, which is the state of a clean checkout | The probe's exit code is treated as an answer; the payload is installed and provisioning continues | Let the probe's stderr line terminate the script before it installs anything |
| A step already did its work | Print the observed state (`already present: ...`) and continue | Re-download, re-create or delete anything |
| The static check (step 6) reports a violation | Terminate with a non-zero exit code | Treat the check as advisory |

The same component also owns the aggregate entry point, and its failure
behaviour is a separate contract because it decides nothing itself:

| Failure | Required behaviour | Must never happen |
|---|---|---|
| The environment contract cannot be sourced | Exit `2` before the first gate; no gate result is claimed | Run the gates under a degraded environment so that the suite fails for a reason unrelated to the change under test |
| A gate fails | Record that gate's exit code, keep running the remaining gates, and exit `1` at the end with the failing gates named | Stop at the first failure and hide the state of the other gates; report the run as passed |
| A gate could not run or threw | Record it as `2` for that gate and exit non-zero | Count a gate that never ran as a passing gate |
| A gate's output goes to stderr, or a tool warns | The call is made with the preference relaxed for that invocation | Let a warning line terminate the run, or let output leak into the returned exit code |
| `-SkipNode` is given | The Node gate and the Node isolation checks and workloads are not run, and the summary says so by the gate list | Report a skipped gate as passed |

### 3.3 `temp-isolation` — [scripts/verify-temp-isolation.ps1](../../../scripts/verify-temp-isolation.ps1)

| Failure | Required behaviour | Must never happen |
|---|---|---|
| A resolved value is outside the repository, is not an absolute path, or is the literal a tool prints for an unknown key (`undefined`, `null`, `true`, `false`, `nan`) | Record a failing check, keep checking the remaining locations, exit `1` | Accept a non-path value, or a relative one, as a passing location |
| A watched system-volume location gained or changed a file | Print the count, the first 40 entries and the run timestamp, exit `1` | Truncate the list without saying how many entries were omitted |
| The check cannot complete (an unexpected terminating error, a missing tool, an unreadable path) | Exit `2` from the top-level `trap`, distinct from a violation | Report a completed check that never ran, or let an abort surface as the violation code `1` |
| A switch skips a workload (`-SkipNode`, `-SkipCpp`, `-StaticOnly`) | The skipped work is named as skipped in the output | Count a skipped check as a passing check |

**The harness exclusion, and why it exists.** DSH gives every command its own
fresh temporary directory under the system volume, named with a `dsh-` prefix.
Those directories belong to the harness, not to this project, so the dynamic
phase ignores any path matching the pattern below. The exclusion is a
deliberate, named exception — not a general "ignore the system volume" rule.
Any file that is not below such a directory is still reported.

```
\\dsh-[0-9a-zA-Z]{6,}\\
```

**That pattern is narrower than the harness it names, and this is an observed
defect rather than a hypothetical one.** The harness uses several families of
temporary directory, and only the first is covered:

| Family | Example directory name | Covered by the pattern |
|---|---|---|
| bare identifier | `dsh-cE7q4j` | yes |
| workspace change capture | `dsh-workspace-changes-QeTs2W` | no |
| subprocess capture | `dsh-subprocess-fXOZpx` | no |
| output spill | `dsh-spill-1qMB7C` | no |
| session-scoped auxiliary | `dsh-acl-locks`, `dsh-im-*` | no |

The pattern requires `dsh-` followed by at least six alphanumerics and then a
separator, so a second hyphen ends the match. Measured on 2026-10-10: 46 `dsh-`
directories were present in the system temporary directory and **none** of them
matched the pattern as a directory path; the covered family only matches once a
path continues below it, which is correct for files but does not help the
families above.

The consequence was observed once: a full isolation run inside
`scripts/verify.ps1 -Full` exited `1` while four later `-Full` runs and two
standalone full runs exited `0`. The run that failed had its output truncated,
so the violating path was not captured, and a harness capture file written
during the window is the most likely candidate. The one-off is recorded as
failure evidence in [testing.md](testing.md) §5.6 and as an open risk —
[risks.md](risks.md) ENV-04 — with the widening of the pattern named as the fix.
It is **not** recorded as fixed, because the pattern on disk has not changed.

Until that pattern is widened, the practical reading of a full-run failure is:
check whether the reported path is below a `dsh-` directory before treating the
finding as a project artifact. A third-party application writing into the same
shared directory produces the same shape of false failure, and one such writer
was observed during the same session
([testing.md](testing.md) §5.6).

**The environmental-artifact exclusion, and why it is characterised once
instead of re-proved.** This machine continuously creates zero-length files
directly in the system temporary directory whose entire name is a GUID with a
`.tmp` extension, whether or not this project runs. The class is characterised
once, and the evidence that it is not this project's is recorded in
[evidence/windows-temporary-artifact-class.md](../../../evidence/windows-temporary-artifact-class.md);
the dynamic phase then applies the shape test to each changed file rather than
re-deriving the class on every run. Every excused file is printed, the shape
stays narrow, and an earlier design that re-earned the exclusion on every run
was removed after it produced a false failure on an unchanged tree — that
history is [testing.md](testing.md) §6 row 11. The mechanism is stated in
[implementation.md](implementation.md) §3.3.

### 3.4 Failure semantics of the module as a whole

* A failure is never converted into a warning that a later step can ignore.
* A skipped check is never a passing check.
* **"Could not check" is a distinct outcome from "violation found".** The
  isolation check reports the first as exit code `2` and the second as exit
  code `1`; collapsing them is a defect this module has already had once and
  fixed ([testing.md](testing.md) §6).
* A tool that is not covered by the contract is a gap, not an exemption: the
  same change that adds the tool extends `env.ps1` and [interfaces.md](interfaces.md)
  ([AGENTS.md](../../../AGENTS.md) §1, phase risk R06).
* Failed, skipped and timed-out runs stay in the record
  ([AI_DOCUMENTATION_GUIDE.md](../../AI_DOCUMENTATION_GUIDE.md) §2).

## 4. What the module must never do, even though it technically could

| Prohibited | Why |
|---|---|
| Write, cache, compile or build anything below the `C:` volume | It is the module's single rule; the system volume has limited free space and is not the project's storage |
| Delete, move, prune or garbage-collect any file or directory | A destructive default cannot be verified by the module's own checks; cleanup is a human decision |
| Change a machine- or user-scoped setting (execution policy, environment, registry) | The contract is process-scoped so that a checkout cannot alter the host |
| Change `$ErrorActionPreference`, `$ProgressPreference` or the strict mode in `env.ps1` | `env.ps1` is dot-sourced into a shared session; caller state must survive unchanged |
| Leak a native tool's stderr into the checker's error stream | PowerShell 5.1 with `$ErrorActionPreference = 'Stop'` turns one warning line from `pnpm` or `npm` into a terminating error, which would be reported as "could not complete" for a run that was in fact fine |
| Continue after a guard trips, in any mode, including a future non-interactive one | A silent fallback is exactly the failure the module exists to prevent |
| Weaken, reorder or narrow the guard list to make a check pass | The guard list is the contract; changing it is a documented interface change |
| Excuse a file on the system volume by assumption | The environmental-artifact exclusion is narrower than "ignore machine noise": it applies only to the characterised, evidenced shape — zero length, whole name is a GUID, `.tmp` extension, directly in the system temporary directory — and it is applied per file, with every excused path printed. A file in a cache, build, bytecode or package location is never excused |
| Report a gate as passed when it did not run | [scripts/verify.ps1](../../../scripts/verify.ps1) records each gate's own exit code; a gate that could not run is recorded as `2` for that gate and the run exits non-zero |
| Decide a peer gate's outcome from its output | The entry point forwards exit codes. Parsing a tool's text to decide whether it passed would put a second authority on a peer's verdict ([DOCUMENTATION_RULES.md](../../DOCUMENTATION_RULES.md) §2) |
| Treat "the tool usually honours the variable" as coverage | Only a resolved absolute value that is inside the repository counts, and a declared value is separately required to be relative and to resolve inside the repository |
| Claim the isolation result from a partial run | `-StaticOnly` covers resolved locations only; the dynamic phase is what observes created files |
| Re-implement the documentation gate's checks | One authority per claim type ([DOCUMENTATION_RULES.md](../../DOCUMENTATION_RULES.md) §2) |
| Become an importable package or a runtime dependency | It is infrastructure for shells and tools, not part of the product's runtime path |

## 5. Delegation map

| Question | Owner |
|---|---|
| Exact parameters, variables, output and exit codes | [interfaces.md](interfaces.md) |
| Who writes what, when, and for how long | [data-flow.md](data-flow.md) |
| Why the design is shaped this way; rejected alternatives | [implementation.md](implementation.md) |
| Which failure modes are covered by a check | [testing.md](testing.md) |
| Trigger, impact, mitigation and owning version of each open risk | [risks.md](risks.md) |
| Component list and allowed dependency direction | [internal-components.md](internal-components.md) |
