# documentation — testing

> **Owner.** This file owns what is tested, what is deliberately not tested, how
> to run the checks, the fixture layout, the failure modes the checks cover and
> the command that produced the last recorded result. The interface and its exit
> codes are owned by [interfaces.md](interfaces.md); the evidence owner is named
> by [phase-01-foundation/acceptance.md](../../plan/phase-01-foundation/acceptance.md).

Status: Implemented

## 1. Test surface

The module has no unit-test project for its C++ sources: the check functions and
the scanner's helpers live in anonymous namespaces, so they are not reachable
from a test translation unit without changing the design. The test surface is
therefore black-box, and it is deliberately **fixture-based**:

| Surface | What acts as the test |
|---|---|
| The check engine | Seventeen fixture repositories, one per case, asserted by [tests/run-tests.ps1](../../../tools/documentation/tests/run-tests.ps1) |
| The exit-code contract | The same runner asserts `0`, `1` and `2` on cases chosen to produce each |
| The determinism promise | Two runs over three fixtures, compared by SHA-256 of the decoded stdout text, computed in memory by [tests/run-tests.ps1](../../../tools/documentation/tests/run-tests.ps1) |
| The severity contract | The `--strict` case asserts that a warning becomes an error and moves from the warning count to the error count |
| The build | [build.ps1](../../../tools/documentation/build.ps1) is the build's own test: it fails loudly when the executable is not produced |
| The gate as a whole | [validate-documentation.ps1](../../../tools/documentation/validate-documentation.ps1) run against the repository, which is acceptance criterion A4 |

Each case is a **complete, layout-valid repository skeleton plus exactly one
defect**, so a negative case must produce exactly one check code. That property
is what makes the suite an assertion about the *specific* code and not merely
about "something failed".

## 2. How to run

| Purpose | Command | Expected result |
|---|---|---|
| Regenerate every fixture | `powershell -NoProfile -ExecutionPolicy Bypass -File tools/documentation/tests/make-fixtures.ps1` | exit `0`, seventeen directories under `tests/fixtures/` |
| Run the suite | `powershell -NoProfile -ExecutionPolicy Bypass -File tools/documentation/tests/run-tests.ps1` | exit `0`, `ALL PASSED (<n> assertion(s))` |
| Run the suite without rebuilding | the same command with `-SkipBuild` | the same, when the executable is present |
| Build the tool | `powershell -NoProfile -ExecutionPolicy Bypass -File tools/documentation/build.ps1` | exit `0`, `tools/documentation/build/docguard.exe` |
| Build again with no input changed | the same command with `-Quiet` | exit `0`, an `up to date` line, and no invocation of the build system |
| Force a rebuild | the same command with `-Clean` | exit `0`; the build directory is removed first, so the full build runs |
| The gate on the repository | `powershell -NoProfile -ExecutionPolicy Bypass -File tools/documentation/validate-documentation.ps1` | exit `0` on a conformant tree |
| The gate on one fixture | the same command with `-Root tools/documentation/tests/fixtures/clean` | exit `0` |
| The gate as JSON | the same command with `-Format json` | one JSON object on stdout |
| Every gate, including this suite | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify.ps1` | exit `0`, with this suite as its `gate self-tests` row; `-Full` adds the version-boundary gates |

Every session that runs any of these should first apply the process-scope
execution-policy bypass and dot-source [scripts/env.ps1](../../../scripts/env.ps1)
([AGENTS.md](../../../AGENTS.md) §1). The scripts dot-source it themselves where
they need it, so the preamble is about the environment the acceptance evidence
assumes rather than about the scripts running at all.

## 3. Fixture layout

```
tools/documentation/tests/
  make-fixtures.ps1     regenerates every tree from scratch (idempotent, ASCII-only)
  run-tests.ps1         assertions
  fixtures/
    clean/                        positive: no violation at all
    lone-cr/                      positive: a bare CR is not a CRLF line ending
    layout-missing/               negative, one per check code, fifteen in total
    path-not-english/
    crlf/
    bom/
    md-link-broken/
    status-vocab/
    placeholder/
    version-syntax/
    version-authority-leak/
    adr-naming/
    adr-sections/
    module-contract/
    module-catalog/
    lf-only-declared/
    absolute-path-in-docs/
```

Properties of the generator that a reviewer should know:

* Every tree starts from one skeleton function, so the fifteen negative cases
  differ from `clean` only by the single defect the case is named after.
* The script is ASCII-only on purpose: Windows PowerShell 5.1 would misread a
  non-ASCII literal in a BOM-less script file, so the non-ASCII path of the
  `path-not-english` case is built from code points.
* Files are written as UTF-8 without a BOM, and line endings are spelled `\n`
  explicitly, so a fixture can never inherit CRLF from the script's own encoding.
  A here-string is avoided for the same reason.
* The whole `tests/fixtures/` subtree is on the scanner's ignore list, so a
  deliberately broken fixture can never change the repository verdict.

## 4. Failure modes covered

| Failure mode | Case | Visible as |
|---|---|---|
| A mandatory path is absent or has the wrong kind | `layout-missing` | `DOC_LAYOUT_MISSING`, exit `1` |
| A path or directory name is not ASCII | `path-not-english` | `DOC_PATH_NOT_ENGLISH`, exit `1` |
| A text file uses CRLF line endings | `crlf` | `DOC_CRLF` with the count and the first line, exit `1` |
| A bare CR that is not a CRLF pair is *not* reported | `lone-cr` | exit `0`, no code |
| A text file starts with a UTF-8 BOM | `bom` | `DOC_BOM` at line 1, exit `1` |
| A relative markdown link does not resolve | `md-link-broken` | `DOC_MD_LINK_BROKEN`, exit `1` |
| A status declaration is outside the closed vocabulary | `status-vocab` | `DOC_STATUS_VOCAB`, exit `1` |
| A forbidden marker word appears in prose | the marker-word fixture of §3 (named there, and only there, because the fixture's own name is the first forbidden marker word) | `DOC_PLACEHOLDER`, exit `1` |
| A version identifier is ill-formed | `version-syntax` | `DOC_VERSION_SYNTAX`, exit `1` |
| A navigation document restates version state | `version-authority-leak` | `DOC_VERSION_AUTHORITY_LEAK`, exit `1` |
| An ADR path or number violates the contract | `adr-naming` | `DOC_ADR_NAMING`, exit `1` |
| An ADR lacks a required section | `adr-sections` | `DOC_ADR_SECTIONS`, exit `1` |
| A module directory lacks one of its eight documents | `module-contract` | `DOC_MODULE_CONTRACT`, exit `1` |
| The module catalog and the directories disagree | `module-catalog` | `DOC_MODULE_CATALOG`, exit `1` |
| The version table header is missing | `lf-only-declared` | `DOC_LF_ONLY_DECLARED`, exit `1`; with `--strict` the severity becomes `ERROR` |
| A document mentions an absolute Windows path outside a fenced block | `absolute-path-in-docs` | `DOC_ABSOLUTE_PATH_IN_DOCS`, exit `1` |
| Output is not reproducible | three cases run twice | the two decoded stdout texts hash identically |
| An option is unknown, or `--format` has an unsupported value | `--not-an-option`, `--format xml` | exit `2`, and no check runs |
| The scan root does not exist | a path under `tests/fixtures/` that is not a tree | exit `2` |

Each case is also asserted for its exit code, its exact set of unique codes and
the fact that every severity in its report is `ERROR` or `WARN`.

## 5. The last recorded result

The version-boundary record for the runner rework is
[dev-log/v0.1.0fix1.md](../../../dev-log/v0.1.0fix1.md), which owns both the
diagnosis and the before-and-after figures; the earlier boundary is
[dev-log/v0.1.0.md](../../../dev-log/v0.1.0.md), whose A5 row is the executed
record for this file's suite and whose A6 row is the executed record for the
determinism promise. The evidence owner for criteria A4, A5, A6 and A8 is the
entry named by
[acceptance.md](../../plan/phase-01-foundation/acceptance.md); the
repository-tree verdict is owned there and is not restated here.

One observation was made independently of that entry, at the revision that
carries the current runner, and is kept because an independently reproduced
result is stronger than an inherited one:

```
powershell -NoProfile -ExecutionPolicy Bypass -File tools/documentation/tests/run-tests.ps1
```

Observed on profile `M1`, 2026-10-10, three consecutive runs, no `-SkipBuild`
(the executable was present, so [build.ps1](../../../tools/documentation/build.ps1)
returned from its freshness check without invoking the build system):

| Run | Exit | Wall time | Final line |
|---|---|---|---|
| 1 | `0` | 1.62 s | `[docguard-tests] ALL PASSED (61 assertion(s))` |
| 2 | `0` | 1.55 s | the same |
| 3 | `0` | 1.47 s | the same |

The 61 assertions are 17 cases × 3 (exit code, code set, severity domain), 3
determinism comparisons, 4 `--strict` assertions and 3 usage/IO assertions —
the same count as before the runner was reworked. The run writes **no** scratch
files: each invocation's stdout is collected in memory and its stderr discarded,
and the determinism comparison hashes the decoded stdout text rather than two
files. A directory `tools/documentation/build/test-output/` from an earlier
revision may still exist under the generated build directory;
[build.ps1](../../../tools/documentation/build.ps1) `-Clean` removes it with the
rest of the build directory.

The observation has three caveats and they are part of the record:

1. The executable was present, so it proves the checks' behaviour and the
   runner's method, not the build path; a build from an empty directory is
   still unasserted (§6).
2. The suite now sits about a factor of twenty below the 30-second gate of
   [PERFORMANCE_ACCEPTANCE.md](../../plan/PERFORMANCE_ACCEPTANCE.md) §2
   ([performance.md](performance.md) §6.0), so the earlier concern that it
   might not fit is closed. It must still be repeated whenever the revision
   changes, because a number without its revision is not evidence.
3. The wall time was taken while other work was editing the same repository
   concurrently. The assertion count and the exit code are not affected by that;
   the timing is.

### 5.1 Superseded record

The following observation is kept because it is what motivated the change; it
describes a runner revision that no longer exists (it launched the executable
through `Start-Process` with redirected stdio and captured one stdout and one
stderr file per invocation under `tools/documentation/build/test-output/`).

```
powershell -NoProfile -ExecutionPolicy Bypass -File tools/documentation/tests/run-tests.ps1 -SkipBuild
```

Observed on profile `M1`, 2026-10-08: exit code `0`, final line
`[docguard-tests] ALL PASSED (61 assertion(s))`, **28.99 s** wall time, 54
captured files. The suite was then close to the 30-second gate, and the cost was
the harness rather than the tool: 27 launches at about 1.03 s each against an
executable that finishes in about 63 ms
([performance.md](performance.md) §6.0). A leftover
`tools/documentation/build/test-output/` directory, if one is present in a
working tree, is a remnant of that revision.

## 6. What is deliberately not tested

| Not tested | Why | Owner or scope decision |
|---|---|---|
| A file that exists but cannot be read (exit `2`) | The case needs a lock or a permission change created at run time, because an unreadable file cannot be committed | the version owning milestone M01, see [VERSIONS.md](../../plan/VERSIONS.md) |
| `-h` / `--help` and the usage text | Not asserted by the runner, although the exit code `0` was observed by hand | the version owning milestone M01, see [VERSIONS.md](../../plan/VERSIONS.md) |
| The `--root=<dir>` and `--format=<value>` assignment forms | The suite only exercises the space-separated forms | the version owning milestone M01, see [VERSIONS.md](../../plan/VERSIONS.md) |
| `--quiet` stream routing | Nothing asserts that the summary moves to stdout and that no violation line is printed | the version owning milestone M01, see [VERSIONS.md](../../plan/VERSIONS.md) |
| Violation messages and line numbers | The runner asserts codes and exit codes, never message text or a line number, so a message may change without a test failing | the version owning milestone M01, see [VERSIONS.md](../../plan/VERSIONS.md) |
| The non-ASCII root round trip | Exercised implicitly by every run, because this repository's own path is not ASCII and the fixtures live below it; nothing asserts the round trip itself | the version owning milestone M01, see [VERSIONS.md](../../plan/VERSIONS.md) |
| A build from scratch, and the wrapper's build-on-demand path | The suite is run against an existing executable; `build.ps1 -Clean` and the auto-build branch of [validate-documentation.ps1](../../../tools/documentation/validate-documentation.ps1) are unasserted | the version owning milestone M01, see [VERSIONS.md](../../plan/VERSIONS.md) |
| Compiler diagnostics under `-Wall -Wextra -Wpedantic` | The build is asserted to produce the executable, not to be warning-free | the version owning milestone M01, see [VERSIONS.md](../../plan/VERSIONS.md) |
| Large files, the quadratic link-scanner line and peak memory | The fixture generator produces documentation-sized files only; the cases are listed as C6 to C12 in [performance.md](performance.md) §6.1 | the version owning milestone M01, see [VERSIONS.md](../../plan/VERSIONS.md) |
| The rebuild path of the build freshness check | Neither branch is asserted: nothing proves that an artifact older than its inputs is rebuilt, and nothing proves that a fresh one is left alone. Both were verified by hand on 2026-10-10 — advancing the modification time of `src/main.cpp` produced a 6.08 s rebuild with the artifact's time advanced, and an unchanged tree produced an `up to date` line in 0.33 s to 0.39 s | the version owning milestone M01, see [VERSIONS.md](../../plan/VERSIONS.md) |
| Two concurrent runs of the gate | Nothing in the tool needs locking, because it writes nothing below the scan root; a concurrent run is not part of any criterion | scope decision, no version scheduled |
| Non-Windows hosts | Profile `M1` is the only declared profile and it is Windows ([PERFORMANCE_ACCEPTANCE.md](../../plan/PERFORMANCE_ACCEPTANCE.md) §1) | scope decision, no version scheduled |
| The full-repository verdict | It is acceptance criterion A4, decided by the gate command and recorded in the dev-log, not by this suite | [acceptance.md](../../plan/phase-01-foundation/acceptance.md) |

A coverage gap stays in this table until the version that owns it closes it. A
check that was not run is never reported as a passing check.

## 7. Defects found and fixed inside this version

A defect that is fixed does not vanish from the record; it moves here from
[risks.md](risks.md), which lists open risks only. A retired id is not reused.

| Id | Defect | How it was found | Fix | How the fix is verified |
|---|---|---|---|---|
| DOC-01 | The fixture suite's wall time sat close to the 30-second gate: 28.99 s for 61 assertions, of which about 27.8 s was PowerShell process plumbing — 27 `Start-Process` launches at about 1.03 s each, against an executable that finishes in about 63 ms. | The suite's wall time was recorded together with its assertion count while measuring the module ([performance.md](performance.md) §6.0). | [tests/run-tests.ps1](../../../tools/documentation/tests/run-tests.ps1) calls the executable directly, takes the exit code from `$LASTEXITCODE` and the report from the output stream under a locally relaxed `$ErrorActionPreference`, and compares the decoded stdout text in memory. The `Start-Process` plumbing, the retry loop and the captured-output directory are gone. | Three consecutive runs at 1.62 / 1.55 / 1.47 s, the same 61 assertions, exit `0` (§5). The item is retired from [risks.md](risks.md). |

A second cost was removed in the same round without being a defect:
[build.ps1](../../../tools/documentation/build.ps1) ran the build system
unconditionally, and the driver costs 4.26 s before it can decide that nothing
changed. The freshness check that replaced it is a design change rather than a
repair, and it is recorded in [performance.md](performance.md) §6.0 and §8
candidate H.
