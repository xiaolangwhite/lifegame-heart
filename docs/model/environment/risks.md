# environment — risks

> **Owner.** This file owns the risks of the `environment` module that are
> still open. Risk ids in this file are module-local (`ENV-nn`); the phase
> register keeps its own ids and stays the authority for phase risks
> ([phase-01-foundation/risks.md](../../plan/phase-01-foundation/risks.md)).
> Every risk names the version that owns it; version state lives in
> [VERSIONS.md](../../plan/VERSIONS.md). Defects that were found and fixed
> inside this version are not risks: their record is
> [testing.md](testing.md) §6. The structural decision behind the current cache
> declarations is [ADR 0004](../../adr/governance-and-build/0004-cache-locations-are-checkout-relative.md).

Status: Implemented

## 1. Open module risks

| Id | Risk | Trigger | Impact | Mitigation | Owning version |
|---|---|---|---|---|---|
| ENV-01 | The inside-repository predicate is a case-insensitive `String.StartsWith` prefix test on the resolved path. It still rejects non-paths and relative values, but it does not compare path segments. | A sibling directory whose name extends the repository root string, for example the root name with a suffix appended, appears in a configuration value or in a tool's answer. | A location outside the repository passes the check, so a real violation is reported as isolation. | Compare with a trailing directory separator, or use a containment test on path segments rather than on the string; the predicate is one function and the change is local to [scripts/verify-temp-isolation.ps1](../../../scripts/verify-temp-isolation.ps1). | the version owning M00, see [VERSIONS.md](../../plan/VERSIONS.md) |
| ENV-03 | The dynamic watch list is a closed enumeration: eight recursive package-cache roots plus the system temporary directory at two levels. | A tool writes to a system-volume location that is not on the list, for example a machine-wide application-data directory, or a tool starts using a deeper layout under the system temporary directory. | The check reports isolation while an artifact exists outside the repository. | Treat the list as data that grows with the toolchain: every tool added to the environment contract names the locations it writes to, and the list and [interfaces.md](interfaces.md) §4.3 are extended in the same change. | the version owning M00, see [VERSIONS.md](../../plan/VERSIONS.md) |
| ENV-04 | The harness exclusion pattern covers one family of the harness's temporary directories, and the watched system temporary directory is shared with every other application on the machine. | Any process that is not this project writes a file into a watched location during the workload window: a `dsh-workspace-changes-*`, `dsh-subprocess-*`, `dsh-spill-*` or `dsh-acl-*` capture, or an unrelated application's log. | A false `FAIL`: the check reports a file no project tool wrote as a project artifact. Observed once — one `verify.ps1 -Full` run exited `1` on the full isolation gate, and four later `-Full` runs and two standalone full runs exited `0`. | Widen the pattern to every `dsh-` family, for example by matching the first path segment below the system temporary directory instead of a fixed name shape; until then, read the reported path before treating it as a project artifact. The measured coverage gap, the 46-directory sample and the third-party writer are [testing.md](testing.md) §5.6. | the version owning M00, see [VERSIONS.md](../../plan/VERSIONS.md) |
| ENV-05 | The in-repository cache tree has no retention contract. Two interpreter payload directories and a `.temp` staging directory were observed under `.cache/uv-python/`, while `.venv\pyvenv.cfg` binds to one of them. | A `uv` upgrade, a second `uv python install`, or a partially completed install. | Disk growth inside the repository with no owner; which payload is used is decided by `uv` resolution rather than by the repository, and the `venv interpreter home` check accepts any path containing `uv-python`. | Keep the payload directory pinned by `UV_PYTHON_INSTALL_DIR` and `--install-dir`; state a prune procedure as a human action; record the observed state of the directory with every check run. | the version owning M00, see [VERSIONS.md](../../plan/VERSIONS.md) |
| ENV-06 | The declared `cache-dir` values in [uv.toml](../../../uv.toml) and [scripts/pip.ini](../../../scripts/pip.ini) are repository-relative, and both `uv` and pip resolve a relative value against the **current working directory**, not against the file that declares it. | A toolchain command is started from a subdirectory of the checkout instead of the repository root. | The cache is still inside the checkout, so the isolation claim holds, but a second cache tree appears under that subdirectory, it is in no documented location, and the effective cache differs between invocations. | [AGENTS.md](../../../AGENTS.md) §1 fixes the working directory at the repository root; `UV_CACHE_DIR` and `PIP_CACHE_DIR`, exported by [scripts/env.ps1](../../../scripts/env.ps1) as absolute paths computed from the script's own location, take precedence over the declared fallback; the static phase reads the declared value and requires it to be relative and inside the repository. | the version owning M01, see [VERSIONS.md](../../plan/VERSIONS.md) |
| ENV-07 | The relative `storeDir` and `cacheDir` in [pnpm-workspace.yaml](../../../pnpm-workspace.yaml) are resolved by pnpm against the workspace root. That resolution was measured only on `pnpm@12.6.0`; another major version could change the base directory or stop reading the keys. | pnpm is upgraded, or a command runs under a different pnpm than the one `package.json` pins. | The store and metadata cache could land outside the repository, or the declared keys could stop being read while still reading back correctly — the failure shape of [testing.md](testing.md) §6 row 7, where the declaration was inert and only the resolved path exposed it. | The static phase checks the declared values **and** the resolved `pnpm store path`, so a version change that moves the store fails the check rather than passing it; a pnpm upgrade re-runs the static phase and re-verifies [interfaces.md](interfaces.md) §5.4. | the version owning M01, see [VERSIONS.md](../../plan/VERSIONS.md) |

| ENV-08 | [scripts/verify.ps1](../../../scripts/verify.ps1) does not change the working directory, so every gate inherits the caller's. `uv run pytest -q` then exits `5` ("no tests ran") and the run reports a failure unrelated to the change under test. | The entry point is started from anywhere other than the repository root — from a subdirectory, or by a tool that sets its own working directory. | The edit-loop gate goes red for an unrelated reason, which is exactly the failure the entry point was introduced to remove, and the temptation is to start ignoring the suite. | [AGENTS.md](../../../AGENTS.md) §1 fixes the working directory at the repository root, and the environment's cache and temporary locations are exported as absolute paths — confirmed unaffected by the recorded run, in which no cache or temporary directory appeared under the subdirectory ([testing.md](testing.md) §5.6). The durable fix is one line: set the location to the repository root before the first gate. | the version owning M01, see [VERSIONS.md](../../plan/VERSIONS.md) |

Risk id `ENV-02` is **retired, not reused**. It named the machine-bound absolute
cache declarations, which were removed from every configuration file after a cold
clone proved they sent a copy's caches into the original checkout. The decision
is [ADR 0004](../../adr/governance-and-build/0004-cache-locations-are-checkout-relative.md);
the defect and its re-verification are [testing.md](testing.md) §6.

The per-run re-earning of the environmental exclusion was `ENV-04` in an earlier
revision of this file. It is no longer a risk but a fixed defect: the mechanism
was replaced by a class characterised once with recorded evidence
([testing.md](testing.md) §6 row 11). The `ENV-04` id now names the residue that
the replacement leaves behind — a shared directory in which other processes
write files of shapes the check does not excuse.

## 2. Phase risks that land on this module

Summaries only; the phase register is the authority and the mitigation text
lives there ([phase-01-foundation/risks.md](../../plan/phase-01-foundation/risks.md)).

| Phase id | What it means here |
|---|---|
| R01 | A directory created outside a confined session does not carry the label a confined session needs. This is why every directory is created by [scripts/bootstrap.ps1](../../../scripts/bootstrap.ps1) inside the session that works with it, and why [responsibilities.md](responsibilities.md) §1 makes that a claim of this module. |
| R02 | An unsigned script blocked by the execution policy fails silently, and the outcome is a system-volume fallback with no error at the point of use. The module's answer is the guard plus the isolation check, and the session preamble in [AGENTS.md](../../../AGENTS.md) §1. |
| R03 | A Node package manager resolves its store on the system volume when no project configuration applies. [pnpm-workspace.yaml](../../../pnpm-workspace.yaml) is committed for exactly this reason, and the static phase asserts the resolved store. |
| R04 | A relative cache path is resolved against a directory chosen by the tool rather than by the configuration file. This module declares relative cache paths deliberately, because the alternative bound each cache to one checkout; `UV_CACHE_DIR` and `PIP_CACHE_DIR` from [scripts/env.ps1](../../../scripts/env.ps1) are absolute and take precedence, [AGENTS.md](../../../AGENTS.md) §1 fixes the working directory at the repository root, and pnpm resolves a relative store against the workspace root. ENV-06 and ENV-07 record the residue. |
| R06 | A tool that is not covered by the environment contract writes to the system volume. The module's rule is that the tool, the guard entry and [interfaces.md](interfaces.md) change together; ENV-03 is the corresponding blind spot in the check. |

## 3. Open questions

| Question | Why it is open | Owning version |
|---|---|---|
| Should the guard cover variables that no criterion names? | Acceptance criterion A3 names nine variables and the guard already covers ten; a general rule would need a way to enumerate a tool's transient locations without guessing, and no such mechanism exists for tools that only read their configuration files. | the version owning M00, see [VERSIONS.md](../../plan/VERSIONS.md) |
| Is a second interpreter payload under `.cache/uv-python/` acceptable, and who prunes it? | ENV-05 records the observation; a retention policy needs a decision about which payload the repository intends to bind to. | the version owning M01, see [VERSIONS.md](../../plan/VERSIONS.md) |
| Should the harness exclusion be a pattern on the first path segment below the system temporary directory, rather than on the shape of the directory name? | The current pattern is a name-shape match that covers one family of several (ENV-04); a segment-prefix rule would cover every `dsh-` family and would still report anything else. The trade-off is that a future harness naming change would be silently covered rather than visible in review | the version owning M00, see [VERSIONS.md](../../plan/VERSIONS.md) |
| Should the entry point change the working directory, or should each gate become location-independent? | Changing the location is one line and fixes only the gates that depend on it; making the gates location-independent is a property of each gate and belongs to its owner. The recorded run (ENV-08) does not distinguish the two | the version owning M01, see [VERSIONS.md](../../plan/VERSIONS.md) |
| Does pnpm keep resolving a relative `storeDir` against the workspace root across major versions? | The behaviour is documented for the measured release and asserted by the check, but only `pnpm@12.6.0` has been observed; ENV-07 is the risk, and a version sweep would close the question. | the version owning M01, see [VERSIONS.md](../../plan/VERSIONS.md) |
| Should the dynamic phase run in CI, where the machine is quiet but the watched profile is empty? | An empty watched set makes the dynamic phase vacuous; a CI-specific watched set is a different check, and it has not been designed. | the version owning M01, see [VERSIONS.md](../../plan/VERSIONS.md) |

## 4. Where the fixed defects went

The defects this version found and fixed — the automatic-variable collision, the
missing exit code `2`, the guard running after the apply loop, the unguarded
published variables, the inert pnpm store declaration, the false-positive
predicate, the native-stderr abort, the ANSI read of `pyvenv.cfg`, the
two-snapshot dynamic phase, the bootstrap abort on a clean checkout, the
checkout-bound absolute cache declarations, and the per-run re-earning of the
environmental exclusion — are recorded in [testing.md](testing.md) §6 with their
discovery method, their fix and their re-verification. They were closed rather
than deleted, because a defect that leaves no trace is a defect that returns.
