# docguard — documentation conformance gate

`docguard` is the C++20 tool behind the repository's documentation gate. It scans a
repository tree, applies fifteen mechanical checks with stable codes, and reports them in
a deterministic order so that the same tree always produces the same bytes.

The gate entry point is `validate-documentation.ps1`; `build.ps1` builds the executable
and `tests/run-tests.ps1` proves the checks against fixture repositories.

## Layout

```
tools/documentation/
  CMakeLists.txt
  README.md                          this file
  build.ps1                          idempotent Release build
  validate-documentation.ps1         gate entry point (builds when needed, forwards the exit code)
  src/
    main.cpp                         entry point, wmain on Windows for non-ASCII roots
    cli.cpp / cli.hpp                option parsing and usage text
    model.hpp                        Severity, Violation, check-code constants, sink
    report.cpp / report.hpp          text and JSON rendering
    repo_scan.cpp / repo_scan.hpp    deterministic traversal, cached reads, ignore list
    text_file.cpp / text_file.hpp    BOM/CR detection, line splitting, fenced-code tracking
    json_value.cpp / json_value.hpp  dependency-free JSON reader with line numbers
    strutil.cpp / strutil.hpp        ASCII-aware string helpers
    rules_common.cpp                 shared helpers and check registration
    rules_layout.cpp                 DOC_LAYOUT_MISSING
    rules_text.cpp                   DOC_PATH_NOT_ENGLISH, DOC_CRLF, DOC_BOM
    rules_markdown.cpp               markdown links, status vocabulary, markers, absolute paths
    rules_version.cpp                version syntax, authority leaks, version table
    rules_adr.cpp                    ADR naming and required sections
    rules_module.cpp                 module contract and module catalog
  tests/
    make-fixtures.ps1                regenerates every fixture tree
    run-tests.ps1                    assertions over the fixtures
    fixtures/                        seventeen fixture repositories (seventeen cases)
```

## Build

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
Set-Location '<repo>'
. .\scripts\env.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File tools/documentation/build.ps1
```

`build.ps1` sources `scripts/env.ps1` itself, so all transient data stays inside the
repository tree. It configures `tools/documentation/build` with CMake 4.4.2, Ninja and
GCC 16.1.0 from `<toolchain>`, then links a static executable
(`-static -static-libgcc -static-libstdc++`) that runs without MinGW runtime DLLs. The
script is idempotent; `-Clean` removes the build directory first, `-Configuration` picks
`Release` (default), `Debug` or `RelWithDebInfo`.

## Run

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/documentation/validate-documentation.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File tools/documentation/validate-documentation.ps1 -Format json
powershell -NoProfile -ExecutionPolicy Bypass -File tools/documentation/validate-documentation.ps1 -Root tools/documentation/tests/fixtures/clean
```

The executable itself:

```
docguard [--root <dir>] [--format text|json] [--strict] [--quiet]
```

| Option | Meaning |
|---|---|
| `--root <dir>` | tree to validate; defaults to the current working directory |
| `--format text\|json` | output format; defaults to `text` |
| `--strict` | every warning is reported and counted as an error |
| `--quiet` | text format only: print the summary line and nothing else |
| `-h`, `--help` | usage; exit code 0 |

### Exit codes

| Code | Meaning |
|---|---|
| `0` | no violation of any severity |
| `1` | at least one violation (error, or warning — a warning is a firing check code) |
| `2` | usage error, IO error (an existing file could not be read) or internal error |

An unreadable file is reported on stderr and forces exit code `2`; violations found before
that point are still printed. A file that does not exist is not an IO error — whether it
must exist is the business of `DOC_LAYOUT_MISSING`.

### Output contract

Text format prints one line per violation on stdout:

```
<severity> <CODE> <relative-path>[:<line>] <message>
```

`severity` is `ERROR` or `WARN`, and the `:<line>` suffix is omitted for whole-file
findings. The summary line goes to stderr in text mode and to stdout in `--quiet` mode, so
stdout stays machine-parseable.

JSON format prints one object on stdout:

```json
{"root":"...","violations":[{"severity":"ERROR","code":"DOC_CRLF","path":"docs/x.md","line":3,"message":"..."}],"counts":{"error":1,"warn":0}}
```

Field order is fixed, `line` is `0` for whole-file findings, and violations are sorted by
`(path, line, code, message)`. Every path is relative to `--root` with `/` separators.
Two runs over an unchanged tree produce byte-identical output.

## Check codes

| Code | Severity | Fails when |
|---|---|---|
| `DOC_LAYOUT_MISSING` | ERROR | one of the mandatory paths is absent or has the wrong kind |
| `DOC_PATH_NOT_ENGLISH` | ERROR | a relative path contains a non-ASCII byte (files and directories) |
| `DOC_CRLF` | ERROR | a text file contains a CRLF line ending (CR immediately followed by LF) |
| `DOC_BOM` | ERROR | a text file starts with a UTF-8 byte order mark |
| `DOC_MD_LINK_BROKEN` | ERROR | a relative markdown link target does not resolve to a file or directory |
| `DOC_STATUS_VOCAB` | ERROR | a status declaration uses a value outside the closed vocabulary |
| `DOC_PLACEHOLDER` | ERROR | document text carries a forbidden marker word |
| `DOC_VERSION_SYNTAX` | ERROR | `docs/plan/VERSIONS.md` contains an ill-formed version identifier |
| `DOC_VERSION_AUTHORITY_LEAK` | ERROR | a navigation document restates the current or next version |
| `DOC_ADR_NAMING` | ERROR | an ADR path violates the category / number / kebab-case contract |
| `DOC_ADR_SECTIONS` | ERROR | an ADR lacks its title line or one of the four required sections |
| `DOC_MODULE_CONTRACT` | ERROR | a module directory lacks one of its eight documents |
| `DOC_MODULE_CATALOG` | ERROR | `docs/model/module-catalog.json` and the module directories disagree |
| `DOC_LF_ONLY_DECLARED` | WARN | `docs/plan/VERSIONS.md` has no `\| Version \| State \|` table header |
| `DOC_ABSOLUTE_PATH_IN_DOCS` | WARN | `docs/**/*.md` mentions a `C:` absolute path outside a fenced block |

Mandatory paths for `DOC_LAYOUT_MISSING`: `AGENTS.md`, `ENGINE_STANDARD.md`, `README.md`,
`docs/README.md`, `docs/DOCUMENTATION_RULES.md`, `docs/AI_DOCUMENTATION_GUIDE.md`,
`docs/MODULE_COMPONENT_GUIDE.md`, `docs/plan/VERSIONS.md`, `docs/plan/ROADMAP.md`,
`docs/plan/PERFORMANCE_ACCEPTANCE.md`, `docs/adr/README.md`,
`docs/model/module-catalog.json`, `dev-log/`, `evidence/`.

The status vocabulary accepted by `DOC_STATUS_VOCAB`:

```
Implemented  Partially Implemented  Planned  User Paused  Future Goal
Proposed  Deprecated  Rejected  Superseded  Validated  Unvalidated
```

The marker words rejected by `DOC_PLACEHOLDER` (case-insensitive, whole word, fenced code
blocks exempt — the CJK entries are listed as code points so this file itself stays clean):

```
TODO
TBD
FIXME
PLACEHOLDER
XXX
U+5F85 U+8865 U+5145
U+5F85 U+5B9A
```

## Interpretation decisions

These are the places where the contract needed a decision. They are recorded here because
each one is observable in the output.

1. **A warning is a firing check code.** Exit code `1` is returned whenever the violation
   list is non-empty, whatever the severity, because `AGENTS.md` §4 says the gate fails
   "when any check code fires". `--strict` therefore does not change the verdict; it
   changes the *severity* of warnings to `ERROR` in the report and in `counts`.
2. **Ignored paths.** `.git`, `.venv`, `node_modules`, `__pycache__`, `.cache`,
   `.pytest_cache`, `.ruff_cache`, `.mypy_cache`, `TEMP`, `tools/documentation/build` and
   `tools/documentation/tests/fixtures` are never scanned. The last two keep the tool's own
   build output and its deliberately broken fixture trees out of the repository verdict;
   the rest are machine-generated caches. Everything else under `--root` is scanned.
3. **Line endings.** `DOC_CRLF` reports a CRLF *line ending*, that is a CR byte immediately
   followed by an LF byte. A lone CR byte is not reported: whether a bare CR is a line
   ending at all is decided by the system that produced the file, not by this tool. A file
   that separates every line with a bare CR therefore passes, while one CRLF anywhere in a
   tracked text file is an error.
4. **Fenced code blocks.** Only `DOC_PLACEHOLDER` and `DOC_ABSOLUTE_PATH_IN_DOCS` are
   exempt inside a fenced block, exactly as the contract states. Link resolution and the
   status vocabulary are applied to every line, including inside a fence, because the
   contract grants no exemption there.
5. **Whole-word matching is case-insensitive for real words.** `PENDING` does not match
   `PENDINGLY`, and the English noun "placeholder" in prose *does* match, because the rule
   is case-insensitive by contract. Rephrase, or put the word inside a fenced block.
6. **Link targets.** `http:`, `https:`, `mailto:` and any other `scheme:` target, protocol
   relative `//host` targets and pure `#anchor` targets are skipped. A `#fragment` is
   stripped before resolution and is not validated against headings. `<...>` delimited
   targets, percent-escapes and markdown title suffixes are handled. A target beginning
   with `/` resolves against `--root`, which is how a repository host renders it.
7. **Version grammar.** A version token is `v` at a word boundary followed by at least
   three numeric segments. It is accepted when the major part is exactly `0` and there are
   three or four segments, or when there are three segments plus a `fix<n>` suffix. Tokens
   with fewer than three segments are not version identifiers and are ignored.
8. **`DOC_LF_ONLY_DECLARED`** accepts any table header whose first two columns are
   `Version` and `State`, with any padding and any further columns.
9. **Module directories.** A module directory is a direct child of `docs/model` whose name
   does not start with `.` and which does not itself contain a `README.md`; index
   directories are therefore excluded from the eight-document contract. `DOC_MODULE_CATALOG`
   implements exactly the three documented agreements (catalog name to directory,
   directory to catalog, name pattern `^[a-z][a-z0-9-]*$`). The `owner` and `language`
   fields are not validated and duplicate names are not rejected.
10. **ADR files.** Every `.md` under `docs/adr` except `docs/adr/README.md` and a
    `README.md` directly inside a category directory is treated as an ADR. An unknown
    category directory is reported even when it holds no file. `NNNN` is unique repository
    wide and every file in a collision is reported. The title line must be a level-one
    heading of the form `# ADR NNNN`; the four sections may be any heading level from `##`
    down, matched on the first word.
11. **Non-ASCII roots.** The Windows entry point is `wmain`, so a root such as
    `<repo>` survives the round trip through the command line. Files are
    opened through the wide CRT entry point, and unreadable files are retried five times
    before they are treated as an IO error.

## Tests

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/documentation/tests/make-fixtures.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File tools/documentation/tests/run-tests.ps1
```

`make-fixtures.ps1` rebuilds seventeen fixture repositories under `tests/fixtures`. Fifteen
of them are a complete layout-valid skeleton plus exactly one defect, one per check code;
`clean` and `lone-cr` must produce no violation at all. `run-tests.ps1` asserts the exit
code and the exact set of codes in the JSON report for every fixture, then checks
byte-identical output across two runs, the `--strict` severity promotion, and the usage/IO
exit codes.

## Known gaps

* Checks are per line; a violation spanning lines is reported at its first line.
* `DOC_STATUS_VOCAB` recognises `**Status:** X` and a line-initial `Status: X` only.
* No anchor validation, no image resolution beyond existence, and no link check outside
  `docs/**/*.md`, `README.md`, `AGENTS.md` and `ENGINE_STANDARD.md`.
* Files larger than memory are not streamed; the reader loads a whole file.
