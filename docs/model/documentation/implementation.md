# documentation — implementation

> **Owner.** This file owns how the `documentation` module is built: its file
> layout, the build and its toolchain, its configuration and relocation, the
> algorithms that matter with their complexity bounds, and the structural
> choices with the alternatives that were rejected. The component view is owned
> by [internal-components.md](internal-components.md); the public surface by
> [interfaces.md](interfaces.md); the measured behaviour by
> [performance.md](performance.md).

Status: Implemented

## 1. Layout

```
tools/documentation/
  CMakeLists.txt                    the target: fourteen translation units, C++20
  README.md                         the check-code table and the interpretation decisions
  build.ps1                         Release build behind a timestamp freshness check
  validate-documentation.ps1        the gate entry point
  src/
    main.cpp                        entry point; wmain on Windows; exit code
    cli.cpp / cli.hpp               option parsing and usage text
    model.hpp                       Severity, Violation, code constants, ViolationSink
    report.cpp / report.hpp         text, JSON and summary rendering
    repo_scan.cpp / repo_scan.hpp   traversal, ignore list, cached reads, path conversion
    text_file.cpp / text_file.hpp   BOM and CRLF detection, LF split, fence tracking
    json_value.cpp / json_value.hpp dependency-free JSON reader with line numbers
    strutil.cpp / strutil.hpp       ASCII-aware string helpers
    rules.hpp                       the check contract and the run entry point
    rules_common.cpp                check order and shared path predicates
    rules_layout.cpp                DOC_LAYOUT_MISSING
    rules_text.cpp                  DOC_PATH_NOT_ENGLISH, DOC_CRLF, DOC_BOM
    rules_markdown.cpp              links, status vocabulary, marker words, absolute paths
    rules_version.cpp               version syntax, authority leaks, the version table
    rules_adr.cpp                   ADR naming and required sections
    rules_module.cpp                the module contract and the module catalog
  tests/
    make-fixtures.ps1               regenerates all seventeen fixture trees
    run-tests.ps1                   assertions over the fixtures
    fixtures/                       seventeen fixture repositories, ignored by the scan
  build/                            generated: the executable and the CMake state
```

Fourteen `.cpp` files are compiled into one executable; the headers are not a
public interface and are not installed. `src/` holds about two thousand non-blank
lines across twenty-two files.

The layout is the tooling form of
[DOCUMENTATION_RULES.md](../../DOCUMENTATION_RULES.md) §5: one directory per
tool, built by CMake, with no package under `src/lifegame/` and therefore
nothing that Python or Node code could import.

## 2. Build

### 2.1 Toolchain

| Element | Value | Where it is fixed |
|---|---|---|
| Language standard | C++20, extensions off | [CMakeLists.txt](../../../tools/documentation/CMakeLists.txt) |
| Compiler | GCC 16.1.0 from the portable `w64devkit` distribution | [build.ps1](../../../tools/documentation/build.ps1) |
| Build system | CMake 4.4.2 with the Ninja generator | [build.ps1](../../../tools/documentation/build.ps1) |
| Build types | `Release` (default), `Debug`, `RelWithDebInfo` | [build.ps1](../../../tools/documentation/build.ps1) parameter |
| Warnings | `-Wall -Wextra -Wpedantic` | [CMakeLists.txt](../../../tools/documentation/CMakeLists.txt) |
| Linkage | static runtime: `-static -static-libgcc -static-libstdc++`, plus `-municode` | [CMakeLists.txt](../../../tools/documentation/CMakeLists.txt) |
| Artifact | `tools/documentation/build/docguard.exe` | `RUNTIME_OUTPUT_DIRECTORY` |

The static link is why the executable runs on a machine that has no MinGW
runtime on its search path: it was observed at 3,244,219 bytes at this revision.
`-municode` is the reason the Windows entry point is `wmain` rather than `main`,
which in turn is what lets a scan root such as this repository's own path — whose
name is not ASCII — survive the round trip through the command line.

### 2.2 Commands

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
Set-Location '<repo>'
. .\scripts\env.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File tools/documentation/build.ps1
```

`build.ps1` sources [scripts/env.ps1](../../../scripts/env.ps1) itself, so the
build works from a session that has not applied the preamble. It configures only
when `CMakeCache.txt` is absent; `-Clean` removes the build directory first and
`-Quiet` suppresses tool output.

Idempotence here means something stronger than "safe to run twice". Before
touching the build system the script compares the artifact's modification time
against the newest file under `src/` plus `CMakeLists.txt`, and when the artifact
is not older it returns without invoking the build system at all. The reason is
measured: `cmake --build` costs 4.26 s on this machine before it can decide that
there is nothing to do, so an unconditional call made every gate run pay for a
build that changed nothing. A caller that wants a build regardless of
timestamps passes `-Clean`.

### 2.3 What the build depends on

| Dependency | Kind | Consequence of its absence |
|---|---|---|
| The CMake executable at the path [build.ps1](../../../tools/documentation/build.ps1) hard-codes | hard | the script throws before configuring |
| The `w64devkit` bin directory at the path [build.ps1](../../../tools/documentation/build.ps1) adds to `PATH` | hard | the compiler is not found and the configure step fails |
| `ninja.exe` in that bin directory | soft | the script falls back to `MinGW Makefiles` with `mingw32-make.exe` |
| A writable `tools/documentation/build/` | hard | the build fails |
| Network access | none | the build is fully offline |

### 2.4 How the scripts invoke the tool

The build script and the test runner call native programs directly
(`& $exe @arguments`) rather than through `Start-Process`, and both relax
`$ErrorActionPreference` to `Continue` around the call. Both details are
measured, not stylistic:

* `Start-Process` with redirected stdout and stderr costs about 1.03 s per
  launch on profile `M1`, while the executable finishes in about 63 ms. The
  runner needs 27 launches, so that plumbing was 27.8 s of a 28.99 s suite
  ([performance.md](performance.md) §6.0).
* A direct call yields the exit code through `$LASTEXITCODE` and the report
  through the output stream, so neither needs an intermediate file.
* `docguard` writes its summary line to stderr, and under `Stop` a native
  stderr line becomes a terminating PowerShell error, which would fail a clean
  tree. Relaxing the preference around the call is what keeps a warning a
  warning.

The runner's determinism comparison follows from the same choice: it hashes the
decoded stdout text with an in-memory SHA-256 helper instead of hashing two
captured files, so the comparison has no filesystem dependency and leaves
nothing behind.

## 3. Configuration and relocation

The tool reads no configuration file and has no environment-variable contract of
its own. Its behaviour is decided by its arguments, and everything else is a
build-time constant.

| Setting | Where | Relocatable? |
|---|---|---|
| The compiler path | [build.ps1](../../../tools/documentation/build.ps1) | No: it is an absolute path to the portable toolchain |
| The CMake path | [build.ps1](../../../tools/documentation/build.ps1) | No: an absolute path |
| The build directory | [build.ps1](../../../tools/documentation/build.ps1), relative to the script | Yes: it follows the tool directory |
| The artifact path | `RUNTIME_OUTPUT_DIRECTORY` in [CMakeLists.txt](../../../tools/documentation/CMakeLists.txt) | Yes: it follows the build directory |
| The repository root | resolved by each script from its own location | Yes, by construction: moving the checkout moves every derived path |
| The scan root | `--root`, or the process's working directory | Yes: it is a runtime argument |

Relocation procedure for a checkout that moves to another path or another host:
the repository root needs no edit, because no configuration file quotes it; the
only edits are the two absolute tool paths in
[build.ps1](../../../tools/documentation/build.ps1), and a host without the same
toolchain must either install it at the same path or edit the two constants.
[risks.md](risks.md) DOC-04 tracks the consequence.

## 4. Algorithms and complexity

Notation: `E` is the number of non-ignored entries below the scan root, `F` the
number of tracked text files, `B` the total bytes of those files, `W` the length
of one line, `L` the number of markdown links, `V` the number of violations, and
`K` the number of ignored prefixes (`11`).

### 4.1 Traversal and the ignore list

A single recursive directory iteration walks the root once and appends one entry
per path; an ignored path is skipped and, when it is a directory, recursion
beneath it is disabled. Each candidate is compared against the `K` prefixes by
exact match or by a prefix-plus-separator match, so filtering is `O(E·K)`
string comparisons with `K` a compile-time constant. The entry list is then
sorted by relative path, which gives every later rule a deterministic order for
`O(E log E)` comparisons.

### 4.2 Reading and decoding

A file is read once, on first request, through a `std::map` keyed by relative
path: `O(log F)` per lookup, `O(B)` bytes copied in total. Decoding is one pass
over the bytes that records the UTF-8 BOM, splits on LF while stripping a
trailing CR, counts CRLF pairs and remembers the first one. A path that does not
exist is cached as empty text and is **not** an IO failure; a file that exists
but cannot be opened is retried five times with a 20 ms pause and then becomes
an IO failure, which forces exit code `2`.

### 4.3 The rule pass

Every check walks the entry list or the lines of a file once, so the rule pass is
`O(B)` over the text plus `O(E)` over the entries, with three exceptions worth
stating:

* **Link resolution.** Inline links are found by a hand-written scanner over each
  line of an in-scope file, and each target that is not a URI, a protocol-relative
  target or a pure anchor is resolved and tested for existence with one
  filesystem query. The cost is `O(L)` filesystem queries in total. The scanner's
  worst case on a single line is quadratic in the line length — a line dominated
  by unmatched `[` bytes is re-scanned from each new position — so the honest
  bound is `O(W²)` per pathological line and `O(W)` for prose. [risks.md](risks.md)
  DOC-02 tracks it.
* **Version tokens.** A single left-to-right scan per line of
  [VERSIONS.md](../../plan/VERSIONS.md) accepts `v` at a word boundary followed
  by at least three numeric segments; the scan always advances past the token it
  inspected, so it is `O(W)` amortized.
* **Module catalog.** The catalog is parsed once with the dependency-free
  recursive-descent reader in [src/json_value.cpp](../../../tools/documentation/src/json_value.cpp),
  `O(C)` over the catalog's bytes, and the resulting names are compared against
  the `O(E)` module directories.

The fenced-code state is a two-state machine driven line by line: a run of three
or more backticks or tildes opens a fence, and only a run of the same marker with
at least the opening length closes it. The opening delimiter line itself already
counts as inside the fence.

### 4.4 Ordering and rendering

Violations are sorted by `(path, line, code, message)` with `O(V log V)`
comparisons and then de-duplicated with one linear pass over the same key. The
renderer is `O(total message bytes)`. Together these steps are what make two runs
over an unchanged tree byte-identical: no rule depends on iteration order for
its output, and the final order is imposed in one place.

### 4.5 Totals

| Quantity | Bound |
|---|---|
| Time | `O(E log E + E·K + B + L·fs-query + V log V)`, plus `O(Σ W²)` in the pathological link case |
| Peak memory | `O(E + B)`: the decoded cache keeps the raw bytes of every tracked text file **and** a copy of each line, so roughly twice the total text size |
| Filesystem queries | one enumeration of the root, `O(F)` file opens, `O(L)` existence tests, plus the existence and kind tests the layout and module rules make |
| Allocations of note | one vector of entries, one map of decoded files, one vector of violations |

The memory bound is the reason the tool is honest about not streaming: a
repository whose tracked text exceeds available memory cannot be checked by this
implementation. See [performance.md](performance.md) §7 and
[risks.md](risks.md) DOC-03.

## 5. Data structures

| Type | Where | Role |
|---|---|---|
| `TreeEntry` | [src/repo_scan.hpp](../../../tools/documentation/src/repo_scan.hpp) | one relative path plus a directory flag; the unit of the entry list |
| `TextFile` | [src/text_file.hpp](../../../tools/documentation/src/text_file.hpp) | raw bytes, split lines, BOM flag, CRLF count and first CRLF line |
| `FenceTracker` | [src/text_file.hpp](../../../tools/documentation/src/text_file.hpp) | the fenced-code state machine |
| `Violation` | [src/model.hpp](../../../tools/documentation/src/model.hpp) | severity, code, path, line, message |
| `ViolationSink` | [src/model.hpp](../../../tools/documentation/src/model.hpp) | the collection, the ordering, the duplicate rule and the `--strict` promotion |
| `RepoTree` | [src/repo_scan.hpp](../../../tools/documentation/src/repo_scan.hpp) | the entry list, the decoded-file cache, the IO-failure list and the existence predicates |

The check codes are `inline constexpr` string views in one namespace in
[src/model.hpp](../../../tools/documentation/src/model.hpp). That is the single
place where a code is spelled, which is what makes an accidental rename a
compile-time event for the checks rather than a silent behaviour change.

## 6. Why these choices, and what was rejected

| Choice | Alternative considered | Why the choice won |
|---|---|---|
| One traversal producing a sorted entry list, and every rule reading that list | each rule walking the tree itself | one enumeration instead of six; one sort instead of six; a deterministic order for free. Re-walking would make the file-open count depend on the number of rules |
| All checks in one C++ process with a shared cache | a script per check, or a Python implementation | the user required a fast gate over a tree expected to grow to hundreds of documents, and the process-start cost dominates a per-check process design. See [ADR 0003](../../adr/governance-and-build/0003-cpp-is-tooling-only.md) |
| A hand-written markdown scanner covering inline links, fences and the two line-level rules | a full CommonMark parser as a dependency | the checks need line numbers and a mechanical verdict, not a document tree; a parser would add a dependency, a license surface and an abstraction the rules do not use. The cost is the quadratic worst case of DOC-02, which is accepted and tracked |
| A dependency-free JSON reader for the module catalog | a third-party JSON library | one small input type does not justify a dependency in a tool that must build offline from a fixed toolchain |
| A closed, hard-coded ignore list | a `.docguardignore` file in the tree | an ignore file would let a change to the tree widen the verdict silently; keeping the list in code, published in [interfaces.md](interfaces.md) §6, makes every change an interface change |
| Deterministic ordering and de-duplication as a final step | preserving the order in which checks ran | byte-identical output across runs is a stated acceptance criterion; imposing the order in one place keeps the rule order free to change |
| Whole-file reads | streaming and line-at-a-time checks | the tracked files are documents; streaming would complicate the cached decode that lets five rules share one read. The consequence is the `O(B)` memory bound, tracked in DOC-03 |
| No content hashes, no manifest, no receipt | a generated manifest with a hash receipt | declined by the user; the drift this repository suffers is structural, not content-hash drift. Recorded in [ADR 0001](../../adr/governance-and-build/0001-single-authority-documentation-system.md) |
| A direct call to the executable from the test runner | `Start-Process` with redirected stdio, one launch per case | the launch cost is the process object and the redirected pipes, not the tool: about 1.03 s against about 63 ms per invocation, so 27 launches dominated a 28.99 s suite. A direct call removes the cost and the scratch files together ([performance.md](performance.md) §6.0) |
| A timestamp freshness check before invoking the build system | calling `cmake --build` unconditionally | the driver pays 4.26 s before it can decide there is nothing to do, so an unconditional call taxed every gate run. The check has to be conservative — every input under `src/` plus `CMakeLists.txt` — because a missed input would ship a stale binary, which is worse than a slow build |

## 7. Environment requirements

| Requirement | Why | Behaviour elsewhere |
|---|---|---|
| A C++20 toolchain and CMake | the executable is compiled | no interpreter fallback exists |
| Windows for the current build path | [build.ps1](../../../tools/documentation/build.ps1) hard-codes a `w64devkit` layout and the target links with `-municode` | The sources are portable C++ and `main.cpp` carries a POSIX `main` branch, but no non-Windows build has been performed. Profile `M1` is the only declared profile ([PERFORMANCE_ACCEPTANCE.md](../../plan/PERFORMANCE_ACCEPTANCE.md) §1) |
| Windows PowerShell ≥ 5.1 for the wrapper scripts | the scripts declare `#Requires -Version 5.1` | the scripts do not start |
| No network access | nothing downloads at build or run time | — |
| No write access below the scan root | the tool only reads there | a tree that cannot be read produces IO failures and exit code `2` |
