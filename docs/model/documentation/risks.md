# documentation — risks

> **Owner.** This file owns the risks of the `documentation` module. Risk ids in
> this file are module-local (`DOC-nn`); the phase register keeps its own ids and
> stays the authority for phase risks
> ([phase-01-foundation/risks.md](../../plan/phase-01-foundation/risks.md)).
> Every risk names the version that owns it; version state lives in
> [VERSIONS.md](../../plan/VERSIONS.md).

Status: Implemented

## 1. Module risks

Owning versions name a milestone; the version is the one that owns that
milestone in [VERSIONS.md](../../plan/VERSIONS.md). DOC-06 is mitigated by work
delivered with milestone M00.

The gate runner ([scripts/verify.ps1](../../../scripts/verify.ps1)) now runs the
gates in one process, in a fixed order, which is what DOC-07 previously waited
for. DOC-07 remains open in a narrower form, described below: the runner
serialises the gates it runs, but nothing stops another process or another agent
from building the same directory at the same time.

DOC-01 was retired by `v0.1.0fix1` (its state and its evidence:
[VERSIONS.md](../../plan/VERSIONS.md) and
[dev-log/v0.1.0fix1.md](../../../dev-log/v0.1.0fix1.md)). Its history is kept in
[testing.md](testing.md) §7, and the id is not reused.

The remaining entries are scheduled into the version owning milestone M01, whose
focused plan does not name them yet, so the phase register must be updated when
it is written; the phase register remains the authority for phase-level risks.

| Id | Risk | Trigger | Impact | Mitigation | Owning version |
|---|---|---|---|---|---|
| DOC-02 | The inline link scanner's worst case is quadratic in line length: a line dominated by unmatched `[` bytes is re-scanned from each new position (see [implementation.md](implementation.md) §4.3). | A single very long line that is not a link, for example a pasted log line, a very wide table row, or a generated block. | One pathological line can dominate the run's wall time, and the cost is unbounded by file size because it depends on the longest line rather than on the byte count. | The pattern does not occur in this repository's prose and is not produced by the fixture generator; the recorded bound is `O(W²)` per such line. A single-pass scanner removes it without changing any verdict (candidate E). | the version owning milestone M01, see [VERSIONS.md](../../plan/VERSIONS.md) |
| DOC-03 | Every tracked text file is read whole and kept decoded for the entire run, including a copy of each line, so peak memory is roughly twice the total text size of the tree. | A tree whose tracked text approaches the machine's available memory, or one file that is very large. | The process is killed or the machine swaps, and the run produces no verdict; there is no streaming path and no size guard that would fail cleanly first. | Tracked extensions bound the set to documentation-sized files; the tree is small today. A size threshold with a streamed path is candidate C, and a large-file cell is planned as C9 in [performance.md](performance.md) §6.1. | the version owning milestone M01, see [VERSIONS.md](../../plan/VERSIONS.md) |
| DOC-04 | The build depends on two absolute machine paths — the CMake executable and the `w64devkit` bin directory — both hard-coded in [build.ps1](../../../tools/documentation/build.ps1), and on a C++ toolchain existing at all. | The checkout moves to a host without those paths, the portable toolchain is relocated or upgraded, or a fresh clone runs the gate entry point before the executable exists. | The gate entry point exits `2` without judging the tree, so no documentation change can be verified on that host; the failure is at the build, not at the documents. | The two constants are named in [implementation.md](implementation.md) §3 as the supported relocation point; `-SkipBuild` runs a provisioned executable; the isolation proof already treats the build as a workload. Resolving the toolchain from `PATH` with the constants as a fallback is the durable fix. | the version owning milestone M01, see [VERSIONS.md](../../plan/VERSIONS.md) |
| DOC-05 | Link checking covers a closed path set: `README.md`, `AGENTS.md`, `ENGINE_STANDARD.md` and every `.md` under `docs/`. Markdown outside that set is never link-checked. | A document is added or moved outside the set — [evidence/windows-directory-access-label.md](../../../evidence/windows-directory-access-label.md) and the version dev-log entries are already outside it. | A broken relative link in an evidence or dev-log document passes the gate, so the repository's most load-bearing records can drift silently. | The scope is stated in [interfaces.md](interfaces.md) §5 and in [tools/documentation/README.md](../../../tools/documentation/README.md); a reviewer checks the excluded set by hand. Extending the scope is a small change with a fixture consequence. | the version owning milestone M01, see [VERSIONS.md](../../plan/VERSIONS.md) |
| DOC-06 | The gate can be weakened to make a change pass: a check is relaxed, a code is dropped from the table, a fixture is adjusted to match the implementation, or the ignore list grows. | A change is blocked by a finding and the shortest route to green is taken on the tool instead of the document. | The gate stops being evidence, and every later verdict inherits the weakened check. This is phase risk R05 seen from the module. | The code set is an interface frozen by [ADR 0001](../../adr/governance-and-build/0001-single-authority-documentation-system.md): renaming or removing a code needs a superseding ADR. The fixture suite asserts each code's exact set, so removing a check fails the suite, and the ignore list is published in [interfaces.md](interfaces.md) §6 so widening it is visible in review. | the version owning milestone M00, see [VERSIONS.md](../../plan/VERSIONS.md) |
| DOC-07 | Two builds of the tool that overlap corrupt the build directory: after a build triggered from inside the isolation check ran at the same time as another build, `docguard.exe` was observed at 0 bytes with an empty `.ninja_log`. The failure is recorded as F6 in the dev-log entry that delivered the environment module. | An explicit `build.ps1 -Clean`, or two agents rebuilding a shared build directory at the same time. The trigger is **narrower than it was**: a routine gate run no longer invokes the build system when no input has changed ([implementation.md](implementation.md) §2.2), and the gate runner runs its gates sequentially in one process, so its tool-build gate and its self-test gate can no longer overlap each other. What remains is a concurrent build started outside that runner, or a `-Clean` that deletes the directory while a build is running. | A zero-byte executable that every later command reads as a broken build or a broken gate, with nothing in the output naming the run that broke it. | Do not start two builds of this directory at the same time, and do not run `-Clean` while another build is in flight. The build directory is disposable: nothing in it is an input to anything else, so removing it and rebuilding once always recovers. A lock file around the build is the durable fix. | the version owning milestone M01, see [VERSIONS.md](../../plan/VERSIONS.md) |

A risk without an owning version would be a defect
([AI_DOCUMENTATION_GUIDE.md](../../AI_DOCUMENTATION_GUIDE.md) §5.8). None is
left unowned.

## 2. Phase risks that land on this module

Summaries only; the phase register is the authority and the mitigation text
lives there ([phase-01-foundation/risks.md](../../plan/phase-01-foundation/risks.md)).

| Phase id | What it means here |
|---|---|
| R01 | A directory created outside a confined session does not carry the label a confined session needs. The module's build directory and its fixture trees are therefore created by [build.ps1](../../../tools/documentation/build.ps1) and [tests/make-fixtures.ps1](../../../tools/documentation/tests/make-fixtures.ps1), in the session that works with them, rather than by hand. |
| R02 | An unsigned script blocked by the execution policy fails silently. Applied here: a blocked [validate-documentation.ps1](../../../tools/documentation/validate-documentation.ps1) means the gate never runs, and the tree looks unchanged rather than unvalidated. The session preamble is [AGENTS.md](../../../AGENTS.md) §1. |
| R05 | The conformance gate can be weakened to make a change pass. DOC-06 is this risk stated for the module. |
| R06 | A tool that is not covered by the environment contract writes to the system volume. Applied here: the C++ build is a covered workload of the isolation proof, and it writes only inside `tools/documentation/build/`. |

## 3. Open questions

| Question | Why it is open | Owning version |
|---|---|---|
| Should link checking extend to `dev-log/` and `evidence/`? | Those documents link to each other and to phase plans; widening the scope turns DOC-05 from a known limit into a checked rule, but it also means the fixture suite needs a case that proves the widened scope and a case that proves the exclusion still holds | the version owning milestone M01, see [VERSIONS.md](../../plan/VERSIONS.md) |
| Should the two warning-severity codes stay warnings, given that a warning already fails the gate? | The severity distinction changes only the word printed and the `--strict` promotion, never the verdict; collapsing it is a change to a frozen code set and therefore an ADR decision, not an edit | the version owning milestone M01, see [VERSIONS.md](../../plan/VERSIONS.md) |
| Should the gate be run in continuous integration, where the tree is clean but the machine is slower than profile `M1`? | The budget is no longer the obstacle: the suite has roughly a factor of twenty in hand on `M1` ([testing.md](testing.md) §5). Two things still need measuring or asserting first: the cost on the CI profile, and a build from an empty build directory, which is the one path in the gate runner that no test covers ([testing.md](testing.md) §6) | the version owning milestone M01, see [VERSIONS.md](../../plan/VERSIONS.md) |
| Should compiler warnings under `-Wall -Wextra -Wpedantic` be an error? | The build is not asserted to be warning-free, so a new warning would pass unnoticed; making it an error is a build-policy decision that belongs with the toolchain pins | the version owning milestone M01, see [VERSIONS.md](../../plan/VERSIONS.md) |
