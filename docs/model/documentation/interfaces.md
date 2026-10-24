# documentation — interfaces

> **Owner.** This file owns the complete public surface of the `documentation`
> module: the executable's arguments, its output contract, its exit codes, the
> stable check-code set and the compatibility policy. The authoritative table
> that gives each check code its severity and its firing condition is
> [tools/documentation/README.md](../../../tools/documentation/README.md); the
> component list is owned by [internal-components.md](internal-components.md).

Status: Implemented

## 1. Surface inventory

The module has no importable package. Its public surface is one executable, four
PowerShell entry points and the check-code set.

| Surface | Kind | Consumer |
|---|---|---|
| `tools/documentation/build/docguard.exe` | native executable, the whole contract | the wrapper, the test runner, a human running the gate by hand |
| [validate-documentation.ps1](../../../tools/documentation/validate-documentation.ps1) | gate entry point, five optional parameters, builds when necessary, forwards the exit code | [AGENTS.md](../../../AGENTS.md) §4, [acceptance criteria](../../plan/phase-01-foundation/acceptance.md) A4, A6, A8, the `docs:validate` script alias, the gate runner |
| [build.ps1](../../../tools/documentation/build.ps1) | Release build behind a timestamp freshness check, three optional parameters | a new checkout, the isolation proof's C++ workload step, the gate runner's tool-build gate |
| [tests/run-tests.ps1](../../../tools/documentation/tests/run-tests.ps1) | fixture test runner, one optional parameter, writes no scratch files | [acceptance criterion](../../plan/phase-01-foundation/acceptance.md) A5, the `docs:test` script alias, the gate runner's self-test gate |
| [tests/make-fixtures.ps1](../../../tools/documentation/tests/make-fixtures.ps1) | fixture generator, no parameters | a fixture regeneration after the rule set changes |
| The fifteen check codes | stable identifiers carried in every report | any consumer that reacts to a specific defect |

The executable is the contract. The wrapper, the build script and the test
runner are conveniences with their own parameter sets, documented in §7 to §9;
none of them narrows or widens what the executable decides.

## 2. Command line

```
docguard [--root <dir>] [--format text|json] [--strict] [--quiet]
docguard -h | --help
```

| Option | Argument | Default | Effect |
|---|---|---|---|
| `--root <dir>` | a directory path | the process's current working directory | the tree to validate; also accepted as `--root=<dir>` |
| `--format text\|json` | `text` or `json` | `text` | the report format; also accepted as `--format=<value>` |
| `--strict` | none | off | every warning is reported and counted as an error |
| `--quiet` | none | off | text format only: print the summary line and nothing else |
| `-h`, `--help` | none | — | print the usage text and exit `0` |

Parsing rules that a consumer can rely on:

* An unknown option, an unexpected positional argument, a missing option value
  and an empty `--root` value are all usage errors: exit `2`, no check runs.
* `--format` accepts exactly `text` and `json`; any other value is a usage
  error.
* `-h` and `--help` short-circuit parsing: everything after them is ignored, and
  the exit code is `0`.
* `--quiet` is inert when `--format json` is in effect: the JSON branch is
  chosen first, and the summary still goes to stderr.
* The root is resolved to an absolute, lexically normalised path before the
  scan. On Windows the entry point is a wide-character `main`, so a root that
  contains non-ASCII characters survives the command line intact.

## 3. Output contract

### 3.1 Text format

One line per violation on stdout:

```
<severity> <CODE> <relative-path>[:<line>] <message>
```

* `severity` is `ERROR` or `WARN`.
* `relative-path` is relative to the scan root and uses `/` separators.
* the `:<line>` suffix is omitted when the finding is not tied to a line (the
  JSON report carries `0` for those).
* `message` is human-readable prose. It is not a machine interface: consumers
  key on the check code, never on the message text.

### 3.2 JSON format

One object on stdout, followed by a newline:

```json
{"root":"<absolute scan root>","violations":[{"severity":"ERROR","code":"DOC_CRLF","path":"docs/x.md","line":3,"message":"..."}],"counts":{"error":1,"warn":0}}
```

* Field order is fixed as above, per object and per violation.
* `line` is `0` for a whole-file finding.
* `path` is relative to the scan root with `/` separators.
* `counts.error` and `counts.warn` count the reported violations after
  `--strict` promotion.
* `root` is the resolved scan root rendered with `/` separators.

### 3.3 Ordering and determinism

Violations are sorted by `(path, line, code, message)` and exact duplicates —
same severity, code, path, line and message — are removed. Two runs over an
unchanged tree therefore produce byte-identical stdout, which is what
[acceptance criterion](../../plan/phase-01-foundation/acceptance.md) A6 compares.
The order is stable across platforms and does not depend on the order in which
checks run.

### 3.4 Streams

| Output | text | json | quiet |
|---|---|---|---|
| Violation lines | stdout | stdout (the JSON object) | not printed |
| Summary line | stderr | stderr | stdout |

The summary line is:

```
docguard: <E> error(s), <W> warning(s), <V> violation(s); scanned <N> entries under <absolute root>
```

`V` is `E + W`. `N` is the number of non-ignored entries the scan enumerated,
which makes the summary the diagnostic that says how much tree the verdict
covers.

## 4. Exit codes

| Code | Meaning | Decided by |
|---|---|---|
| `0` | no violation of any severity; the tree is conformant | the violation list is empty and no IO failure occurred |
| `1` | at least one violation, error or warning | the violation list is non-empty |
| `2` | the tree was not fully judged: a usage error, an IO error or an internal error | argument parsing, scan-root validation or an unreadable file |

| Precedence rule | Consequence |
|---|---|
| An IO failure outranks a violation | A run that both found violations and failed to read a file exits `2`; the violations are printed first |
| A warning is a firing check code | A warning-only run exits `1`; this is why `--strict` changes severities and counts but not the verdict |
| A missing path is not an IO error | Whether a path must exist is the layout rule's business; the reader reports only what it could not read |

## 5. The check-code interface

The code set is part of the module's contract; the authority for each code's
severity and firing condition is
[tools/documentation/README.md](../../../tools/documentation/README.md). The
identifiers, in the order the families are applied:

| Family | Codes |
|---|---|
| Required layout | `DOC_LAYOUT_MISSING` |
| Paths and bytes | `DOC_PATH_NOT_ENGLISH`, `DOC_CRLF`, `DOC_BOM` |
| Markdown bodies | `DOC_MD_LINK_BROKEN`, `DOC_STATUS_VOCAB`, `DOC_PLACEHOLDER`, `DOC_ABSOLUTE_PATH_IN_DOCS` |
| Version authority | `DOC_VERSION_SYNTAX`, `DOC_VERSION_AUTHORITY_LEAK`, `DOC_LF_ONLY_DECLARED` |
| ADRs | `DOC_ADR_NAMING`, `DOC_ADR_SECTIONS` |
| Module contracts | `DOC_MODULE_CONTRACT`, `DOC_MODULE_CATALOG` |

Two of the fifteen carry the warning severity; the rest are errors. A warning
still fails the gate — see §4 — so `--strict` is a reporting option, not a
severity policy.

`DOC_PLACEHOLDER` and `DOC_ABSOLUTE_PATH_IN_DOCS` are the only codes with a
fenced-code-block exemption. Link resolution and the status vocabulary are
applied to every line of an in-scope file, including lines inside a fence.

### 5.1 What each rule family covers

The scope of a family is part of its contract: a file outside the scope is not
judged by that family and cannot fire its code.

| Family | Files it examines |
|---|---|
| Required layout | no file: it tests the existence and the kind of the mandatory paths |
| Path and directory names | every non-ignored entry, files and directories |
| Line endings and byte order mark | every non-ignored file whose extension is one of `md`, `json`, `toml`, `ps1`, `py`, `ini`, `cfg`, `txt`, `mjs`, `js`, `ts`, `yaml`, `yml` |
| Markdown links, status vocabulary, marker words | `README.md`, `AGENTS.md`, `ENGINE_STANDARD.md` and every `.md` file under `docs/` |
| Absolute Windows paths in prose | every `.md` file under `docs/` |
| Version syntax and the version table | `docs/plan/VERSIONS.md` |
| Version authority leaks | `README.md`, `docs/README.md`, `docs/plan/README.md`, `docs/plan/ROADMAP.md`, `docs/MODULE_FLOW_GUIDE.md` |
| ADR naming and sections | every `.md` under `docs/adr/` except a `README.md` |
| Module contract and catalog | every direct child directory of `docs/model/` whose name does not start with `.` and which does not contain its own `README.md`, plus `docs/model/module-catalog.json` |

A `.md` file outside the two markdown rows — an `evidence/` document, a dev-log
entry, a file under `tools/` — is never examined for links, status vocabulary or
marker words. That limit is stated in the tool's own README as a known gap, and
[risks.md](risks.md) DOC-05 owns it.

## 6. Ignored paths

These prefixes are never scanned, and the ignore list is part of the verdict
contract because it decides what the verdict covers:

```
.git  .venv  node_modules  __pycache__  .cache
.pytest_cache  .ruff_cache  .mypy_cache  TEMP
tools/documentation/build
tools/documentation/tests/fixtures
```

The first nine are version-control metadata, package payloads and redirected
caches; the last two keep the tool's own build output and its deliberately
broken fixture trees out of the repository verdict. Everything else below the
scan root is scanned. The list is a closed enumeration and is stated here on
purpose: adding a prefix changes verdicts for a tree, so it is an interface
change and not an implementation detail.

## 7. `validate-documentation.ps1` — the gate entry point

| Parameter | Type | Effect |
|---|---|---|
| `-Root` | string | the tree to validate; a relative value is resolved against the repository root; defaults to the repository root |
| `-Format` | `text` or `json` | forwarded as `--format`; defaults to `text` |
| `-Strict` | switch | forwarded as `--strict` |
| `-Quiet` | switch | forwarded as `--quiet` |
| `-SkipBuild` | switch | do not build when the executable is missing |

* It resolves the repository root from its own location, dot-sources
  [scripts/env.ps1](../../../scripts/env.ps1) when that file exists, and builds
  the executable when it is missing and `-SkipBuild` was not given.
* It forwards the executable's exit code unchanged, so `0`, `1` and `2` mean to
  a caller exactly what they mean in §4. A failed build is also `2`.
* It relaxes `$ErrorActionPreference` around the native call only, because the
  executable writes its summary line to stderr and a native command's stderr
  must not become a terminating PowerShell error on a clean tree.

## 8. `build.ps1` — the build

| Parameter | Type | Effect |
|---|---|---|
| `-Configuration` | `Release`, `Debug` or `RelWithDebInfo` | the CMake build type; defaults to `Release` |
| `-Clean` | switch | removes the build directory first |
| `-Quiet` | switch | suppresses tool output |
| (exit code) | — | `0` on success; a thrown terminating error otherwise |

* It configures only when `CMakeCache.txt` is absent.
* It is idempotent in the stronger sense: when the artifact is not older than
  every input under `src/` plus `CMakeLists.txt`, it reports `up to date` and
  exits `0` **without invoking the build system**. `-Clean` removes the build
  directory first and therefore always rebuilds; there is no switch that forces a
  rebuild in place, and that is the contract rather than an oversight.
* The artifact is always `tools/documentation/build/docguard.exe`.
* It dot-sources [scripts/env.ps1](../../../scripts/env.ps1), so every
  intermediate stays inside the repository tree.

## 9. `tests/run-tests.ps1` and `tests/make-fixtures.ps1`

| Surface | Parameter | Effect |
|---|---|---|
| [tests/run-tests.ps1](../../../tools/documentation/tests/run-tests.ps1) | `-SkipBuild` | do not build when the executable is missing |
| [tests/run-tests.ps1](../../../tools/documentation/tests/run-tests.ps1) | (exit code) | `0` when every assertion passed, `1` when any failed, `2` when it could not run |
| [tests/make-fixtures.ps1](../../../tools/documentation/tests/make-fixtures.ps1) | none | regenerates all seventeen fixture trees from scratch |

`run-tests.ps1` writes no files: each invocation's stdout is collected in memory
and its stderr is discarded, and the determinism comparison hashes the decoded
stdout text. Under the build directory only the executable and the CMake state
remain; the evidence layer is the dev-log under the repository root, not anything
this runner produces.

## 10. Implemented surface and planned surface

**Implemented**, at this revision: everything in §1 to §9 — the command line,
both report formats, the summary line, the three exit codes, the fifteen check
codes, the ignore list, and the four PowerShell entry points with their
parameters.

**Planned**: nothing at this revision. No check code is added, removed or
renamed, no command line option is added, and none of the three exit-code
meanings changes. The code set is frozen by
[ADR 0001](../../adr/governance-and-build/0001-single-authority-documentation-system.md),
and the one repository-level interface that touches this module is outside it:
the gate runner, [scripts/verify.ps1](../../../scripts/verify.ps1), invokes
[validate-documentation.ps1](../../../tools/documentation/validate-documentation.ps1)
with `-Quiet` and [tests/run-tests.ps1](../../../tools/documentation/tests/run-tests.ps1)
as two of its gates, and consumes their exit codes unchanged. The runner adds no
parameter to this surface, reinterprets no exit code and changes no report.

A future change to this surface is a change to this file in the same work item,
with the affected module documents and the phase acceptance criteria
([DOCUMENTATION_RULES.md](../../DOCUMENTATION_RULES.md) §10).

## 11. Compatibility policy

| Element | Compatible change | Breaking change |
|---|---|---|
| Check codes | adding a code, with a fixture and a README row | renaming, removing or re-scoping one; that needs a superseding ADR |
| Command line | adding an option with a default that preserves current behaviour | changing a default, removing an option, or reinterpreting an existing one |
| Exit codes | none: `0`, `1` and `2` keep their meanings | reusing `2` for a judged tree, or `1` for an incomplete run |
| Text line format | message prose, which no consumer may parse | changing the field order or the `:<line>` convention |
| JSON report | adding a field | removing a field, reordering the fixed fields, or changing the meaning of `line` `0` |
| Ordering | none that a byte-comparing consumer would see | any change to the sort key or the duplicate rule |
| Summary line | prose after the counts | changing the counts or dropping the scanned-entry number |
| Ignore list | none that is silent: every change is an interface change | adding a prefix that makes a previously reported tree clean |
| Host requirements | raising the declared toolchain versions with the build tested at the new version | dropping Windows support, which no alternative has been accepted for |
| Build output location | none: the artifact path is quoted by scripts and documents | moving `tools/documentation/build/docguard.exe` |
