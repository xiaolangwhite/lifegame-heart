# environment — interfaces

> **Owner.** This file owns the complete public surface of the `environment`
> module: parameters, published environment variables, configuration-file keys,
> output format, exit codes and the compatibility policy. The component list is
> owned by [internal-components.md](internal-components.md); the rule by
> [AGENTS.md](../../../AGENTS.md) §1; the decision behind the relative cache
> declarations by
> [ADR 0004](../../adr/governance-and-build/0004-cache-locations-are-checkout-relative.md).

Status: Implemented

## 1. Surface inventory

The module has no importable package. Its public surface is four PowerShell
entry points, the configuration files listed below and the ten environment
variables [scripts/env.ps1](../../../scripts/env.ps1) publishes.

| Surface | Kind | Consumer |
|---|---|---|
| [scripts/env.ps1](../../../scripts/env.ps1) | dot-sourced script, no parameters | every shell session, `bootstrap.ps1`, `verify-temp-isolation.ps1`, `verify.ps1` |
| [scripts/bootstrap.ps1](../../../scripts/bootstrap.ps1) | standalone script, two optional switches | a new session, a new machine, future CI |
| [scripts/verify-temp-isolation.ps1](../../../scripts/verify-temp-isolation.ps1) | standalone script, three optional switches | acceptance criteria A1, A2, A3, A11 |
| [scripts/verify.ps1](../../../scripts/verify.ps1) | standalone script, two optional switches; the single gate entry point | an operator, an agent, a future CI job |
| [uv.toml](../../../uv.toml), [.python-version](../../../.python-version) | `uv` configuration | `uv sync`, `uv run`, `uv venv` |
| [scripts/pip.ini](../../../scripts/pip.ini) | pip configuration, selected by `PIP_CONFIG_FILE` | pip, `uv pip` |
| [.npmrc](../../../.npmrc) | npm configuration file that deliberately declares no settings; see §5.3 | `npm` |
| [pnpm-workspace.yaml](../../../pnpm-workspace.yaml) | pnpm workspace and package-manager settings | `pnpm` |
| [package.json](../../../package.json) | script aliases, engine and package-manager pin | humans, agents, CI |

## 2. `scripts/env.ps1` — the path contract

### 2.1 Invocation

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
Set-Location <repo>
. .\scripts\env.ps1
```

It must be dot-sourced (`. .\scripts\env.ps1`), not executed, because its whole
effect is on the caller's process environment. Running it as a child process
sets variables in a process that immediately exits.

### 2.2 Parameters

None. The script declares no `param` block and accepts no arguments.

### 2.3 Effects, and the order they happen in

The script runs in two phases, and the order is part of the contract:

1. **Guard.** Every value in the table below is computed in memory and
   validated. Nothing is created and no variable is set until all ten have
   passed.
2. **Apply.** For each entry, the script creates the directory when it is
   missing (`New-Item -ItemType Directory -Force`) and then sets the variable
   in the current process (`Set-Item -Path "Env:<name>"`).

Relative paths below are relative to the repository root, which the script
resolves from its own location (`$PSScriptRoot\..`). Every value it publishes is
therefore **absolute for the checkout that is running**, whatever the checkout
is called and wherever it lives. Every guarded value must be non-empty and must
not begin with the system volume's drive letter; the literal value of the
refusal is quoted in §2.4.

| Variable | Value | Directory created | Validated before apply |
|---|---|---|---|
| `LIFEGAME_ROOT` | repository root | — (already exists) | yes |
| `TEMP` | `TEMP` | yes | yes |
| `TMP` | `TEMP` | yes | yes |
| `TMPDIR` | `TEMP` | yes | yes |
| `UV_CACHE_DIR` | `.cache\uv` | yes | yes |
| `UV_PYTHON_INSTALL_DIR` | `.cache\uv-python` | yes | yes |
| `PIP_CACHE_DIR` | `.cache\pip` | yes | yes |
| `PYTHONPYCACHEPREFIX` | `.cache\pycache` | yes | yes |
| `npm_config_cache` | `.cache\npm` | yes | yes |
| `PIP_CONFIG_FILE` | `scripts\pip.ini` | — (must already exist) | yes (existence) |

All ten are validated; there is no unguarded published variable. The guard is
stricter than acceptance criterion A3, which names nine of them and treats the
list as a floor: `LIFEGAME_ROOT` was added to the guard on the same change that
made the script validate before it applies. The variable names and the order in
which the guard evaluates them must stay in step with the check list in
[scripts/verify-temp-isolation.ps1](../../../scripts/verify-temp-isolation.ps1)
and with `tests/environment/test_isolation_contract.py`, which asserts the same
ten names from the Python side.

### 2.3.1 Why `npm_config_tmp` is no longer published

`npm_config_tmp` was published and documented by an earlier revision of this
module. It was removed, and `.npmrc`'s matching `tmp=` key with it, because it
never did what the contract claimed:

* npm 11 treats `tmp` as an unknown configuration key and writes a warning to
  stderr on every invocation;
* Node's temporary directory — the one npm and pnpm actually use — is decided
  by `TEMP`/`TMP`, which this script already redirects, through `os.tmpdir()`.

Publishing a variable that a tool ignores adds a guard entry that can never
fail meaningfully and a warning line that can break a native-tool check. The
replacement is not a new variable: it is `TEMP`, `TMP` and `TMPDIR`, which are
validated above. The reason is recorded in
[.npmrc](../../../.npmrc) itself so that the next reader does not reintroduce
it.

### 2.4 Exceptions

All failures are terminating errors (`throw`). The messages are part of the
interface:

```
Environment variable <NAME> resolved to an empty value; refusing to continue.
```

```
Environment variable <NAME> points at C: (<value>); refusing to continue.
```

```
Missing pip configuration: <repository root>\scripts\pip.ini
```

The volume guard matches the regular expression against the value and rejects a
value that begins with the system volume's drive letter followed by a colon —
an absolute path or a drive-relative one. An empty or whitespace-only value is
rejected by a separate test before the pattern is applied. The existence test
for the pip configuration file runs inside the same guard loop, so a missing
`scripts\pip.ini` is reported before any directory is created. The guard list
is the ten names of §2.3.

### 2.5 Return value, ownership and lifetime

* Return value: none. The effect is the environment block of the calling
  process and the existence of the directories in the table.
* Ownership: the caller owns the variables; they live until the process exits.
  The directories outlive the process and are deleted by a human, never by this
  module.
* Idempotency: repeated dot-sourcing sets the same values and creates nothing
  new. The script never deletes.

### 2.6 Deliberate non-effects

`env.ps1` does not touch `$ErrorActionPreference`, `$ProgressPreference` or
`Set-StrictMode`, and it does not change any machine or user setting. The
script header states this and [responsibilities.md](responsibilities.md) §4
makes it a prohibition, because the script is dot-sourced into a shared session.

## 3. `env-bootstrap` — provisioning and the verification entry point

This section owns both scripts of the `env-bootstrap` component
([internal-components.md](internal-components.md) §1): §3.1 to §3.5 describe
provisioning, and §3.6 describes the aggregate entry point.

### 3.1 `bootstrap.ps1` parameters

| Parameter | Type | Effect |
|---|---|---|
| `-SkipNode` | switch | Skips the Node package install (step 5) and prints `-- skipped: Node package install` |
| `-SkipPythonPackages` | switch | Skips the Python package sync (step 4) and prints `-- skipped: Python package sync` |

`[CmdletBinding()]` is declared, so common parameters are accepted. Unknown
parameters fail the parameter binder before any step runs.

### 3.2 Steps

The script sets `$ErrorActionPreference = 'Stop'` and
`$ProgressPreference = 'SilentlyContinue'` for its own process only. Every
external command it runs goes through one of the two helpers described in §3.4,
and every step body returns an exit code.

| Step | Action | Idempotency mechanism |
|---|---|---|
| 0 | Dot-sources [scripts/env.ps1](../../../scripts/env.ps1) and prints that the isolation contract is satisfied | The guard throws instead of degrading |
| 1 | Ensures the directory skeleton (`TEMP`, `data`, `dev-log`, `evidence`, `scripts`, `.cache\uv`, `.cache\uv-python`, `.cache\pip`, `.cache\npm`, `.cache\pnpm-store`, `.cache\pnpm-cache`, `.cache\pycache`, `docs\adr`, `docs\model`, `docs\plan`, `src\lifegame`, `tests`, `tools\documentation`) | `Test-Path` before `New-Item` |
| 2 | Ensures a `uv`-managed CPython 3.14 payload under `.cache\uv-python` | `uv python find 3.14` through `Invoke-NativeCapture`; installs only when the result is missing or outside the repository, using `uv python install 3.14 --no-bin --install-dir <repo>\.cache\uv-python`. A failed probe is an anticipated answer, not an abort |
| 3 | Creates `.venv` when `.venv\Scripts\python.exe` is missing | `uv venv --python 3.14 <repo>\.venv` |
| 4 | `uv sync` in the repository root (project plus the `dev` dependency group) | `uv` lock and cache make a second run a no-op |
| 5 | `pnpm install` in the repository root; a missing `package.json` prints `no package.json; nothing to do` and succeeds | pnpm lockfile and `prefer-frozen-lockfile` |
| 6 | Runs [scripts/verify-temp-isolation.ps1](../../../scripts/verify-temp-isolation.ps1) with `-StaticOnly` | The check is stateless |

### 3.3 Output format

One line per event, prefixed with `[bootstrap]`:

```
[bootstrap] project root: <absolute path>
[bootstrap] isolation contract satisfied (TEMP, uv, pip, npm caches are in-repo)
[bootstrap] >> <step name>
[bootstrap]    already present: <observed state>
[bootstrap] -- skipped: <step name>
[bootstrap] done.
```

Step names are produced by `Invoke-Step` and are stable identifiers:
`ensure directory skeleton`, `install uv-managed CPython 3.14 into .cache/uv-python`,
`create .venv when missing`, `sync Python packages (project + dev group)`,
`install Node packages (pnpm, in-repo store)`, `verify isolation`.

### 3.4 Native invocation contract

No external command is invoked directly. A tool that has nothing to report
writes to stderr, and PowerShell 5.1 under `$ErrorActionPreference = 'Stop'`
turns a native stderr line into a terminating error even when stderr is
redirected, so a probe answering "no" would abort the script.

| Helper | Behaviour |
|---|---|
| `Invoke-NativeStream` | runs the tool with its output piped into `Out-Host`: the tool's output reaches the console and the function returns the exit code and nothing else |
| `Invoke-NativeCapture` | collects the first stdout line, drops stderr, records the exit code in `$script:LastCaptureExitCode` |
| `Invoke-Step` | runs a named step body and requires it to **return an exit code**; a non-zero value throws `Step failed: <step name> (exit code <code>)` |

### 3.5 Exit codes

The script calls `exit 0` after its last step, so the process exit code is `0`
on success and non-zero when a step throws. A step is considered failed when
the exit code its body returned is non-zero, and it ends with
`Step failed: <step name> (exit code <code>)`. Steps 1 and 5 return `0`
explicitly, because directory creation and a `package.json`-absent
short-circuit are not external commands.

### 3.6 `scripts/verify.ps1` — the single verification entry point

The gates were eight separate commands with three invocation conventions and a
three-line session preamble that had to be repeated in every shell. Forgetting
the preamble does not fail loudly: the environment contract silently falls back
to the system volume and the suite goes red for a reason unrelated to the change
being tested. This script exists to remove both the repetition and that failure
mode, and it is the command [AGENTS.md](../../../AGENTS.md) §4 publishes.

| Parameter | Type | Effect |
|---|---|---|
| `-Full` | switch | Adds the two version-boundary gates: the isolation dynamic phase and a bootstrap idempotence run |
| `-SkipNode` | switch | Adds `-SkipNode` to both isolation invocations and omits the Node install gate |

`[CmdletBinding()]` is declared, so common parameters are accepted. Unknown
parameters fail the parameter binder before any gate runs.

**Gate set, in order.** The default set is feedback for an edit and takes about
five seconds:

| # | Gate | Command it runs |
|---|---|---|
| 1 | documentation conformance | `tools/documentation/validate-documentation.ps1 -Quiet` |
| 2 | gate self-tests | `tools/documentation/tests/run-tests.ps1` |
| 3 | tool build (incremental) | `tools/documentation/build.ps1 -Quiet` |
| 4 | isolation (static) | `scripts/verify-temp-isolation.ps1 -StaticOnly` |
| 5 | python tests | `uv run pytest -q` |
| 6 | python lint | `uv run ruff check` |
| 7 | node install | `pnpm install --silent` |

`-Full` then adds:

| # | Gate | Command it runs |
|---|---|---|
| 8 | isolation (full, version-boundary) | `scripts/verify-temp-isolation.ps1` |
| 9 | bootstrap idempotence | `scripts/bootstrap.ps1` |

Gates 1 to 3 belong to the `documentation` module and gates 5 to 7 to the
toolchain; the entry point runs each published command and forwards its exit
code without judging the result
([responsibilities.md](responsibilities.md) §2).

**Why the environment is sourced here.** The script dot-sources
[scripts/env.ps1](../../../scripts/env.ps1) before the first gate, so the
caller does not have to. This is the whole point of the entry point: the
preamble in [AGENTS.md](../../../AGENTS.md) §1 stops being something a session
can forget when the aggregate command is the one it runs.

**Working directory, and the residue it leaves.** The script does not change the
working directory, so the gates inherit the caller's. The cache and temporary
locations are unaffected: `env.ps1` exports them as absolute paths computed
from its own location, and those win over the relative declarations, which was
confirmed by observation — no cache or temporary directory appeared under the
subdirectory used for the test. The `python tests` gate is not protected.
Started from `docs/` on 2026-10-10, `uv run pytest -q` exited `5` ("no tests
ran") and the run reported `1 of 6 gate(s) failed in 5.7 s` — the same class of
unrelated red the entry point exists to remove. It is an open risk
([risks.md](risks.md) ENV-08); the fix is one line, setting the location to the
repository root before the first gate, and it is not in this revision.

**Output format.** One line per gate, then a summary table and a total:

```
[verify] project root: <absolute path>
[verify] transient locations confirmed in-repo by scripts/env.ps1

[verify] >> <gate name>
         PASS | FAIL (<milliseconds> ms)

[verify] summary
Gate            Ok Exit   Ms
----            -- ----   --
<gate name>   True    0  <ms>
...

[verify] all <n> gate(s) passed in <total> s
```

A failing run prints `[verify] <n> of <m> gate(s) failed in <total> s` followed
by one `  - <gate name> (exit <code>)` line per failing gate. The total is the
sum of the per-gate times, so it is slightly below the process wall time, which
also contains PowerShell start-up.

**Exit codes.**

| Code | Meaning |
|---|---|
| `0` | Every gate in the selected set passed |
| `1` | At least one gate failed; the failing gates are named with their exit codes |
| `2` | The runner could not complete: the environment contract could not be sourced, or an unexpected terminating error reached the top-level `trap` |

A gate that throws is recorded as `2` for that gate, the remaining gates still
run, and the run exits `1`. Runners never stop at the first failure, because the
state of the gates after it is part of what a reader needs.

**Native invocation.** Every external command goes through `Invoke-NativeStep`,
which relaxes `$ErrorActionPreference` for the call and pipes the tool's output
into `Out-Host`. Both halves matter: without the first, one warning line from a
package manager terminates the run; without the second, the tool's output would
join the function's return value and the caller would compare an array against
zero.

**Compatibility.** The gate names and the three exit codes are the interface.
Adding a gate is compatible; renaming one, changing what a code means, or
running the gates in a process that has not sourced the environment contract is
not (§7).

## 4. `scripts/verify-temp-isolation.ps1` — the isolation proof

### 4.1 Parameters

| Parameter | Type | Effect |
|---|---|---|
| `-StaticOnly` | switch | Runs the static phase only, then exits; used by `bootstrap.ps1` step 6 |
| `-SkipNode` | switch | Skips the npm/pnpm location checks and both Node workload steps |
| `-SkipCpp` | switch | Skips the C++ tool-build workload step |

The script sets `$ErrorActionPreference = 'Stop'` for its own process. Every
external command is invoked through `Invoke-NativeQuiet`, a local helper that
temporarily switches the preference to `Continue`, discards the child's stderr
and records its exit code separately. Without that helper, one warning line from
`pnpm` or `npm` would become a terminating error under `Stop` and the run would
report "could not complete" for an environment that was in fact isolated.

### 4.2 Static phase — check names and meaning

The static phase emits **21 checks**. The first ten are the guarded variables
in the order of `$guarded` in the script; the rest are probes and one file
read.

| Check name (exact) | Passes when |
|---|---|
| `env:LIFEGAME_ROOT`, `env:TEMP`, `env:TMP`, `env:TMPDIR`, `env:UV_CACHE_DIR`, `env:UV_PYTHON_INSTALL_DIR`, `env:PIP_CACHE_DIR`, `env:PIP_CONFIG_FILE`, `env:PYTHONPYCACHEPREFIX`, `env:npm_config_cache` | The value is an absolute path (or a UNC path), is not one of the literals a tool prints for an unknown key, and resolves inside the repository |
| `venv interpreter home` | `.venv\pyvenv.cfg` exists, its `home` value is inside the repository **and** contains `uv-python` |
| `uv cache dir`, `uv python dir` | `uv cache dir` / `uv python dir` report a path inside the repository |
| `python tempfile.gettempdir()`, `python sys.base_prefix`, `python sys.executable` | The `.venv` interpreter reports all three inside the repository |
| `npm cache (from env)` | `npm config get cache` reports a path inside the repository. The name states where the value comes from: the cache location is owned by `npm_config_cache`, and `.npmrc` declares nothing (§5.3) |
| `pnpm storeDir (declared)`, `pnpm cacheDir (declared)` | `pnpm config get storeDir` / `pnpm config get cacheDir` answer with a **relative** value that does not escape the repository when it is resolved against the repository root |
| `uv.toml cache-dir (declared)` | The `cache-dir` value in [uv.toml](../../../uv.toml), read as text, is **relative** and does not escape the repository when it is resolved against the repository root. It is read from the file rather than asked of `uv`, because a sourced session makes `uv cache dir` answer with `UV_CACHE_DIR` and would hide a bad declaration |
| `pnpm store path (resolved)` | The path `pnpm store path` actually resolves is **absolute** and inside the repository |

Two predicates are in play, and the distinction is the contract:

* **Resolved values** — every environment-variable check, every tool probe and
  `npm cache (from env)` — must be absolute and inside the repository. The
  predicate trims the value, rejects the literals `undefined`, `null`, `true`,
  `false` and `nan`, rejects anything that is not an absolute or UNC path, then
  converts with `[System.IO.Path]::GetFullPath` and compares with
  `String.StartsWith(repositoryRoot, OrdinalIgnoreCase)`. The rejection of
  non-paths is a hardening against false positives: an unknown `pnpm` key
  answers with the literal `undefined`, and `GetFullPath('undefined')` would
  otherwise resolve *inside* the repository and pass a check that verified
  nothing. The comparison remains a prefix test, not a containment test
  ([risks.md](risks.md) ENV-01).
* **Declared values** — `pnpm storeDir (declared)`, `pnpm cacheDir (declared)`
  and `uv.toml cache-dir (declared)` — must be relative, and must not escape
  the repository when joined with the repository root. An absolute declaration
  names one checkout, so a clone or a worktree would write into it.

Both forms are checked because each catches what the other misses. A
declared-only check is satisfied by a value the tool never reads; a
resolved-only check cannot tell that a correct-looking absolute path belongs to
a **different** checkout. Both failures were observed on this repository
([testing.md](testing.md) §6 rows 7 and 10).

`venv interpreter home` is read with an explicit UTF-8 decoder
(`[System.IO.File]::ReadAllText` with a UTF-8 encoding object), never with the
default decoder. The repository path contains non-ASCII characters and
PowerShell 5.1's default reader is ANSI, which would corrupt the recorded
`home` value and make a correct environment fail the check.

`pnpm storeDir (declared)`, `pnpm cacheDir (declared)` and
`pnpm store path (resolved)` are distinct checks on purpose. pnpm 10 moved
package-manager settings out of `.npmrc` into
[pnpm-workspace.yaml](../../../pnpm-workspace.yaml), so an `.npmrc`-only
declaration leaves the store on the system volume while every `.npmrc` key
still reads back as written. The resolved-store check is the one that observes
where pnpm actually writes; the declared pair is the one that observes whether
the declaration would follow a copy of the repository.

### 4.3 Dynamic phase — watched locations and workload

Watched roots, filtered to those that exist at run time:

| Scope | Roots |
|---|---|
| Recursive (package caches and interpreter payload locations on the system volume) | `%LOCALAPPDATA%\uv`, `%APPDATA%\uv`, `%LOCALAPPDATA%\pip`, `%APPDATA%\pip`, `%LOCALAPPDATA%\npm-cache`, `%APPDATA%\npm`, `%APPDATA%\pnpm`, `%USERPROFILE%\.local\bin` |
| Two levels deep | the system temporary directory (`%LOCALAPPDATA%\Temp`) |

The system temporary directory is scanned exactly two levels deep — the depth a
tool actually uses — because a full recursive scan of it is dominated by
unrelated applications' directories. The depth is a deliberate bound, not an
accident; the cost that motivates it is in [implementation.md](implementation.md)
§3.2 and [performance.md](performance.md) §7.

Workload steps, each announced before it runs:

| Step | Command | Skipped when |
|---|---|---|
| `python: temporary file` | creates and removes `lifegame-isolation-probe` in `tempfile.gettempdir()` | never |
| `python: bytecode compilation` | `compileall.compile_dir('tests', quiet=2)` | never |
| `cpp: build documentation tool` | `tools\documentation\build.ps1 -Quiet` | `-SkipCpp`, or the build script is absent (prints `[skip]`) |
| `node: temporary file` | creates and removes `lifegame-isolation-probe` in `os.tmpdir()` | `-SkipNode` |
| `node: pnpm install` | `pnpm install --silent` | `-SkipNode`, or `package.json` is absent |

A workload step that throws is reported as `[warn] <step> : <message>` and the
run continues; the scan decides the outcome, not the step's exit code. Two
exclusions apply and both are stated in
[responsibilities.md](responsibilities.md) §3.3: the harness pattern, whose
coverage gap is an open risk, and the characterised environmental class, whose
evidence is
[evidence/windows-temporary-artifact-class.md](../../../evidence/windows-temporary-artifact-class.md).

### 4.4 Output format

```
=== static phase ===
  [OK  ] env:TEMP                               <value>
  [FAIL] <check name>                           <detail>
...
static phase: <n> checks, <m> failures
PASS | FAIL
  - <check name> :: <detail>          (only on FAIL)

=== dynamic phase ===
  [run ] <step>   |   [warn] <step> : <message>   |   [skip] <step> (<reason>)
  [OK  ] no file created on the system volume   <n> unexplained of <m> changed since <UTC timestamp>
        excused as the characterised environmental class: <n> file(s)
          <path>                              (first 10 excused, when any)
        <path>                                (first 40 unexplained, only on FAIL)
        ... and <n> more
dynamic phase: scanned <n> file(s); <m> changed since the workload started, <e> excused, <u> unexplained
total: <n> checks, <m> failures
PASS | FAIL
```

The static check line is formatted with a fixed 38-character name column and the
marks `OK  ` and `FAIL`. The dynamic phase adds exactly one check, so a full
run reports **22 checks** and a `-StaticOnly` run reports **21**.

There is no proof step to report any more: the exclusion is applied per changed
path, and the only line it produces is the excused list, which names the count
and then the paths themselves.

### 4.5 Exit codes

| Code | Meaning | Emitted by |
|---|---|---|
| `0` | Isolated: every executed check passed | `exit 0` in both phases |
| `1` | A violation was found | `exit 1` in both phases, with the failure list |
| `2` | The checks could not complete | The top-level `trap`, which prints the message and the script stack trace |

The `trap` is installed before any work happens, so an unexpected terminating
error can no longer surface as the violation code. The distinction is the
contract: `1` means "isolation is broken", `2` means "this run did not decide
the question".

## 5. Configuration-file interface

### 5.1 [uv.toml](../../../uv.toml)

| Key | Value | Meaning |
|---|---|---|
| `cache-dir` | `.cache/uv`, relative | Where `uv` writes its cache when `UV_CACHE_DIR` is not set. `uv` resolves a relative value against the working directory, which [AGENTS.md](../../../AGENTS.md) §1 fixes at the repository root |
| `python-preference` | `only-managed` | The project must not bind to a system-wide interpreter |
| `compile-bytecode` | `true` | Dependency bytecode is compiled during install |

`uv.toml` accepts `cache-dir` only for location control. `python-install-dir` is
**not** a valid `uv.toml` key: `uv` 0.12.15 rejects the whole file when it is
present (measured). The interpreter payload directory is therefore controlled
exclusively by `UV_PYTHON_INSTALL_DIR` or by `--install-dir` on the command
line. [.python-version](../../../.python-version) pins the interpreter series
(`3.14`); [pyproject.toml](../../../pyproject.toml) requires Python `>=3.14` and
keeps `[tool.uv]` free of location settings, because the `uv.toml` file wins
whenever both exist.

### 5.2 [scripts/pip.ini](../../../scripts/pip.ini)

Selected through `PIP_CONFIG_FILE`, which overrides the user-level
configuration (`%APPDATA%\pip\pip.ini`) and every other pip configuration
location.

| Section | Key | Value |
|---|---|---|
| `[global]` | `cache-dir` | `.cache/pip`, relative; pip resolves it against the working directory, and `PIP_CACHE_DIR` from [scripts/env.ps1](../../../scripts/env.ps1) takes precedence |
| `[global]` | `disable-pip-version-check` | `true` |
| `[install]` | `no-warn-script-location` | `true` |

### 5.3 [.npmrc](../../../.npmrc)

The file declares **no settings**, and that is the interface. Its comments
record why:

* npm resolves a relative path against the current working directory and an
  absolute path names one specific checkout, so neither form can be committed
  without either scattering the cache or binding it to a single checkout.
* npm 11 reports the pnpm-only keys (`store-dir`, `cache-dir`) as unknown
  project configuration and writes a warning to stderr on every invocation.

The npm cache location is therefore owned solely by `npm_config_cache`, which
[scripts/env.ps1](../../../scripts/env.ps1) exports as an absolute path computed
from that script's own location. The static phase checks the value under the
name `npm cache (from env)` for exactly this reason. A key added to this file
would be an interface change (§7).

### 5.4 [pnpm-workspace.yaml](../../../pnpm-workspace.yaml)

pnpm 10 moved package-manager settings out of `.npmrc` into this file, so
`store-dir` and `cache-dir` in `.npmrc` have no effect on pnpm 12.

| Key | Value | Consumer |
|---|---|---|
| `packages` | `["."]` | the workspace root |
| `storeDir` | `.cache/pnpm-store`, relative | pnpm content-addressable store; the store itself lives one level deeper, under `pnpm-store/v11` |
| `cacheDir` | `.cache/pnpm-cache`, relative | pnpm metadata cache |

pnpm resolves both values against the **workspace root**, not against the
working directory, so the store stays inside whichever checkout is running even
when pnpm is invoked from a subdirectory. That resolution has been observed on
`pnpm@12.6.0`; it is asserted for the pinned release and is an open risk for
another major version ([risks.md](risks.md) ENV-07).

Every path value in §5.1, §5.2 and §5.4 is **relative on purpose**: an absolute
declaration names one checkout, so a `git clone` or a `git worktree` would write
into the original checkout while each copy reported itself isolated. The
resolution rules differ per tool — `uv` and pip against the working directory,
pnpm against the workspace root — and the absolute environment variables that
[scripts/env.ps1](../../../scripts/env.ps1) exports take precedence over the
declared fallbacks. The decision is
[ADR 0004](../../adr/governance-and-build/0004-cache-locations-are-checkout-relative.md);
the residue is [risks.md](risks.md) ENV-06 and ENV-07.

### 5.5 [package.json](../../../package.json) script aliases

| Alias | Command |
|---|---|
| `bootstrap` | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/bootstrap.ps1` |
| `env:verify` | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-temp-isolation.ps1` |
| `docs:validate` | `powershell -NoProfile -ExecutionPolicy Bypass -File tools/documentation/validate-documentation.ps1` |
| `docs:validate:json` | the same command with `--format json` |
| `docs:test` | `powershell -NoProfile -ExecutionPolicy Bypass -File tools/documentation/tests/run-tests.ps1` |

`engines.node` is `>=24` and `packageManager` is `pnpm@12.6.0`. The
documentation aliases belong to the `documentation` module; they are listed
here only because they share the manifest.

## 6. Smoke-run entry points

| Purpose | Command | Deciding for |
|---|---|---|
| Every gate, edit-loop set | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify.ps1` | all criteria the default set decides, as one exit code |
| Every gate including the version-boundary pair | the same command with `-Full` | adds A2 (dynamic phase) and A7 (bootstrap idempotence) |
| Provision from a clean checkout | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/bootstrap.ps1` | A7 |
| Resolved-location check only | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-temp-isolation.ps1 -StaticOnly` | A1, A3 |
| Full isolation proof | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-temp-isolation.ps1` | A1, A2, A3 |
| Same, without Node | the same command with `-SkipNode` | A1, A2 when Node is unavailable |
| Provision a clean clone, then check it | `git clone . <dir>`, then the commands above inside the clone | A11 |

## 7. Compatibility policy

| Element | Change that is compatible | Change that breaks consumers |
|---|---|---|
| Script parameters | adding a switch | renaming or removing one |
| Check names | adding a check | renaming one; the name is parsed by humans and by future CI |
| Gate names in the entry point | adding a gate | renaming one; the summary table and the failing-gate list are read by humans and by CI |
| Gate set | adding a gate to the default set, or moving one between the default set and `-Full` with the reason stated | moving a version-boundary gate out of `-Full`, which would make the edit-loop command decide a version |
| Exit codes (`verify-temp-isolation.ps1` and `verify.ps1`) | none of the three values may change meaning | reusing `1` for "could not complete", or `2` for "violation found"; in the entry point, reporting a gate that did not run as anything other than a failure |
| Published variable names | adding a guarded variable, provided `env.ps1`, `verify-temp-isolation.ps1`, `tests/environment/test_isolation_contract.py` and this file change together | renaming a variable that a configuration file quotes |
| Guard list length | growing the list | shrinking it, which removes a validated location |
| Declared cache paths | a relative declaration that resolves inside the repository | an absolute declaration, or one that escapes the repository: a copy of the checkout would write into the checkout the declaration names |
| Configuration-file settings | adding a key a tool documents as supported | adding a key the tool rejects, which invalidates the whole file, declaring a pnpm key in a file pnpm no longer reads, or adding any setting to `.npmrc` |
| Repository location | renaming, moving, cloning or forking the checkout: the declared paths are relative and need no edit | committing a value that names one checkout, which would send a copy's caches into it |
| Host requirements | raising the minimum PowerShell version in `#Requires` | dropping Windows support, which no alternative has been accepted for |
| pnpm release | any release whose relative `storeDir` still resolves against the workspace root | a release that changes that base directory or stops reading the keys; the static phase catches it, but the record has been observed on one release only |

## 8. Implemented API and planned changes

Implemented, at the paths quoted above: the four scripts, the configuration
files of §1, the ten published variables, the guard that validates all ten
before it applies, the `1` / `2` / `0` exit-code contract of both checkers, the
gate set of §3.6 and its aggregate exit code, the output formats, the
native-invocation helpers of `bootstrap.ps1` and `verify.ps1`, and the
native-tool stderr guard of the checker.

Planned, each owned by the version that owns milestone M01 in
[VERSIONS.md](../../plan/VERSIONS.md):

* The entry point will fix the working directory to the repository root before
  the first gate, so a caller who starts it elsewhere does not get an unrelated
  failure ([risks.md](risks.md) ENV-08).
* The harness exclusion pattern will be widened to cover every `dsh-` directory
  family rather than one of them ([risks.md](risks.md) ENV-04).
* The static phase will compare resolved paths as directory containment rather
  than as a string prefix ([risks.md](risks.md) ENV-01).
* The dynamic watch list will grow with the toolchain instead of staying the
  enumeration of §4.3 ([risks.md](risks.md) ENV-03).

The measured admission floors are owned by
[PERFORMANCE_ACCEPTANCE.md](../../plan/PERFORMANCE_ACCEPTANCE.md) §5; the
observations behind them are in [performance.md](performance.md) §7.
